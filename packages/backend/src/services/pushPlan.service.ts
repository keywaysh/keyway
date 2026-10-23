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

export type RejectReason = "truncated" | "escaped-quote" | "invalid-key";

export interface Rejection {
  key: string;
  reason: RejectReason;
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

// Same rule as the other secret routes.
const KEY_FORMAT = /^[A-Z][A-Z0-9_]*$/;

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

function looksTruncated(value: string): boolean {
  const quote = value[0];
  return (quote === '"' || quote === "'") && (value.length === 1 || !value.endsWith(quote));
}

// Characters of multi-line values whose continuation lines one push may scan. Past it, only
// first lines are read: a value's own echo is still recognized, phantom-like new keys are
// still refused by the key format check, and every overwrite is archived anyway.
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

  for (const [key, value] of Object.entries(incoming)) {
    const exists = Object.hasOwn(current, key);
    if (canRead && exists && current[key] === value) {
      plan.unchanged.push(key);
    } else if (candidates?.get(key)?.has(value)) {
      (exists ? plan.protected : plan.ignored).push(key);
    } else if (releasedCli && looksTruncated(value)) {
      plan.rejected.push({ key, reason: "truncated" });
    } else if (releasedCli && value.includes('\\"')) {
      // The released parsers never unescape, so \" comes from a mis-parsed quoted value.
      plan.rejected.push({ key, reason: "escaped-quote" });
    } else if (hasMultiline && !exists && !KEY_FORMAT.test(key)) {
      plan.rejected.push({ key, reason: "invalid-key" });
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

/** Error message for a push refused because of `rejected`; the released CLI prints it. */
export function describeRejections(rejected: Rejection[], dashboardUrl?: string): string {
  const keys = listKeys(
    rejected,
    ({ key, reason }) => `${displayKey(key)} (${REJECT_REASONS[reason]})`
  );
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
    parts.push(
      `Did not create ${listKeys(ignoredKeys, displayKey)}: ` +
        "these look like lines of multi-line values, not keys."
    );
  }
  parts.push(`Use the Keyway dashboard for these${dashboardUrl ? `: ${dashboardUrl}` : "."}`);
  return parts.join(" ");
}
