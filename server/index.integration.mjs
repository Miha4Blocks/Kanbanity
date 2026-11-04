import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const entrypoint = join(rootDirectory, "server", "index.mjs");

async function findAvailablePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Не удалось определить свободный порт");
  await new Promise((resolveClose, reject) => {
    server.close((error) => (error ? reject(error) : resolveClose()));
  });
  return address.port;
}

async function startServer(databasePath, port) {
  const child = spawn(process.execPath, [entrypoint], {
    cwd: rootDirectory,
    env: { ...process.env, DATABASE_PATH: databasePath, HOST: "127.0.0.1", PORT: String(port) },
    stdio: "ignore",
  });
  const baseUrl = `http://127.0.0.1:${port}`;

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Сервер завершился с кодом ${child.exitCode}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return { child, baseUrl };
    } catch {
      await delay(100);
    }
  }

  child.kill();
  throw new Error("Сервер не запустился за 6 секунд");
}

async function stopServer(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await Promise.race([exit, delay(3000)]);
}

test("авторизация изолирует состояние аккаунтов и сохраняет сессии после перезапуска", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "kanbanity-sqlite-test-"));
  const databasePath = join(tempDirectory, "kanbanity.sqlite");
  const port = await findAvailablePort();
  const legacyState = {
    projects: [{
      id: "legacy-project",
      name: "Старый проект",
      icon: "✳",
      color: "purple",
      description: "Перенос старых данных",
      schedule: "Без срока",
      prefix: "OLD",
    }],
    boardsByProject: {
      "legacy-project": {
        columns: [{ id: "todo", title: "К выполнению" }],
        tasksByColumn: { todo: [{ id: "OLD-1", title: "Старая задача" }] },
      },
    },
    workspaceSettings: { name: "Старое пространство", description: "Старые данные" },
    activity: [{ id: "activity-1", message: "Создана задача", time: "сейчас" }],
    readNotificationIds: [],
  };
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      state_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  legacyDatabase.prepare("INSERT INTO app_state (id, state_json) VALUES (1, ?)").run(JSON.stringify(legacyState));
  legacyDatabase.close();
  let server = await startServer(databasePath, port);

  const userAState = {
    projects: [{
      id: "a-project",
      name: "Проект пользователя A",
      icon: "◈",
      color: "purple",
      description: "Приватная доска A",
      schedule: "Без срока",
      prefix: "USR",
    }],
    boardsByProject: {
      "a-project": {
        columns: [{ id: "todo", title: "К выполнению" }],
        tasksByColumn: {
          todo: [{ id: "USR-1", title: "Задача A" }],
        },
      },
    },
    workspaceSettings: { name: "Пространство A", description: "Приватное A" },
    activity: [{ id: "activity-a", message: "Создана задача A", time: "сейчас" }],
    readNotificationIds: [],
  };
  const userBState = {
    projects: [{
      id: "b-project",
      name: "Проект пользователя B",
      icon: "◌",
      color: "blue",
      description: "Приватная доска B",
      schedule: "Без срока",
      prefix: "USR",
    }],
    boardsByProject: {
      "b-project": {
        columns: [{ id: "todo", title: "К выполнению" }],
        tasksByColumn: { todo: [{ id: "USR-1", title: "Задача B" }] },
      },
    },
    workspaceSettings: { name: "Пространство B", description: "Приватное B" },
    activity: [{ id: "activity-b", message: "Создана задача B", time: "сейчас" }],
    readNotificationIds: [],
  };

  try {
    const pageResponse = await fetch(`${server.baseUrl}/`);
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get("cache-control") ?? "", /no-store/);
    assert.equal(pageResponse.headers.get("pragma"), "no-cache");
    assert.equal(pageResponse.headers.get("expires"), "0");

    const anonymousSession = await fetch(`${server.baseUrl}/api/auth/session`);
    assert.deepEqual(await anonymousSession.json(), { user: null });
    const anonymousState = await fetch(`${server.baseUrl}/api/state`);
    assert.equal(anonymousState.status, 401);

    const invalidRegistration = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "broken@example.com", name: "Bad", password: "short" }),
    });
    assert.equal(invalidRegistration.status, 400);
    const crossOriginRegistration = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://attacker.example" },
      body: JSON.stringify({ email: "attacker@example.com", name: "Attacker", password: "a-secure-password" }),
    });
    assert.equal(crossOriginRegistration.status, 403);

    const registrationA = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "A@example.com", name: "Пользователь A", password: "a-secure-password" }),
    });
    assert.equal(registrationA.status, 201);
    const cookieA = registrationA.headers.get("set-cookie")?.split(";")[0];
    assert.match(registrationA.headers.get("set-cookie") ?? "", /HttpOnly/);
    assert.match(registrationA.headers.get("set-cookie") ?? "", /SameSite=Lax/);
    assert.ok(cookieA);
    const accountA = await registrationA.json();
    assert.equal(accountA.user.email, "a@example.com");

    const migratedState = await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: cookieA } });
    assert.deepEqual((await migratedState.json()).state, legacyState);
    const saveA = await fetch(`${server.baseUrl}/api/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookieA },
      body: JSON.stringify({ state: userAState }),
    });
    assert.equal(saveA.status, 200);

    const duplicateEmail = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", name: "Повтор", password: "a-secure-password" }),
    });
    assert.equal(duplicateEmail.status, 409);

    const registrationB = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "b@example.com", name: "Пользователь B", password: "another-secure-password" }),
    });
    assert.equal(registrationB.status, 201);
    const cookieB = registrationB.headers.get("set-cookie")?.split(";")[0];
    assert.ok(cookieB);
    const emptyStateB = await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: cookieB } });
    assert.equal((await emptyStateB.json()).state, null);

    const saveB = await fetch(`${server.baseUrl}/api/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: cookieB },
      body: JSON.stringify({ state: userBState }),
    });
    assert.equal(saveB.status, 200);
    const readA = await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: cookieA } });
    assert.deepEqual((await readA.json()).state, userAState);
    const readB = await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: cookieB } });
    assert.deepEqual((await readB.json()).state, userBState);

    const badLogin = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@example.com", password: "wrong-password" }),
    });
    assert.equal(badLogin.status, 401);
    const loginA = await fetch(`${server.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "A@example.com", password: "a-secure-password" }),
    });
    assert.equal(loginA.status, 200);
    const reloginCookieA = loginA.headers.get("set-cookie")?.split(";")[0];
    assert.ok(reloginCookieA);

    const logoutB = await fetch(`${server.baseUrl}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookieB },
    });
    assert.equal(logoutB.status, 200);
    const revokedStateB = await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: cookieB } });
    assert.equal(revokedStateB.status, 401);

    await stopServer(server.child);
    server = await startServer(databasePath, port);
    const afterRestartResponse = await fetch(`${server.baseUrl}/api/state`, { headers: { Cookie: reloginCookieA } });
    assert.deepEqual((await afterRestartResponse.json()).state, userAState);
  } finally {
    await stopServer(server.child);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
