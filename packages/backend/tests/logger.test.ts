import { describe, it, expect } from "vitest";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { sanitizeError } from "../src/utils/logger";
import { scrubQueryParams } from "../src/utils/sentry";

// A failed push UPDATE: drizzle puts every bound value in the message.
const failed = () =>
  new DrizzleQueryError(
    "update secrets set encrypted_value = v.encrypted_value from (values ($1, $2)) v",
    ["ciphertext-1", "key-name-1"],
    new Error("value out of range")
  );

describe("sanitizeError", () => {
  it("keeps the failed query but not its bound values", () => {
    const sanitized = sanitizeError(failed());
    expect(sanitized.message).toContain("Failed query: update secrets");
    expect(sanitized.message).not.toMatch(/ciphertext-1|key-name-1/);
    expect(sanitized.cause.message).toBe("value out of range");
  });
});

describe("scrubQueryParams", () => {
  it("removes bound values from the error sent to Sentry", () => {
    const error = failed();
    const event = scrubQueryParams({
      type: undefined,
      message: error.message,
      exception: { values: [{ type: "DrizzleQueryError", value: error.message }] },
    });
    expect(JSON.stringify(event)).not.toMatch(/ciphertext-1|key-name-1/);
    expect(event.exception!.values![0].value).toContain("Failed query: update secrets");
  });
});
