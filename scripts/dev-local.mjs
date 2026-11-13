/**
 * Zero-credential local development.
 *
 * Starts a throwaway MongoDB replica set (mongodb-memory-server) and the API
 * with generated development secrets, so the whole app can run without Atlas,
 * Google, or ImgBB credentials. Everything lives in memory and is destroyed
 * when this process stops.
 *
 * This is a development convenience only. Production uses `npm start` with a
 * real MONGODB_URI and real secrets from server/.env.
 *
 * Usage:
 *   npm run dev:local
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoMemoryReplSet } from "mongodb-memory-server";

const SERVER_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const PORT = Number(process.env.PORT) || 5000;
const API = `http://127.0.0.1:${PORT}`;
const CLIENT_ORIGIN =
  process.env.CLIENT_ORIGIN?.trim() || "http://localhost:3000";
const DB_NAME = process.env.MONGODB_DB?.trim() || "studiospace_local";

let replSet;
let api;
let shuttingDown = false;

const newSecret = () => randomBytes(32).toString("base64");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function startApi(uri) {
  const tsxCli = path.join(
    SERVER_DIR,
    "node_modules",
    "tsx",
    "dist",
    "cli.mjs"
  );

  return spawn(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      MONGODB_URI: uri,
      MONGODB_DB: DB_NAME,
      BETTER_AUTH_URL: CLIENT_ORIGIN,
      CLIENT_ORIGIN,
      // The checked-in .env contains placeholders; override them with
      // per-run development secrets so nothing insecure is shared.
      BETTER_AUTH_SECRET: newSecret(),
      JWT_SECRET: newSecret(),
      // Optional integrations stay off in local mode.
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      IMGBB_API_KEY: "",
    },
    stdio: "inherit",
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  let lastError = "no response";

  while (Date.now() < deadline) {
    if (api.exitCode !== null) {
      throw new Error(`the API exited with code ${api.exitCode}`);
    }

    try {
      const response = await fetch(`${API}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });

      if (response.ok) {
        return;
      }

      lastError = `health status ${response.status}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }

    await delay(400);
  }

  throw new Error(`the API did not become healthy: ${lastError}`);
}

async function shutdown(code, message) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  if (message) {
    console.log(`\n${message}`);
  }

  if (api && api.exitCode === null) {
    api.kill("SIGTERM");
    await Promise.race([once(api, "exit"), delay(3_000)]);

    if (api.exitCode === null) {
      api.kill("SIGKILL");
    }
  }

  if (replSet) {
    await replSet.stop().catch(() => {});
  }

  process.exit(code);
}

async function main() {
  const free = await isPortFree(PORT);

  if (!free) {
    console.error(
      `Port ${PORT} is already in use. Stop the other API first, or run with a different port:`
    );
    console.error(`  $env:PORT=5001; npm run dev:local`);
    console.error(
      "If you change the port, also set API_URL in the root .env so the Next.js proxy matches."
    );
    process.exit(1);
  }

  console.log("Starting a throwaway MongoDB replica set (development only)...");
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  const uri = replSet.getUri(DB_NAME);
  console.log("MongoDB ready. Data resets when this process stops.\n");

  console.log("Starting the API with tsx...\n");
  api = startApi(uri);

  api.on("exit", (code) => {
    if (!shuttingDown) {
      void shutdown(code ?? 1, "The API process stopped.");
    }
  });

  process.on("SIGINT", () => void shutdown(0, "Shutting down..."));
  process.on("SIGTERM", () => void shutdown(0, "Shutting down..."));

  await waitForHealth();

  if (process.argv.includes("--check")) {
    console.log("Local mode check passed: MongoDB and the API are healthy.\n");
    await shutdown(0);
    return;
  }

  console.log(`\nStudioSpace local mode is ready.

  API health:  ${API}/api/health
  Frontend:    ${CLIENT_ORIGIN}  (run "npm run dev" in the project root)

  Google and ImgBB are disabled here; use email + password.
  MongoDB is in memory, so accounts, studios, and bookings reset on exit.

  To add the six example studios: register an account in the frontend, then
  run "npm run seed" in another terminal while this process is running.

  Press Ctrl+C to stop.
`);
}

main().catch(async (error) => {
  console.error("\nLocal mode failed:", error?.message ?? error);

  if (api && api.exitCode === null) {
    api.kill("SIGTERM");
  }

  if (replSet) {
    await replSet.stop().catch(() => {});
  }

  process.exitCode = 1;
});
