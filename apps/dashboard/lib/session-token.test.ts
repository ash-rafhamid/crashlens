import assert from "node:assert/strict";
import test from "node:test";
import { createSessionToken, verifySessionToken } from "./session-token";

test("creates and verifies a signed dashboard session", () => {
  const token = createSessionToken("a-strong-test-secret", "admin", 1_000, 5_000);
  assert.deepEqual(verifySessionToken(token, "a-strong-test-secret", 2_000), {
    userId: "admin",
    expiresAt: 6_000
  });
});

test("rejects tampered, expired, and wrongly signed sessions", () => {
  const token = createSessionToken("correct-secret", "admin", 1_000, 5_000);
  assert.equal(verifySessionToken(`${token}x`, "correct-secret", 2_000), null);
  assert.equal(verifySessionToken(token, "wrong-secret", 2_000), null);
  assert.equal(verifySessionToken(token, "correct-secret", 6_001), null);
});
