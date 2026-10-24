import { parseLegacyEnv, scanLegacyEnv, toEnvFormat } from "../utils/legacyEnvFormat";

/** merge keeps secrets missing from the push; replace moves them to the trash. */
export type PushMode = "merge" | "replace";

export interface PushPlan {
  create: string[];
  update: string[];
  unchanged: string[];
  /** A released client sent back its corrupted copy of the stored value: keep the stored one. */
  protected: string[];
  /** Phantom key a released client parsed out of a multi-line value: do not create it. */
  ignored: string[];
  /** Value or key a released CLI could only have produced by mis-parsing: refuse the push. */
  rejected: Rejection[];
  trash: string[];
}

export type RejectReason = "truncated" | "escaped-quote" | "invalid-key" | "undecryptable";

/** Prefix of the value the push route gives a stored secret it cannot decrypt. */
export const UNDECRYPTABLE = "\0undecryptable:";

export interface Rejection {
  key: string;
  reason: RejectReason;
  /** The key is in the stored environment, so its name is not a fragment of a value. */
  stored: boolean;
}

export interface PushPlanOptions {
  mode?: PushMode;
  userAgent?: string;
  /**
   * False when the caller may write but not read the environment: it cannot have pulled, so
   * it is not echoing, and the plan must not tell it whether its values match the stored ones.
   */
  canRead?: boolean;
}

// A key in one case only (NEW_KEY, http_proxy, _JAVA_OPTIONS). The text before "=" on a line of a
// stored value, such as a base64 line of a private key, is almost always in mixed case.
const PLAIN_KEY = /^(?:[A-Z_][A-Z0-9_]*|[a-z_][a-z0-9_]*)$/;

// True when userAgent names `client` with a version below `fixed` (or no parsable version).
// Accepts "0.6.1", "v0.6.1" and git describe output such as "cli/v0.6.1-3-gabc1234".
function isOlderClient(userAgent: string | undefined, client: string, fixed: number[]): boolean {
  const match = new RegExp(`${client}/(\\S*)`, "i").exec(userAgent ?? "");
  if (!match) {
    return false;
  }
  const version = /^(?:cli\/)?v?(\d+)\.(\d+)(?:\.(\d+))?/.exec(match[1]);
  if (!version) {
    return true;
  }
  const parts = version.slice(1).map((part) => Number(part ?? 0));
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== fixed[i]) {
      return parts[i] < fixed[i];
    }
  }
  return false;
}

/**
 * Whether a push may create a secret with this key. The .env text pull sends puts one
 * KEY=value per line, so the key needs a character and no "=", line break or other control
 * character, nor a leading "#" or surrounding spaces. Existing keys keep working.
 */
export function isUsableNewKey(key: string): boolean {
  return (
    key !== "" && key.trim() === key && !key.startsWith("#") && !/[=\p{Cc}\u2028\u2029]/u.test(key)
  );
}

/** CLI up to 0.6.0 (all of which send "keyway-cli/dev"). 0.6.1 is the first fixed version. */
export function isReleasedCli(userAgent: string | undefined): boolean {
  return isOlderClient(userAgent, "keyway-cli", [0, 6, 1]);
}

function isReleasedMcp(userAgent: string | undefined): boolean {
  return isOlderClient(userAgent, "keyway-mcp", [1, 0, 1]);
}

/** MCP 1.0.0 pushes a single secret and expects the others to stay, so it defaults to merge. */
export function resolvePushMode(
  mode: PushMode | undefined,
  userAgent: string | undefined
): PushMode {
  if (mode) {
    return mode;
  }
  return /keyway-mcp\//i.test(userAgent ?? "") ? "merge" : "replace";
}

// toEnvFormat escapes every double quote of a value it quotes, so the released CLI's copies keep
// a backslash before each one. A value with a bare quote comes from elsewhere (the command line,
// a hand-written .env file).
function allQuotesEscaped(text: string): boolean {
  return !/(?<!\\)"/.test(text);
}

// The released parsers never unescape, so \" comes from a value toEnvFormat quoted. Its last
// line also keeps the bare quote that closed it.
function looksEscaped(value: string): boolean {
  return (
    value.includes('\\"') &&
    (allQuotesEscaped(value) || (value.endsWith('"') && allQuotesEscaped(value.slice(0, -1))))
  );
}

// An opening quote never closed: the first line of a multi-line value, cut by the released
// parser, from the server's own output (double quotes) or a hand-written .env file.
function looksTruncated(value: string): boolean {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") {
    return false;
  }
  const unclosed = value.length === 1 || !value.endsWith(quote);
  return unclosed && (quote === "'" || allQuotesEscaped(value.slice(1)));
}

