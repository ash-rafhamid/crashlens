import assert from "node:assert/strict";
import test from "node:test";
import CrashLens from "./index.js";

test("sends a normalized error event to the configured endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "";
  let requestBody: Record<string, unknown> = {};

  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal((init?.headers as Record<string, string>)["x-crashlens-key"], "test-key");
    return new Response(null, { status: 202 });
  };

  try {
    CrashLens.init({
      apiKey: "test-key",
      dsn: "https://api.example.com",
      release: "1.0.0"
    });
    const sent = await CrashLens.captureException(new Error("Checkout failed"), {
      extra: { paymentMethod: "bKash" }
    });
    assert.equal(sent, true);
    assert.equal(requestUrl, "https://api.example.com/api/v1/events");
    assert.equal(requestBody.message, "Checkout failed");
    assert.equal(requestBody.release, "1.0.0");
    assert.deepEqual(requestBody.context, { paymentMethod: "bKash" });
    const detectedBrowser = await CrashLens.getBrowserInfo();
    assert.ok(detectedBrowser === undefined || typeof detectedBrowser.name === "string");
  } finally {
    CrashLens.close();
    globalThis.fetch = originalFetch;
  }
});
