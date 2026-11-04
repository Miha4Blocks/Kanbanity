import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = resolve(process.env.DATABASE_PATH ?? resolve(rootDirectory, "data", "kanbanity.sqlite"));
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const distDirectory = resolve(rootDirectory, "dist");
const maxRequestBytes = 25 * 1024 * 1024;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

await mkdir(dirname(databasePath), { recursive: true });

const database = new DatabaseSync(databasePath);
database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

function respondJson(response, status, payload) {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(JSON.stringify(payload));
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAppState(value) {
  return (
    isRecord(value) &&
    (value.projects === undefined ||
      (Array.isArray(value.projects) &&
        value.projects.every(
          (project) =>
            isRecord(project) &&
            typeof project.id === "string" &&
            typeof project.name === "string" &&
            typeof project.icon === "string" &&
            ["purple", "orange", "blue"].includes(project.color) &&
            typeof project.description === "string" &&
            typeof project.schedule === "string" &&
            typeof project.prefix === "string",
        ))) &&
    isRecord(value.boardsByProject) &&
    Object.values(value.boardsByProject).every(
      (board) =>
        isRecord(board) &&
        Array.isArray(board.columns) &&
        isRecord(board.tasksByColumn),
    ) &&
    isRecord(value.workspaceSettings) &&
    typeof value.workspaceSettings.name === "string" &&
    typeof value.workspaceSettings.description === "string" &&
    Array.isArray(value.activity) &&
    value.activity.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.message === "string" &&
        typeof item.time === "string",
    ) &&
    Array.isArray(value.readNotificationIds) &&
    value.readNotificationIds.every((id) => typeof id === "string")
  );
}

async function readJsonBody(request) {
  const chunks = [];
  let bytesRead = 0;

  for await (const chunk of request) {
    bytesRead += chunk.length;
    if (bytesRead > maxRequestBytes) {
      const error = new Error("Размер запроса превышает 25 МБ");
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Тело запроса должно содержать корректный JSON");
    error.statusCode = 400;
    throw error;
  }
}

async function serveStaticFile(requestPath, response) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return false;
  }

  const candidate = resolve(distDirectory, `.${decodedPath}`);
  const relativePath = relative(distDirectory, candidate);
  if (isAbsolute(relativePath) || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    return false;
  }

  try {
    const fileInfo = await stat(candidate);
    if (!fileInfo.isFile()) return false;
    const contents = await readFile(candidate);
    response.writeHead(200, {
      "Cache-Control": extname(candidate) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
      "Content-Type": mimeTypes[extname(candidate)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(contents);
    return true;
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return false;
    throw error;
  }
}

const server = createServer((request, response) => {
  void (async () => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (requestUrl.pathname === "/api/health" && request.method === "GET") {
      database.prepare("SELECT 1").get();
      respondJson(response, 200, { status: "ok", database: "sqlite" });
      return;
    }

    if (requestUrl.pathname === "/api/state" && request.method === "GET") {
      const row = database.prepare("SELECT state_json, updated_at FROM app_state WHERE id = 1").get();
      respondJson(response, 200, {
        state: row ? JSON.parse(row.state_json) : null,
        updatedAt: row?.updated_at ?? null,
      });
      return;
    }

    if (requestUrl.pathname === "/api/state" && request.method === "PUT") {
      const body = await readJsonBody(request);
      if (!isRecord(body) || !isAppState(body.state)) {
        respondJson(response, 400, { error: "Структура состояния приложения некорректна" });
        return;
      }

      const stateJson = JSON.stringify(body.state);
      database
        .prepare(
          `INSERT INTO app_state (id, state_json, updated_at)
           VALUES (1, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(id) DO UPDATE SET
             state_json = excluded.state_json,
             updated_at = excluded.updated_at`,
        )
        .run(stateJson);
      respondJson(response, 200, { saved: true });
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      respondJson(response, 404, { error: "API-маршрут не найден" });
      return;
    }

    if (request.method === "GET") {
      const served = await serveStaticFile(requestUrl.pathname, response);
      if (served) return;
      if (await serveStaticFile("/index.html", response)) return;
    }

    respondJson(response, 404, { error: "Страница не найдена" });
  })().catch((error) => {
    console.error("Ошибка HTTP-сервера Kanbanity:", error);
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    respondJson(response, error.statusCode ?? 500, {
      error: error.statusCode ? error.message : "Внутренняя ошибка сервера",
    });
  });
});

server.on("error", (error) => {
  console.error("Не удалось запустить HTTP-сервер Kanbanity:", error);
  database.close();
  process.exitCode = 1;
});

server.listen(port, host, () => {
  console.log(`Kanbanity API и SQLite запущены: http://${host}:${port}`);
  console.log(`Файл базы данных: ${databasePath}`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error("Ошибка при остановке HTTP-сервера:", error);
      process.exitCode = 1;
    }
    database.close();
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