// Characters of multi-line values whose continuation lines one push may scan. Past it, only
// first lines are read: a value's own echo is still recognized, mixed-case phantom keys are
// still refused, and every overwrite is archived anyway.
const CONTINUATION_SCAN_BUDGET = 1_000_000;

// For each of `wanted`, the values a released client can send for it after pulling
// `current`. The released parser reads each line on its own, so the echo of the environment
// is covered by the echoes of each secret alone, whatever order the client received them in.
// Only `wanted` keys are recorded, so memory stays proportional to the push.
function legacyCandidates(
  current: Record<string, string>,
  wanted: Set<string>
): Map<string, Set<string>> {
  const candidates = new Map<string, Set<string>>();
  const multilineSize = Object.values(current).reduce(
    (size, value) => (value.includes("\n") ? size + value.length : size),
    0
  );
  const scanContinuations = multilineSize <= CONTINUATION_SCAN_BUDGET;
  for (const [key, value] of Object.entries(current)) {
    const newline = value.indexOf("\n");
    // First line of toEnvFormat's output: a multi-line value is always quoted.
    const content =
      newline === -1 || scanContinuations
        ? toEnvFormat({ [key]: value })
        : `${key}="${value.slice(0, newline).replace(/"/g, '\\"')}`;
    for (const flavor of ["go", "js"] as const) {
      scanLegacyEnv(content, flavor, (parsedKey, parsedValue) => {
        if (wanted.has(parsedKey)) {
          const values = candidates.get(parsedKey) ?? new Set<string>();
          values.add(parsedValue);
          candidates.set(parsedKey, values);
        }
      });
    }
  }
  return candidates;
}

// Whether the released CLI reads a stored key back under its own name ("#A" is a comment,
// " A" reads as "A"); the value does not matter.
function isReadableByCli(key: string): boolean {
  return Object.hasOwn(parseLegacyEnv(`${key}=x`, "go"), key);
}

/**
 * Decide what a push does with each secret. Released clients (CLI up to 0.6.0, MCP 1.0.0)
 * send no mode; they parse pulled values with a line-based parser and send them back, so
 * for them the plan keeps stored values instead of their corrupted echoes, skips phantom
 * keys, and refuses values a released CLI could only have produced by mis-parsing.
 */
export function planPush(
  current: Record<string, string>,
  incoming: Record<string, string>,
  { mode, userAgent, canRead = true }: PushPlanOptions
): PushPlan {
  const plan: PushPlan = {
    create: [],
    update: [],
    unchanged: [],
    protected: [],
    ignored: [],
    rejected: [],
    trash: [],
  };
  // Fixed clients always send a mode, so a mode means the guard is not needed.
  const releasedCli = canRead && mode === undefined && isReleasedCli(userAgent);
  // A single secret from MCP comes from keyway_set_secret, which never pulled it; generate,
  // which pushes back what it pulled, adds the secret it generated.
  const releasedMcp =
    canRead && mode === undefined && isReleasedMcp(userAgent) && Object.keys(incoming).length > 1;
  const legacy = releasedCli || releasedMcp;
  const changed = Object.keys(incoming).filter(
    (key) => !canRead || !Object.hasOwn(current, key) || current[key] !== incoming[key]
  );
  const candidates =
    legacy && changed.length > 0 ? legacyCandidates(current, new Set(changed)) : undefined;
  // Phantom keys only come from multi-line values.
  const hasMultiline = releasedCli && Object.values(current).some((value) => value.includes("\n"));

  // Without a stored value, its copy and the keys read from inside it look like changes. A
  // released client could not have pulled it anyway.
  if (legacy) {
    for (const [key, value] of Object.entries(current)) {
      if (value.startsWith(UNDECRYPTABLE)) {
        plan.rejected.push({ key, reason: "undecryptable", stored: true });
      }
    }
    if (plan.rejected.length > 0) {
      return plan;
    }
  }

  for (const [key, value] of Object.entries(incoming)) {
    const exists = Object.hasOwn(current, key);
    if (canRead && exists && current[key] === value) {
      plan.unchanged.push(key);
    } else if (candidates?.get(key)?.has(value)) {
      (exists ? plan.protected : plan.ignored).push(key);
    } else if (releasedCli && looksTruncated(value)) {
      plan.rejected.push({ key, reason: "truncated", stored: exists });
    } else if (releasedCli && looksEscaped(value)) {
      plan.rejected.push({ key, reason: "escaped-quote", stored: exists });
    } else if (hasMultiline && !exists && !PLAIN_KEY.test(key)) {
      plan.rejected.push({ key, reason: "invalid-key", stored: exists });
    } else {
      (exists ? plan.update : plan.create).push(key);
    }
  }

  if (resolvePushMode(mode, userAgent) === "replace") {
    // The released CLI never sends the keys its parser cannot read back: keep them. (MCP
    // 1.0.0 always merges, so only the CLI gets here as a released client.)
    plan.trash = Object.keys(current).filter(
      (key) => !Object.hasOwn(incoming, key) && (!releasedCli || isReadableByCli(key))
    );
  }
  return plan;
}

