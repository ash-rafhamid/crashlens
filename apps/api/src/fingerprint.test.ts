import assert from "node:assert/strict";
import test from "node:test";
import { createFingerprint, findCulprit } from "./fingerprint.js";

test("groups the same error when only line numbers change", () => {
  const first = createFingerprint("Error", "Payment failed", "at pay (payment.ts:84:12)");
  const second = createFingerprint("Error", "Payment failed", "at pay (payment.ts:85:18)");
  assert.equal(first, second);
});

test("ignores development cache-busting query strings in stack frames", () => {
  const first = createFingerprint(
    "Error",
    "Inventory reservation failed",
    "at reserve (http://localhost:3001/src/App.tsx?t=100:23:13)"
  );
  const second = createFingerprint(
    "Error",
    "Inventory reservation failed",
    "at reserve (http://localhost:3001/src/App.tsx?t=999:23:13)"
  );
  assert.equal(first, second);
});

test("keeps different error messages in different groups", () => {
  const payment = createFingerprint("Error", "Payment failed", "at pay (payment.ts:84:12)");
  const login = createFingerprint("Error", "Login failed", "at pay (payment.ts:84:12)");
  assert.notEqual(payment, login);
});

test("finds a useful stack frame", () => {
  assert.equal(findCulprit("Error: failed\n    at pay (payment.ts:84:12)"), "at pay (payment.ts:84:12)");
});

test("removes development cache-busting text from the displayed culprit", () => {
  assert.equal(
    findCulprit("Error: failed\n    at http://localhost:3001/src/App.tsx?t=999:23:13"),
    "at http://localhost:3001/src/App.tsx:23:13"
  );
});
