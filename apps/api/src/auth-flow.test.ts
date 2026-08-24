import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./build-app.js";
import { MemoryIssueRepository } from "./memory-repository.js";

interface Account {
  email: string;
  password: string;
  token: string;
}

test("supports verified accounts and isolates projects between users", async () => {
  const repository = new MemoryIssueRepository("demo-key");
  await repository.initialize();
  const server = buildApp(repository, {
    emailSender: null,
    exposeAuthTokens: true,
    dashboardUrl: "http://localhost:3000"
  }).listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const baseUrl = "http://127.0.0.1:" + address.port;

  async function request(path: string, init: RequestInit = {}) {
    return fetch(baseUrl + path, {
      ...init,
      headers: { "content-type": "application/json", ...init.headers }
    });
  }

  async function createAccount(name: string, email: string, password: string): Promise<Account> {
    const signup = await request("/api/v1/auth/signup", {
      method: "POST",
      body: JSON.stringify({ name, email, password })
    });
    assert.equal(signup.status, 201);
    const signupBody = (await signup.json()) as { verificationToken: string };
    assert(signupBody.verificationToken);

    const blockedLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    assert.equal(blockedLogin.status, 403);

    const verification = await request("/api/v1/auth/verify-email", {
      method: "POST",
      body: JSON.stringify({ token: signupBody.verificationToken })
    });
    assert.equal(verification.status, 200);

    const login = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    assert.equal(login.status, 200);
    const loginBody = (await login.json()) as { token: string };
    assert(loginBody.token);
    return { email, password, token: loginBody.token };
  }

  try {
    const alice = await createAccount("Alice Developer", "alice@example.com", "AliceSecure123");
    const bob = await createAccount("Bob Developer", "bob@example.com", "BobSecure456");

    const aliceProjectResponse = await request("/api/v1/projects", {
      method: "POST",
      headers: { authorization: "Bearer " + alice.token },
      body: JSON.stringify({ name: "Alice Store" })
    });
    assert.equal(aliceProjectResponse.status, 201);
    const aliceProject = (await aliceProjectResponse.json()) as {
      project: { id: string; name: string };
      apiKey: string;
    };

    const bobProjectResponse = await request("/api/v1/projects", {
      method: "POST",
      headers: { authorization: "Bearer " + bob.token },
      body: JSON.stringify({ name: "Bob Portal" })
    });
    assert.equal(bobProjectResponse.status, 201);

    const aliceProjects = await request("/api/v1/projects", {
      headers: { authorization: "Bearer " + alice.token }
    });
    const aliceProjectsBody = (await aliceProjects.json()) as {
      projects: Array<{ id: string; name: string }>;
    };
    assert.deepEqual(aliceProjectsBody.projects.map((project) => project.name), ["Alice Store"]);

    const bobProjects = await request("/api/v1/projects", {
      headers: { authorization: "Bearer " + bob.token }
    });
    const bobProjectsBody = (await bobProjects.json()) as {
      projects: Array<{ id: string; name: string }>;
    };
    assert.deepEqual(bobProjectsBody.projects.map((project) => project.name), ["Bob Portal"]);

    const forbiddenCrossAccountRead = await request(
      "/api/v1/projects/" + aliceProject.project.id + "/issues",
      { headers: { authorization: "Bearer " + bob.token } }
    );
    assert.equal(forbiddenCrossAccountRead.status, 404);

    const forgot = await request("/api/v1/auth/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: alice.email })
    });
    const forgotBody = (await forgot.json()) as { resetToken: string };
    assert(forgotBody.resetToken);

    const reset = await request("/api/v1/auth/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: forgotBody.resetToken, password: "AliceChanged789" })
    });
    assert.equal(reset.status, 200);

    const expiredOldSession = await request("/api/v1/auth/me", {
      headers: { authorization: "Bearer " + alice.token }
    });
    assert.equal(expiredOldSession.status, 401);

    const newLogin = await request("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: alice.email, password: "AliceChanged789" })
    });
    assert.equal(newLogin.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve()))
    );
    await repository.close();
  }
});
