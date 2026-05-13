import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const fixedPort = 3026;
const envPath = path.join(__dirname, ".env");

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function sendJavaScript(response, statusCode, source) {
  response.writeHead(statusCode, {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(source);
}

async function readEnvFile() {
  try {
    const raw = await fs.readFile(envPath, "utf8");
    const entries = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        if (separatorIndex === -1) {
          return null;
        }

        const key = line.slice(0, separatorIndex).trim();
        const value = line.slice(separatorIndex + 1).trim();
        return [key, value];
      })
      .filter(Boolean);

    return Object.fromEntries(entries);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }

    throw error;
  }
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

async function serveAuthConfig(response) {
  const env = await readEnvFile();
  const authConfig = {
    supabaseUrl: pickFirstNonEmpty(env.SUPABASE_URL, env.SUPABASEURL),
    supabaseAnonKey: pickFirstNonEmpty(
      env.SUPABASE_ANON_KEY,
      env.SUPABASEANONKEY,
    ),
    apiBaseUrl: pickFirstNonEmpty(
      env.API_BASE_URL,
      env.APIBASEURL,
      // "http://localhost:3000",
    ),
    loginPath: pickFirstNonEmpty(env.LOGIN_PATH, env.LOGINPATH, "/login.html"),
    appPath: pickFirstNonEmpty(env.APP_PATH, env.APPPATH, "/"),
  };

  sendJavaScript(
    response,
    200,
    `window.OT_AUTH = ${JSON.stringify(authConfig, null, 2)};\n`,
  );
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/auth-config.js") {
    await serveAuthConfig(response);
    return;
  }

  const pathname =
    requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.join(publicDir, pathname);

  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[ext] ?? "application/octet-stream",
    });
    response.end(file);
  } catch {
    sendJson(response, 404, { error: "Not found" });
  }
}

const server = http.createServer(async (request, response) => {
  try {
    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, {
      error: "Internal server error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

function listen(port) {
  server.listen(port, () => {
    const address = server.address();
    const activePort =
      typeof address === "object" && address ? address.port : port;
    console.log(
      `OT tracker static preview is running at http://localhost:${activePort}`,
    );
  });
}

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(
      `Port ${fixedPort} is already in use. Stop the existing process, then try again.`,
    );
    process.exit(1);
    return;
  }

  throw error;
});

listen(fixedPort);