const REJECT_REASONS: Record<RejectReason, string> = {
  truncated: "multi-line value",
  "escaped-quote": "contains escaped quotes",
  "invalid-key": "looks like a line of a multi-line value, not a key",
  undecryptable: "stored value cannot be decrypted",
};
const MAX_LISTED = 10;
const MAX_KEY_LENGTH = 40;

// "A, B, and 3 more", with long keys shortened.
function listKeys<T>(items: T[], label: (item: T) => string): string {
  const listed = items.slice(0, MAX_LISTED).map(label);
  if (items.length > MAX_LISTED) {
    listed.push(`and ${items.length - MAX_LISTED} more`);
  }
  return listed.join(", ");
}

// Shortened, and without control or formatting characters: the CLI prints it in a terminal.
function displayKey(key: string): string {
  const shown = key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}…` : key;
  return shown.replace(/[\p{Cc}\p{Cf}\u2028\u2029]/gu, "?");
}

// "n keys not shown" instead of the name: the CLI and the server logs print these messages.
function countNotShown(count: number, label: string): string {
  return `${count} key${count === 1 ? "" : "s"} not shown (${label})`;
}

/**
 * Error message for a push that would create keys `isUsableNewKey` refuses. It counts them
 * without naming them: like the keys `describeRejections` counts, they can be text from inside
 * stored values (a client that sends a value's lines as keys), and the server logs the message.
 */
export function describeUnusableKeys(keys: string[]): string {
  return (
    `Cannot create ${keys.length} secret(s): a key needs at least one character, ` +
    `and no "=", line break, control character, leading "#" or surrounding spaces.`
  );
}

/** Error message for a push refused because of `rejected`; the released CLI prints it. */
export function describeRejections(rejected: Rejection[], dashboardUrl?: string): string {
  const shown = rejected.filter(({ key, stored }) => stored || PLAIN_KEY.test(key));
  const hidden = new Map<RejectReason, number>();
  for (const { reason } of rejected.filter((rejection) => !shown.includes(rejection))) {
    hidden.set(reason, (hidden.get(reason) ?? 0) + 1);
  }
  const keys = [
    ...(shown.length > 0
      ? [listKeys(shown, ({ key, reason }) => `${displayKey(key)} (${REJECT_REASONS[reason]})`)]
      : []),
    ...[...hidden].map(([reason, count]) => countNotShown(count, REJECT_REASONS[reason])),
  ].join(", ");
  return (
    "This version of the keyway CLI cannot push the following safely, so nothing was saved: " +
    `${keys}. Set them from the Keyway dashboard instead${dashboardUrl ? `: ${dashboardUrl}` : "."}`
  );
}

/**
 * Success message when stored values were kept or phantom keys skipped, else undefined;
 * `keyway push` prints it.
 */
export function describeKept(
  protectedKeys: string[],
  ignoredKeys: string[],
  dashboardUrl?: string
): string | undefined {
  if (protectedKeys.length === 0 && ignoredKeys.length === 0) {
    return undefined;
  }
  const parts = ["Secrets pushed."];
  if (protectedKeys.length > 0) {
    parts.push(
      `Kept the stored values of ${listKeys(protectedKeys, displayKey)}: ` +
        "this version of the keyway CLI cannot read multi-line or quoted values back."
    );
  }
  if (ignoredKeys.length > 0) {
    // Their names are text from inside stored values: count them.
    const count = ignoredKeys.length;
    parts.push(
      `Did not create ${count} key${count === 1 ? "" : "s"} found inside multi-line values.`
    );
  }
  parts.push(`Use the Keyway dashboard for these${dashboardUrl ? `: ${dashboardUrl}` : "."}`);
  return parts.join(" ");
}
