import { describe, it, expect } from "vitest";
import { toEnvFormat, parseLegacyEnv, legacyEchoes } from "../src/utils/legacyEnvFormat";
import released from "./fixtures/legacy-env-parse.json";

// Multi-line value whose third line contains "=", like base64 padding.
const MULTI = "first line\nsecond line\nZm9vYmFy==\nlast line";
const QUOTED = 'say "hi"';

describe("toEnvFormat (served by GET /v1/secrets/pull)", () => {
  it("keeps its exact output", () => {
    expect(
      toEnvFormat({
        A: "x",
        B: "a b",
        C: QUOTED,
        D: "l1\nl2",
        E: "",
        F: "a#b",
        G: "a\tb",
        H: "it's",
        I: "C:\\dir\\",
        J: "a\rb",
      })
    ).toBe(
      'A=x\nB="a b"\nC="say \\"hi\\""\nD="l1\nl2"\nE=\nF=a#b\nG=a\tb\nH=it\'s\nI=C:\\dir\\\nJ=a\rb'
    );
  });
});

describe("parseLegacyEnv (released CLI, MCP and keyway-action)", () => {
  it("matches the released parsers on every recorded vector", () => {
    expect(released.vectors.length).toBeGreaterThan(200);
    released.vectors.forEach((vector, i) => {
      expect(parseLegacyEnv(vector.content, "go"), `go vector ${i}`).toEqual(vector.go);
      expect(parseLegacyEnv(vector.content, "js"), `js vector ${i}`).toEqual(vector.js);
    });
  });

  it("skips comments and blank lines, strips matching quotes, keeps later = signs", () => {
    const content = "# K=commented\n\nA=1\nB=\"two words\"\nC='single'\nD=a=b\r\n";
    for (const flavor of ["go", "js"] as const) {
      expect(parseLegacyEnv(content, flavor)).toEqual({
        A: "1",
        B: "two words",
        C: "single",
        D: "a=b",
      });
    }
  });

  it("trims the key but keeps spaces after =, the export prefix and inline comments", () => {
    for (const flavor of ["go", "js"] as const) {
      expect(parseLegacyEnv("  K = v  \n=no-key\nexport X=1\nY=v # note", flavor)).toEqual({
        K: " v",
        "export X": "1",
        Y: "v # note",
      });
    }
  });

  it("reproduces the multi-line defect: first line with a leading quote, plus a phantom key", () => {
    expect(parseLegacyEnv(toEnvFormat({ MULTI }), "go")).toEqual({
      MULTI: '"first line',
      Zm9vYmFy: "=",
    });
  });

  it("reproduces the escaped quote defect: backslashes are kept", () => {
    expect(parseLegacyEnv(toEnvFormat({ QUOTED }), "go")).toEqual({ QUOTED: 'say \\"hi\\"' });
  });

  it("trims like Go (U+0085) or like JavaScript (U+FEFF)", () => {
    expect(parseLegacyEnv("A=x\u0085", "go")).toEqual({ A: "x" });
    expect(parseLegacyEnv("A=x\u0085", "js")).toEqual({ A: "x\u0085" });
    expect(parseLegacyEnv("A=x\uFEFF", "go")).toEqual({ A: "x\uFEFF" });
    expect(parseLegacyEnv("A=x\uFEFF", "js")).toEqual({ A: "x" });
  });

  it("strips a lone quote like JavaScript, keeps it like Go", () => {
    expect(parseLegacyEnv('U="', "go")).toEqual({ U: '"' });
    expect(parseLegacyEnv('U="', "js")).toEqual({ U: "" });
  });
});

describe("legacyEchoes", () => {
  it("returns what released clients send back after pulling an environment", () => {
    const echoes = legacyEchoes({ MULTI, QUOTED, PLAIN: "ok" });
    expect(echoes).toHaveLength(2);
    for (const echo of echoes) {
      expect(echo).toEqual({
        MULTI: '"first line',
        Zm9vYmFy: "=",
        QUOTED: 'say \\"hi\\"',
        PLAIN: "ok",
      });
    }
  });

  it("returns the Go echo first and the JavaScript echo second", () => {
    // Unquoted value, so the BOM ends the line: Go keeps it, JavaScript trims it.
    expect(legacyEchoes({ K: "ab\uFEFF" })).toEqual([{ K: "ab\uFEFF" }, { K: "ab" }]);
  });
});
