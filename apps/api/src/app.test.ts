import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { buildApp } from "./app.js";
import { MemoryIssueRepository } from "./memory-repository.js";

const apiKey = "test_project_key";
const adminKey = "test_admin_key";

test("accepts, groups, lists, and resolves error events", async () => {
  const repository = new MemoryIssueRepository(apiKey);
  await repository.initialize();
  const server = buildApp(repository, { adminApiKey: adminKey }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const headers = { "content-type": "application/json", "x-crashlens-key": apiKey };
  const adminHeaders = {
    "content-type": "application/json",
    "x-crashlens-admin-key": adminKey
  };
  const adminProjectUrl = `${baseUrl}/api/v1/admin/projects/demo-project`;

  try {
    const event = {
      type: "Error",
      message: "Payment failed",
      stack: "Error: Payment failed\n    at pay (payment.ts:84:12)",
      timestamp: new Date().toISOString(),
      release: "3.2.0",
      userId: "user-42",
      browser: {
        name: "Brave",
        version: "151.0.0.0",
        engine: "Blink",
        operatingSystem: "Windows",
        deviceType: "Desktop"
      },
      context: { paymentMethod: "bKash", password: "must-not-be-stored" }
    };

    const first = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event)
    });
    const second = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event)
    });
    const third = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...event, userId: "user-43" })
    });
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal(third.status, 202);

    const listResponse = await fetch(`${adminProjectUrl}/issues`, { headers: adminHeaders });
    const list = (await listResponse.json()) as {
      issues: Array<{ id: string; occurrenceCount: number; affectedUsers: number; status: string }>;
    };
    assert.equal(list.issues.length, 1);
    assert.equal(list.issues[0]?.occurrenceCount, 3);
    assert.equal(list.issues[0]?.affectedUsers, 2);

    const issueId = list.issues[0]?.id;
    assert.ok(issueId);
    const detailResponse = await fetch(`${adminProjectUrl}/issues/${issueId}`, {
      headers: adminHeaders
    });
    const detail = (await detailResponse.json()) as {
      issue: {
        events: Array<{
          browser?: { name: string };
          context?: Record<string, unknown>;
        }>;
      };
    };
    assert.equal(detail.issue.events[0]?.context?.password, "[Redacted]");
    assert.equal(detail.issue.events[0]?.browser?.name, "Brave");

    const statusResponse = await fetch(`${adminProjectUrl}/issues/${issueId}/status`, {
      method: "PATCH",
      headers: adminHeaders,
      body: JSON.stringify({ status: "resolved" })
    });
    assert.equal(statusResponse.status, 200);

    const regressionEvent = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers,
      body: JSON.stringify(event)
    });
    assert.equal(regressionEvent.status, 202);
    const regressionListResponse = await fetch(`${adminProjectUrl}/issues`, {
      headers: adminHeaders
    });
    const regressionList = (await regressionListResponse.json()) as {
      issues: Array<{ occurrenceCount: number; status: string }>;
    };
    assert.equal(regressionList.issues[0]?.occurrenceCount, 4);
    assert.equal(regressionList.issues[0]?.status, "regressed");
    const generatedAlerts = await repository.listAlerts("demo-project");
    assert.deepEqual(
      generatedAlerts.map((alert) => alert.kind),
      ["regression", "new_issue"]
    );

    const successfulCheckout = await fetch(`${baseUrl}/demo/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "success",
        product: "Cloud Runner",
        paymentMethod: "bKash",
        customerId: "customer-10"
      })
    });
    assert.equal(successfulCheckout.status, 200);
    const successfulBody = (await successfulCheckout.json()) as { orderId?: string };
    assert.match(successfulBody.orderId ?? "", /^CARTLY-/);

    const failedCheckout = await fetch(`${baseUrl}/demo/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scenario: "gateway-down",
        product: "Cloud Runner",
        paymentMethod: "bKash",
        customerId: "customer-10"
      })
    });
    assert.equal(failedCheckout.status, 503);
    const failedBody = (await failedCheckout.json()) as { code?: string };
    assert.equal(failedBody.code, "GATEWAY_UNAVAILABLE");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await repository.close();
  }
});

