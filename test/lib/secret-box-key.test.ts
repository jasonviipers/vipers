import { describe, expect, it } from "bun:test";

import { decodeSecretBoxKey, secretBoxKeySchema } from "@/lib/secret-box-key";

describe("decodeSecretBoxKey", () => {
  it("accepts base64 that decodes to exactly 32 bytes", () => {
    const valid = Buffer.from("k".repeat(32)).toString("base64");
    const decoded = decodeSecretBoxKey(valid);
    expect(decoded).not.toBeNull();
    expect(decoded?.length).toBe(32);
  });

  it("rejects the 48-byte regression that caused the raw-500 on credential save", () => {
    // openssl rand -base64 48 output shape: decodes to 48 bytes.
    const invalid = Buffer.from("k".repeat(48)).toString("base64");
    expect(decodeSecretBoxKey(invalid)).toBeNull();
  });

  it("rejects keys one byte short or long", () => {
    expect(decodeSecretBoxKey(Buffer.alloc(31).toString("base64"))).toBeNull();
    expect(decodeSecretBoxKey(Buffer.alloc(33).toString("base64"))).toBeNull();
  });

  it("treats absent, empty, and whitespace as unset (dev fallback territory)", () => {
    expect(decodeSecretBoxKey(undefined)).toBeNull();
    expect(decodeSecretBoxKey("")).toBeNull();
    expect(decodeSecretBoxKey("   ")).toBeNull();
  });

  it("rejects non-base64 garbage", () => {
    expect(decodeSecretBoxKey("!!!not-base64!!!")).toBeNull();
  });
});

describe("secretBoxKeySchema", () => {
  it("passes a valid key", () => {
    const valid = Buffer.from("k".repeat(32)).toString("base64");
    expect(secretBoxKeySchema.safeParse(valid).success).toBe(true);
  });

  it("fails a present-but-invalid key with the actionable message", () => {
    const invalid = Buffer.from("k".repeat(48)).toString("base64");
    const result = secretBoxKeySchema.safeParse(invalid);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toContain(
        "openssl rand -base64 32",
      );
    }
  });

  it("fails an empty string (presence with no value is a misconfiguration)", () => {
    expect(secretBoxKeySchema.safeParse("").success).toBe(false);
  });
});
