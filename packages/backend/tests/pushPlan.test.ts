import { describe, it, expect } from "vitest";
import { parseLegacyEnv, toEnvFormat } from "../src/utils/legacyEnvFormat";
import {
  planPush,
  isReleasedCli,
  resolvePushMode,
  describeRejections,
} from "../src/services/pushPlan.service";

// Multi-line value whose third line contains "=", like base64 padding.
const MULTI = "first line\nsecond line\nZm9vYmFy==\nlast line";
const QUOTED = 'say "hi"';
const RELEASED_CLI = "keyway-cli/dev";
const FIXED_CLI = "keyway-cli/0.6.1";
const MCP = "keyway-mcp/1.0.0";

// What a released client sends back for the environment it pulled.
const echo = (env: Record<string, string>, flavor: "go" | "js" = "go") =>
  parseLegacyEnv(toEnvFormat(env), flavor);

describe("planPush", () => {
  it("classifies unchanged, updated and created keys", () => {
    const plan = planPush({ A: "1", B: "2" }, { A: "1", B: "3", C: "4" }, {});
    expect(plan).toMatchObject({ unchanged: ["A"], update: ["B"], create: ["C"], trash: [] });
  });

  it("keeps the stored values a released CLI sends back corrupted, and skips its phantom keys", () => {
    const current = { MULTI, QUOTED, PLAIN: "ok" };
    const plan = planPush(current, { ...echo(current), NEW: "v" }, { userAgent: RELEASED_CLI });
    expect(plan).toEqual({
      create: ["NEW"],
      update: [],
      unchanged: ["PLAIN"],
      protected: ["MULTI", "QUOTED"],
      ignored: ["Zm9vYmFy"],
      rejected: [],
      trash: [],
    });
  });

  it("does the same for the JavaScript echo sent by MCP 1.0.0", () => {
    const current = { MULTI, QUOTED, PLAIN: "ok" };
    const plan = planPush(current, echo(current, "js"), { userAgent: MCP });
    expect(plan).toMatchObject({
      protected: ["MULTI", "QUOTED"],
      ignored: ["Zm9vYmFy"],
      update: [],
    });
  });

  it("recognizes echoes that only the Go parser produces", () => {
    // Unquoted value ending with U+0085: the Go CLI trims it, MCP 1.0.0 keeps it.
    const current = { K: "ab\u0085" };
    expect(echo(current)).toEqual({ K: "ab" });
    expect(planPush(current, { K: "ab" }, { userAgent: RELEASED_CLI })).toMatchObject({
      protected: ["K"],
      update: [],
    });
  });

  it("recognizes echoes that only the JavaScript parser produces", () => {
    // Unquoted value ending with a BOM: MCP 1.0.0 trims it, the Go CLI keeps it.
    const current = { K: "ab\uFEFF" };
    expect(echo(current, "js")).toEqual({ K: "ab" });
    expect(planPush(current, { K: "ab" }, { userAgent: MCP })).toMatchObject({
      protected: ["K"],
      update: [],
    });
  });

  it("protects a key that another value's continuation line overrode in the client", () => {
    // In content "B=real\nA=\"x\nB=fromA\"", the client reads B from A's second line.
    const current = { A: "x\nB=fromA", B: "real" };
    const sent = parseLegacyEnv(toEnvFormat({ B: "real", A: "x\nB=fromA" }), "go");
    expect(sent.B).toBe('fromA"');
    const plan = planPush(current, sent, { userAgent: RELEASED_CLI });
    expect(plan).toMatchObject({ protected: ["B", "A"], update: [] });
  });

  it("applies the guard to released clients that send no mode only", () => {
    const current = { MULTI, PLAIN: "ok" };
    const cases: Array<[string | undefined, "merge" | "replace" | undefined]> = [
      [FIXED_CLI, undefined],
      ["keyway-mcp/1.0.1", undefined],
      ["curl/8.0", undefined],
      [undefined, undefined],
      [RELEASED_CLI, "replace"],
      [MCP, "merge"],
    ];
    for (const [userAgent, mode] of cases) {
      const plan = planPush(current, { ...echo(current), lower_new: '"x' }, { userAgent, mode });
      expect(plan, `${userAgent} ${mode}`).toMatchObject({
        update: ["MULTI"],
        create: ["Zm9vYmFy", "lower_new"],
        protected: [],
        ignored: [],
        rejected: [],
      });
    }
  });

  it("rejects a truncated multi-line value from a released CLI, new or updated", () => {
    const plan = planPush(
      { A: "1" },
      { A: "'start", NEW: '"first line', LONE: '"' },
      { userAgent: RELEASED_CLI }
    );
    expect(plan).toMatchObject({
      rejected: [
        { key: "A", reason: "truncated" },
        { key: "NEW", reason: "truncated" },
        { key: "LONE", reason: "truncated" },
      ],
      create: [],
      update: [],
    });
  });

  it("rejects escaped quotes echoed from another value or environment", () => {
    const stale = echo({ GREETING: 'say "hi"' }).GREETING;
    expect(stale).toBe('say \\"hi\\"');
    for (const current of [{ GREETING: 'say "bye"' }, {}]) {
      expect(planPush(current, { GREETING: stale }, { userAgent: RELEASED_CLI }).rejected).toEqual([
        { key: "GREETING", reason: "escaped-quote" },
      ]);
    }
  });

  it("rejects a multi-line value whose first line ends with a quote", () => {
    // The echo loses its leading quote too, so only the escaped quote gives it away.
    const sent = echo({ NOTE: 'title: "Hello"\nbody: x' }).NOTE;
    expect(sent).toBe('title: \\"Hello\\');
    expect(
      planPush({ NOTE: "other" }, { NOTE: sent }, { userAgent: RELEASED_CLI }).rejected
    ).toEqual([{ key: "NOTE", reason: "escaped-quote" }]);
  });

  it("rejects new keys a released CLI parsed out of a stale multi-line value", () => {
    const current = { DOC: "header\nbmV3IGRhdGE=\nfooter" };
    const stale = echo({ DOC: "header\nb2xkIGRhdGE=\nfooter" });
    const plan = planPush(current, stale, { userAgent: RELEASED_CLI });
    expect(plan).toMatchObject({
      protected: ["DOC"],
      rejected: [{ key: "b2xkIGRhdGE", reason: "invalid-key" }],
      create: [],
    });
  });

  it("accepts plain inner quotes from a released CLI", () => {
    // From a local line MSG='he said "hi"': nothing escaped, nothing truncated.
    expect(planPush({}, { MSG: 'he said "hi"' }, { userAgent: RELEASED_CLI })).toMatchObject({
      create: ["MSG"],
      rejected: [],
    });
  });

  it("still lets a released CLI update an existing key whatever its name", () => {
    const plan = planPush({ lower_key: "1" }, { lower_key: "2" }, { userAgent: RELEASED_CLI });
    expect(plan).toMatchObject({ update: ["lower_key"], rejected: [] });
  });

  it("never rejects pushes from MCP 1.0.0", () => {
    const sent = { NEW: '"first line', Q: 'say \\"hi\\"', lower: "v" };
    expect(planPush({}, sent, { userAgent: MCP })).toMatchObject({
      create: ["NEW", "Q", "lower"],
      rejected: [],
    });
  });

  it("accepts the same values from a fixed CLI", () => {
    const plan = planPush(
      { A: "1" },
      { A: "'start", NEW: '"first line' },
      { userAgent: FIXED_CLI }
    );
    expect(plan).toMatchObject({ rejected: [], update: ["A"], create: ["NEW"] });
  });

  it("trashes missing keys only in replace mode", () => {
    const current = { A: "1", B: "2" };
    expect(planPush(current, { A: "1" }, {}).trash).toEqual(["B"]);
    expect(planPush(current, { A: "1" }, { userAgent: RELEASED_CLI }).trash).toEqual(["B"]);
    expect(planPush(current, { A: "1" }, { userAgent: MCP }).trash).toEqual([]);
    expect(planPush(current, { A: "1" }, { userAgent: RELEASED_CLI, mode: "merge" }).trash).toEqual(
      []
    );
    expect(planPush(current, { A: "1" }, { userAgent: MCP, mode: "replace" }).trash).toEqual(["B"]);
  });

  it("never trashes keys a released CLI could not read back", () => {
    // " A" reads back as "A" and "#B" as a comment, so the CLI never sends them.
    const current = { " A": "1", "#B": "2", C: "3" };
    expect(planPush(current, echo(current), { userAgent: RELEASED_CLI })).toMatchObject({
      ignored: ["A"],
      trash: [],
    });
    expect(planPush(current, {}, { userAgent: RELEASED_CLI }).trash).toEqual(["C"]);
    // Readable by the JavaScript parser only: the Go CLI sends "A" instead.
    expect(planPush({ "A\u0085": "1" }, { A: "1" }, { userAgent: RELEASED_CLI })).toMatchObject({
      ignored: ["A"],
      trash: [],
    });
    expect(planPush(current, {}, { userAgent: FIXED_CLI, mode: "replace" }).trash).toEqual([
      " A",
      "#B",
      "C",
    ]);
  });

  it("handles keys named like Object.prototype members", () => {
    const incoming = JSON.parse('{"__proto__": "x", "constructor": "y", "toString": "z"}');
    const plan = planPush({ toString: "z" }, incoming, {});
    expect(plan).toMatchObject({ create: ["__proto__", "constructor"], unchanged: ["toString"] });
  });

  it("stays fast on values built to slow down the legacy parser", () => {
    const current: Record<string, string> = {};
    for (let i = 0; i < 15; i++) {
      current[`K${i}`] = `a${" ".repeat(65534)}a\nb${"\u3000".repeat(1000)}=c`;
    }
    const start = performance.now();
    planPush(current, echo(current), { userAgent: RELEASED_CLI });
    expect(performance.now() - start).toBeLessThan(1000);
  });
});