test("manages isolated projects, rotates SDK keys, and records alerts", async () => {
  const repository = new MemoryIssueRepository(apiKey);
  await repository.initialize();
  const server = buildApp(repository, { adminApiKey: adminKey }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const adminHeaders = {
    "content-type": "application/json",
    "x-crashlens-admin-key": adminKey
  };

  try {
    const unauthorized = await fetch(`${baseUrl}/api/v1/admin/projects`);
    assert.equal(unauthorized.status, 401);

    const createResponse = await fetch(`${baseUrl}/api/v1/admin/projects`, {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ name: "Acme Banking Portal" })
    });
    assert.equal(createResponse.status, 201);
    const created = (await createResponse.json()) as {
      project: { id: string; name: string; slug: string };
      apiKey: string;
    };
    assert.equal(created.project.name, "Acme Banking Portal");
    assert.match(created.project.slug, /^acme-banking-portal-/);
    assert.match(created.apiKey, /^cl_live_/);

    const eventResponse = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-crashlens-key": created.apiKey
      },
      body: JSON.stringify({
        type: "TypeError",
        message: "Cannot read account balance",
        stack: "TypeError: Cannot read account balance\n    at loadBalance (account.ts:41:9)",
        timestamp: new Date().toISOString(),
        release: "1.0.0"
      })
    });
    assert.equal(eventResponse.status, 202);

    const sdkCannotReadIssues = await fetch(`${baseUrl}/api/v1/issues`, {
      headers: { "x-crashlens-key": created.apiKey }
    });
    assert.equal(sdkCannotReadIssues.status, 404);

    const projectIssues = await fetch(
      `${baseUrl}/api/v1/admin/projects/${created.project.id}/issues`,
      { headers: adminHeaders }
    );
    const issueBody = (await projectIssues.json()) as { issues: Array<{ title: string }> };
    assert.equal(issueBody.issues.length, 1);
    assert.equal(issueBody.issues[0]?.title, "Cannot read account balance");

    const demoProjects = await fetch(`${baseUrl}/api/v1/admin/projects`, {
      headers: adminHeaders
    });
    const projects = (await demoProjects.json()) as { projects: Array<{ id: string }> };
    const demoProject = projects.projects.find((project) => project.id === "demo-project");
    assert.ok(demoProject);
    const demoIssues = await fetch(
      `${baseUrl}/api/v1/admin/projects/${demoProject.id}/issues`,
      { headers: adminHeaders }
    );
    const demoBody = (await demoIssues.json()) as { issues: unknown[] };
    assert.equal(demoBody.issues.length, 0);

    const alertsResponse = await fetch(
      `${baseUrl}/api/v1/admin/projects/${created.project.id}/alerts`,
      { headers: adminHeaders }
    );
    const alerts = (await alertsResponse.json()) as {
      alerts: Array<{ kind: string; deliveryStatus: string }>;
    };
    assert.equal(alerts.alerts.length, 1);
    assert.equal(alerts.alerts[0]?.kind, "new_issue");
    assert.equal(alerts.alerts[0]?.deliveryStatus, "stored");

    const rotateResponse = await fetch(
      `${baseUrl}/api/v1/admin/projects/${created.project.id}/rotate-key`,
      { method: "POST", headers: adminHeaders }
    );
    assert.equal(rotateResponse.status, 200);
    const rotated = (await rotateResponse.json()) as { apiKey: string };
    assert.notEqual(rotated.apiKey, created.apiKey);

    const oldKeyResponse = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-crashlens-key": created.apiKey
      },
      body: JSON.stringify({ message: "Old key should fail" })
    });
    assert.equal(oldKeyResponse.status, 401);

    const newKeyResponse = await fetch(`${baseUrl}/api/v1/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-crashlens-key": rotated.apiKey
      },
      body: JSON.stringify({ message: "New key works" })
    });
    assert.equal(newKeyResponse.status, 202);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await repository.close();
  }
});
