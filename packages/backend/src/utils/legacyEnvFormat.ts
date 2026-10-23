/**
 * The .env text format exchanged with released clients.
 *
 * GET /v1/secrets/pull serves `toEnvFormat` output. The CLI up to 0.6.0, MCP 1.0.0 and
 * keyway-action read it with a line-based parser that cannot handle multi-line values or
 * escaped quotes, then send what they parsed back on push. `legacyEchoes` reproduces
 * that round trip so the push route can tell a corrupted echo from a real change.
 */

/** Serializer used by GET /v1/secrets/pull. Its output must not change: released clients parse it. */
export function toEnvFormat(secretsMap: Record<string, string>): string {
  return Object.entries(secretsMap)
    .map(([key, value]) => {
      if (value.includes(" ") || value.includes("\n") || value.includes('"')) {
        return `${key}="${value.replace(/"/g, '\\"')}"`;
      }
      return `${key}=${value}`;
    })
    .join("\n");
}

export type LegacyParserFlavor = "go" | "js";

// Go's strings.TrimSpace (unicode.IsSpace) differs from String.prototype.trim:
// it trims U+0085 and keeps U+FEFF.
function isGoSpace(code: number): boolean {
  return (
    (code >= 0x09 && code <= 0x0d) ||
    code === 0x20 ||
    code === 0x85 ||
    code === 0xa0 ||
    code === 0x1680 ||
    (code >= 0x2000 && code <= 0x200a) ||
    code === 0x2028 ||
    code === 0x2029 ||
    code === 0x202f ||
    code === 0x205f ||
    code === 0x3000
  );
}

// Linear scan: a regex such as /\s+$/ is quadratic on long inner whitespace runs, and
// stored values can be 64 KB.
function trim(value: string, flavor: LegacyParserFlavor): string {
  if (flavor === "js") {
    return value.trim();
  }
  let start = 0;
  let end = value.length;
  while (start < end && isGoSpace(value.charCodeAt(start))) {
    start++;
  }
  while (end > start && isGoSpace(value.charCodeAt(end - 1))) {
    end--;
  }
  return value.slice(start, end);
}

/**
 * Parser shipped in the CLI up to 0.6.0 (internal/env/parser.go, "go") and in
 * MCP 1.0.0 and keyway-action ("js").
 */
export function parseLegacyEnv(
  content: string,
  flavor: LegacyParserFlavor
): Record<string, string> {
  // A Go map keeps a "__proto__" key; assigning it on a plain JavaScript object drops it.
  const result: Record<string, string> = flavor === "go" ? Object.create(null) : {};
  for (const rawLine of content.split("\n")) {
    const line = trim(rawLine, flavor);
    if (line === "" || line.startsWith("#")) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = trim(line.slice(0, idx), flavor);
    let value = line.slice(idx + 1);
    // Go requires two characters; the JS parsers also strip a lone quote to "".
    if (
      (flavor === "js" || value.length >= 2) &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    if (key !== "") {
      result[key] = value;
    }
  }
  return result;
}

/** What released clients send back after pulling `env`: one map per parser flavor. */
export function legacyEchoes(env: Record<string, string>): Record<string, string>[] {
  const content = toEnvFormat(env);
  return [parseLegacyEnv(content, "go"), parseLegacyEnv(content, "js")];
}
