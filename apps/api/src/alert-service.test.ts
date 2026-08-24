import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { deliverAlert } from "./alert-service.js";
import { MemoryIssueRepository } from "./memory-repository.js";

test("delivers a signed webhook and records successful delivery", async () => {
  let receivedBody = "";
  let receivedSignature = "";
  const webhook = createServer((request, response) => {
    receivedSignature = String(request.headers["x-crashlens-signature"] ?? "");
    request.setEncoding("utf8");
    request.on("data", (chunk) => { receivedBody += chunk; });
    request.on("end", () => {
      response.statusCode = 204;
      response.end();
    });
  });
  webhook.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => webhook.once("listening", resolve));

  const repository = new MemoryIssueRepository("webhook-test-key");
  await repository.initialize();
  const alert = await repository.createAlert(
    "demo-project",
    "issue-1",
    "new_issue",
    "New issue: Checkout crashed",
    "First occurrence"
  );
  const secret = "webhook-test-secret";
  const port = (webhook.address() as AddressInfo).port;

  try {
    await deliverAlert(repository, alert, {
      webhookUrl: `http://127.0.0.1:${port}/alerts`,
      webhookSecret: secret
    });
    const stored = await repository.listAlerts("demo-project");
    assert.equal(stored[0]?.deliveryStatus, "delivered");
    assert.equal(
      receivedSignature,
      createHmac("sha256", secret).update(receivedBody).digest("hex")
    );
    assert.equal((JSON.parse(receivedBody) as { source: string }).source, "crashlens");
  } finally {
    await new Promise<void>((resolve, reject) =>
      webhook.close((error) => (error ? reject(error) : resolve()))
    );
    await repository.close();
  }
});
