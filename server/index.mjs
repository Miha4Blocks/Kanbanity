import { createServer } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const databasePath = resolve(process.env.DATABASE_PATH ?? resolve(rootDirectory, "data", "kanbanity.sqlite"));
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "127.0.0.1";
const distDirectory = resolve(rootDirectory, "dist");
const maxRequestBytes = 25 * 1024 * 1024;
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const authAttemptLimit = 10;
const authAttemptWindowMs = 15 * 60 * 1000;
const authAttempts = new Map();
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
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_app_state (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
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

function getSessionToken(request) {
  const cookie = request.headers.cookie ?? "";
  const sessionCookie = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("kanbanity_session="));
  const token = sessionCookie?.slice("kanbanity_session=".length);
  return token && /^[a-f0-9]{64}$/.test(token) ? token : null;
}

function getAuthenticatedUser(request) {
  const token = getSessionToken(request);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = database.prepare(
    `SELECT users.id, users.email, users.display_name
     FROM auth_sessions
     JOIN users ON users.id = auth_sessions.user_id
     WHERE auth_sessions.token_hash = ? AND auth_sessions.expires_at > ?`,
  ).get(tokenHash, new Date().toISOString());
  if (!row) return null;
  return { id: row.id, email: row.email, name: row.display_name };
}