describe("planPush safety property", () => {
  // Deterministic PRNG (mulberry32).
  let seed = 20261023;
  const rand = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T>(items: T[]) => items[Math.floor(rand() * items.length)];
  const PIECES = [
    "a",
    "Z9",
    " ",
    "\n",
    '"',
    "'",
    "=",
    "#",
    "\\",
    "\t",
    "\r",
    "\u0085",
    "\uFEFF",
    "\nA=x",
    "\nK=",
    "\n# c",
  ];
  const value = () => Array.from({ length: Math.floor(rand() * 8) }, () => pick(PIECES)).join("");
  const env = () => {
    const result: Record<string, string> = {};
    for (let i = 0; i < 1 + Math.floor(rand() * 4); i++) {
      result[pick(["A", "K", "API_KEY", "DB_URL"])] = value();
    }
    return result;
  };
  // The client may receive the secrets in any order.
  const shuffled = (current: Record<string, string>) =>
    Object.fromEntries(Object.entries(current).sort(() => rand() - 0.5));

  it("never changes the vault when a released client sends back what it pulled", () => {
    for (let i = 0; i < 300; i++) {
      const current = env();
      for (const [flavor, userAgent] of [
        ["go", RELEASED_CLI],
        ["js", MCP],
      ] as const) {
        const plan = planPush(current, echo(shuffled(current), flavor), { userAgent });
        expect(plan, `${flavor} ${JSON.stringify(current)}`).toMatchObject({
          create: [],
          update: [],
          rejected: [],
          trash: [],
        });
      }
    }
  });
});

