import assert from "node:assert/strict";
import { once } from "node:events";
import { spawn } from "node:child_process";
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

test("SQLite API сохраняет состояние после перезапуска и отклоняет некорректные данные", async () => {
  const tempDirectory = await mkdtemp(join(tmpdir(), "kanbanity-sqlite-test-"));
  const databasePath = join(tempDirectory, "kanbanity.sqlite");
  const port = await findAvailablePort();
  let server = await startServer(databasePath, port);

  const state = {
    projects: [{
      id: "redesign",
      name: "Редизайн платформы",
      icon: "✳",
      color: "purple",
      description: "Новый опыт для пользователей",
      schedule: "Без срока",
      prefix: "RED",
    }],
    boardsByProject: {
      redesign: {
        columns: [{ id: "todo", title: "К выполнению" }],
        tasksByColumn: {
          todo: [{ id: "KAN-1", title: "Сохранённая задача" }],
        },
      },
    },
    workspaceSettings: { name: "Kanbanity QA", description: "Тест базы" },
    activity: [{ id: "activity-1", message: "Создана задача", time: "сейчас" }],
    readNotificationIds: [],
  };

  try {
    const emptyResponse = await fetch(`${server.baseUrl}/api/state`);
    assert.equal(emptyResponse.status, 200);
    assert.equal((await emptyResponse.json()).state, null);

    const invalidResponse = await fetch(`${server.baseUrl}/api/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: { boardsByProject: {} } }),
    });
    assert.equal(invalidResponse.status, 400);

    const saveResponse = await fetch(`${server.baseUrl}/api/state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });
    assert.equal(saveResponse.status, 200);
    assert.deepEqual(await saveResponse.json(), { saved: true });

    const readResponse = await fetch(`${server.baseUrl}/api/state`);
    assert.deepEqual((await readResponse.json()).state, state);

    await stopServer(server.child);
    server = await startServer(databasePath, port);

    const afterRestartResponse = await fetch(`${server.baseUrl}/api/state`);
    assert.deepEqual((await afterRestartResponse.json()).state, state);
  } finally {
    await stopServer(server.child);
    await rm(tempDirectory, { recursive: true, force: true });
  }
});