function setSessionCookie(request, response, token) {
  const host = request.headers.host ?? "";
  const secure = process.env.NODE_ENV === "production" ||
    request.headers["x-forwarded-proto"]?.split(",")[0].trim() === "https" ||
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  response.setHeader(
    "Set-Cookie",
    `kanbanity_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(request, response) {
  const host = request.headers.host ?? "";
  const secure = process.env.NODE_ENV === "production" ||
    request.headers["x-forwarded-proto"]?.split(",")[0].trim() === "https" ||
    !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  response.setHeader(
    "Set-Cookie",
    `kanbanity_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`,
  );
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function checkAuthRateLimit(request) {
  const now = Date.now();
  const address = request.socket.remoteAddress ?? "unknown";
  const attempts = (authAttempts.get(address) ?? []).filter((timestamp) => now - timestamp < authAttemptWindowMs);
  if (attempts.length >= authAttemptLimit) {
    authAttempts.set(address, attempts);
    return false;
  }
  attempts.push(now);
  authAttempts.set(address, attempts);
  if (authAttempts.size > 1000) {
    for (const [key, timestamps] of authAttempts) {
      if (timestamps.every((timestamp) => now - timestamp >= authAttemptWindowMs)) authAttempts.delete(key);
    }
  }
  return true;
}

function createSession(request, response, userId) {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + sessionLifetimeMs).toISOString();
  database.prepare("INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(tokenHash, userId, expiresAt);
  database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(new Date().toISOString());
  setSessionCookie(request, response, token);
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function isValidEmail(value) {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    const isHtml = extname(candidate) === ".html";
    response.writeHead(200, {
      "Cache-Control": isHtml
        ? "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0"
        : "public, max-age=31536000, immutable",
      ...(isHtml ? { Expires: "0", Pragma: "no-cache" } : {}),
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

    if (requestUrl.pathname === "/api/auth/session" && request.method === "GET") {
      database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(new Date().toISOString());
      respondJson(response, 200, { user: getAuthenticatedUser(request) });
      return;
    }

    if (
      (requestUrl.pathname === "/api/auth/register" || requestUrl.pathname === "/api/auth/login") &&
      request.method === "POST"
    ) {
      if (!isSameOrigin(request)) {
        respondJson(response, 403, { error: "Запрос отклонён" });
        return;
      }
      if (!checkAuthRateLimit(request)) {
        respondJson(response, 429, { error: "Слишком много попыток. Попробуйте позже." });
        return;
      }

      const body = await readJsonBody(request);
      if (!isRecord(body)) {
        respondJson(response, 400, { error: "Некорректные данные запроса" });
        return;
      }
      const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
      const password = typeof body.password === "string" ? body.password : "";

      if (requestUrl.pathname === "/api/auth/register") {
        const name = typeof body.name === "string" ? body.name.trim() : "";
        if (!isValidEmail(email) || password.length < 10 || password.length > 128 || name.length < 1 || name.length > 60) {
          respondJson(response, 400, { error: "Укажите имя, корректный email и пароль длиной от 10 до 128 символов" });
          return;
        }

        const userId = randomBytes(16).toString("hex");
        const salt = randomBytes(16).toString("hex");
        const passwordHash = scryptSync(password, salt, 64).toString("hex");
        try {
          database.exec("BEGIN IMMEDIATE");
          if (database.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
            database.exec("ROLLBACK");
            respondJson(response, 409, { error: "Аккаунт с таким email уже существует" });
            return;
          }

          database.prepare(
            "INSERT INTO users (id, email, display_name, password_salt, password_hash) VALUES (?, ?, ?, ?, ?)",
          ).run(userId, email, name, salt, passwordHash);

          const userCount = database.prepare("SELECT COUNT(*) AS count FROM users").get().count;
          const legacyState = userCount === 1
            ? database.prepare("SELECT state_json FROM app_state WHERE id = 1").get()
            : null;
          if (legacyState) {
            database.prepare("INSERT INTO user_app_state (user_id, state_json) VALUES (?, ?)").run(userId, legacyState.state_json);
          }
          createSession(request, response, userId);
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }

        respondJson(response, 201, { user: { id: userId, email, name } });
        return;
      }

      if (!isValidEmail(email) || password.length > 128) {
        respondJson(response, 400, { error: "Введите корректные email и пароль" });
        return;
      }
      const row = database.prepare(
        "SELECT id, email, display_name, password_salt, password_hash FROM users WHERE email = ?",
      ).get(email);
      const salt = row?.password_salt ?? "00000000000000000000000000000000";
      const expectedHash = row?.password_hash ?? "00".repeat(64);
      const actualHash = scryptSync(password, salt, 64);
      const passwordMatches = timingSafeEqual(actualHash, Buffer.from(expectedHash, "hex"));
      if (!row || !passwordMatches) {
        respondJson(response, 401, { error: "Неверный email или пароль" });
        return;
      }

      createSession(request, response, row.id);
      respondJson(response, 200, { user: { id: row.id, email: row.email, name: row.display_name } });
      return;
    }

    if (requestUrl.pathname === "/api/auth/logout" && request.method === "POST") {
      if (!isSameOrigin(request)) {
        respondJson(response, 403, { error: "Запрос отклонён" });
        return;
      }
      const token = getSessionToken(request);
      if (token) {
        database.prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
          .run(createHash("sha256").update(token).digest("hex"));
      }
      clearSessionCookie(request, response);
      respondJson(response, 200, { loggedOut: true });
      return;
    }

    if (requestUrl.pathname === "/api/state" && request.method === "GET") {
      const user = getAuthenticatedUser(request);
      if (!user) {
        respondJson(response, 401, { error: "Требуется авторизация" });
        return;
      }
      const row = database.prepare("SELECT state_json, updated_at FROM user_app_state WHERE user_id = ?").get(user.id);
      respondJson(response, 200, {
        state: row ? JSON.parse(row.state_json) : null,
        updatedAt: row?.updated_at ?? null,
      });
      return;
    }

    if (requestUrl.pathname === "/api/state" && request.method === "PUT") {
      if (!isSameOrigin(request)) {
        respondJson(response, 403, { error: "Запрос отклонён" });
        return;
      }
      const user = getAuthenticatedUser(request);
      if (!user) {
        respondJson(response, 401, { error: "Требуется авторизация" });
        return;
      }
      const body = await readJsonBody(request);
      if (!isRecord(body) || !isAppState(body.state)) {
        respondJson(response, 400, { error: "Структура состояния приложения некорректна" });
        return;
      }

      const stateJson = JSON.stringify(body.state);
      database
        .prepare(
          `INSERT INTO user_app_state (user_id, state_json, updated_at)
           VALUES (?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(user_id) DO UPDATE SET
             state_json = excluded.state_json,
             updated_at = excluded.updated_at`,
        )
        .run(user.id, stateJson);
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