describe("describeRejections", () => {
  it("names each key with the reason and points to the dashboard", () => {
    const message = describeRejections(
      [
        { key: "PEM", reason: "truncated" },
        { key: "GREETING", reason: "escaped-quote" },
        { key: "b2xkIGRhdGE", reason: "invalid-key" },
      ],
      "https://app.keyway.sh"
    );
    expect(message).toBe(
      "This version of the keyway CLI cannot push these values without corrupting them, so nothing was saved: " +
        "PEM (multi-line value), GREETING (contains escaped quotes), " +
        "b2xkIGRhdGE (key must be uppercase with underscores, e.g. DATABASE_URL). " +
        "Set them from the Keyway dashboard instead: https://app.keyway.sh"
    );
  });

  it("caps the list and the key length", () => {
    const rejected = Array.from({ length: 12 }, (_, i) => ({
      key: `${"X".repeat(50)}${i}`,
      reason: "truncated" as const,
    }));
    const message = describeRejections(rejected);
    expect(message).toContain(`${"X".repeat(40)}… (multi-line value)`);
    expect(message).toContain("and 2 more");
    expect(message.match(/\(multi-line value\)/g)).toHaveLength(10);
    expect(message.endsWith("Set them from the Keyway dashboard instead.")).toBe(true);
  });
});

describe("resolvePushMode", () => {
  it("uses the explicit mode, else merge for the MCP and replace for everything else", () => {
    expect(resolvePushMode("merge", RELEASED_CLI)).toBe("merge");
    expect(resolvePushMode("replace", MCP)).toBe("replace");
    expect(resolvePushMode(undefined, MCP)).toBe("merge");
    expect(resolvePushMode(undefined, "KEYWAY-MCP/2.0.0")).toBe("merge");
    expect(resolvePushMode(undefined, RELEASED_CLI)).toBe("replace");
    expect(resolvePushMode(undefined, undefined)).toBe("replace");
  });
});

describe("isReleasedCli", () => {
  it.each([
    ["keyway-cli/dev", true],
    ["keyway-cli/0.5.3", true],
    ["keyway-cli/0.6.0", true],
    ["keyway-cli/0.6.0-rc.1", true],
    ["keyway-cli/0.6", true],
    ["keyway-cli/cli/v0.6.0", true],
    ["keyway-cli/", true],
    ["KEYWAY-CLI/dev", true],
    ["keyway-cli/0.6.1", false],
    ["keyway-cli/v0.6.1", false],
    ["keyway-cli/cli/v0.6.1-3-gabc1234", false],
    ["keyway-cli/0.6.1-rc.1", false],
    ["keyway-cli/0.7.0", false],
    ["keyway-cli/1.0.0", false],
    ["keyway-mcp/1.0.0", false],
    ["Mozilla/5.0", false],
    [undefined, false],
  ])("%s → %s", (userAgent, expected) => {
    expect(isReleasedCli(userAgent)).toBe(expected);
  });
});
