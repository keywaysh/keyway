import { parseLegacyEnv, toEnvFormat } from "../utils/legacyEnvFormat";

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

interface LegacyEchoIndex {
  /** For each key, every value a released client can send after pulling the environment. */
  candidates: Map<string, Set<string>>;
  /** Stored keys the released CLI reads back under their own name. */
  readableByCli: Set<string>;
}

// The released parser reads each line on its own, so the echo of the environment is covered
// by the echoes of each secret alone, whatever order the client received them in.
function legacyEchoIndex(current: Record<string, string>): LegacyEchoIndex {
  const index: LegacyEchoIndex = { candidates: new Map(), readableByCli: new Set() };
  for (const [key, value] of Object.entries(current)) {
    const content = toEnvFormat({ [key]: value });
    for (const flavor of ["go", "js"] as const) {
      const parsed = parseLegacyEnv(content, flavor);
      if (flavor === "go" && Object.hasOwn(parsed, key)) {
        index.readableByCli.add(key);
      }
      for (const [parsedKey, parsedValue] of Object.entries(parsed)) {
        const values = index.candidates.get(parsedKey) ?? new Set<string>();
        values.add(parsedValue);
        index.candidates.set(parsedKey, values);
      }
    }
  }
  return index;
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
  { mode, userAgent }: PushPlanOptions
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
  const releasedCli = mode === undefined && isReleasedCli(userAgent);
  const legacy = releasedCli || (mode === undefined && isReleasedMcp(userAgent));
  const index = legacy ? legacyEchoIndex(current) : undefined;

  for (const [key, value] of Object.entries(incoming)) {
    const exists = Object.hasOwn(current, key);
    if (exists && current[key] === value) {
      plan.unchanged.push(key);
    } else if (index?.candidates.get(key)?.has(value)) {
      (exists ? plan.protected : plan.ignored).push(key);
    } else if (releasedCli && looksTruncated(value)) {
      plan.rejected.push({ key, reason: "truncated" });
    } else if (releasedCli && value.includes('\\"')) {
      // The released parsers never unescape, so \" comes from a mis-parsed quoted value.
      plan.rejected.push({ key, reason: "escaped-quote" });
    } else if (releasedCli && !exists && !KEY_FORMAT.test(key)) {
      plan.rejected.push({ key, reason: "invalid-key" });
    } else {
      (exists ? plan.update : plan.create).push(key);
    }
  }

  if (resolvePushMode(mode, userAgent) === "replace") {
    // The released CLI never sends the keys its parser cannot read back: keep them. (MCP
    // 1.0.0 always merges, so only the CLI gets here as a released client.)
    const visible = releasedCli ? index?.readableByCli : undefined;
    plan.trash = Object.keys(current).filter(
      (key) => !Object.hasOwn(incoming, key) && (!visible || visible.has(key))
    );
  }
  return plan;
}

const REJECT_REASONS: Record<RejectReason, string> = {
  truncated: "multi-line value",
  "escaped-quote": "contains escaped quotes",
  "invalid-key": "key must be uppercase with underscores, e.g. DATABASE_URL",
};
const MAX_LISTED = 10;
const MAX_KEY_LENGTH = 40;

/** Error message for a push refused because of `rejected`; the released CLI prints it. */
export function describeRejections(rejected: Rejection[], dashboardUrl?: string): string {
  const listed = rejected.slice(0, MAX_LISTED).map(({ key, reason }) => {
    const name = key.length > MAX_KEY_LENGTH ? `${key.slice(0, MAX_KEY_LENGTH)}…` : key;
    return `${name} (${REJECT_REASONS[reason]})`;
  });
  if (rejected.length > MAX_LISTED) {
    listed.push(`and ${rejected.length - MAX_LISTED} more`);
  }
  return (
    "This version of the keyway CLI cannot push these values without corrupting them, so nothing was saved: " +
    `${listed.join(", ")}. Set them from the Keyway dashboard instead${dashboardUrl ? `: ${dashboardUrl}` : "."}`
  );
}
