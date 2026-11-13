/**
 * Live integration suite for the StudioSpace API.
 *
 * This is NOT a production-database test. It starts an ephemeral
 * mongodb-memory-server replica set (so transactions are available), then
 * boots the real built server (`dist/index.js`) against it and exercises the
 * HTTP API end to end. The database is destroyed when the script exits.
 *
 * Usage:
 *   npm run build
 *   npm run test:integration
 */

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { MongoMemoryReplSet } from "mongodb-memory-server";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 5055;
const API = `http://127.0.0.1:${PORT}`;
const DB_NAME = "studiospace_integration";
const RUN = Date.now().toString(36);

const results = [];
const serverLogs = [];

function pass(name) {
  results.push({ name, status: "PASS" });
  console.log(`  PASS  ${name}`);
}

function skip(name, reason) {
  results.push({ name, status: "SKIP", reason });
  console.log(`  SKIP  ${name} (${reason})`);
}

function fail(name, error) {
  results.push({ name, status: "FAIL", error: error?.message ?? String(error) });
  console.log(`  FAIL  ${name}`);
  console.log(`        ${error?.message ?? error}`);
}

async function test(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    if (String(error?.message ?? "").startsWith("SKIP:")) {
      skip(name, String(error.message).replace("SKIP: ", ""));
      return;
    }
    fail(name, error);
  }
}

/* ------------------------------------------------------------------ */
/* Cookie jar and request helpers                                      */
/* ------------------------------------------------------------------ */

class Jar {
  constructor(label) {
    this.label = label;
    this.cookies = new Map();
  }

  absorb(response) {
    const lines =
      typeof response.headers.getSetCookie === "function"
        ? response.headers.getSetCookie()
        : [];

    for (const line of lines) {
      const pair = line.split(";")[0];
      const index = pair.indexOf("=");

      if (index === -1) {
        continue;
      }

      const name = pair.slice(0, index).trim();
      const value = pair.slice(index + 1);

      if (value === "") {
        this.cookies.delete(name);
      } else {
        this.cookies.set(name, value);
      }
    }
  }

  header() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
  }

  get(name) {
    return this.cookies.get(name);
  }

  set(name, value) {
    this.cookies.set(name, value);
  }

  remove(name) {
    this.cookies.delete(name);
  }
}

const jarA = new Jar("user-a");
const jarB = new Jar("user-b");
const anon = new Jar("anonymous");

async function request(jar, method, urlPath, options = {}) {
  const headers = new Headers(options.headers);
  const cookieHeader = jar.header();

  // BetterAuth treats browser-style POSTs without an Origin as hostile and
  // rejects them with MISSING_OR_NULL_ORIGIN, so behave like the browser.
  // Tests that exercise origin handling pass their own origin explicitly.
  if (!headers.has("origin")) {
    headers.set("origin", API);
  }

  if (cookieHeader) {
    headers.set("cookie", cookieHeader);
  }

  let body = options.body;

  if (body instanceof FormData) {
    // fetch sets the multipart boundary itself.
  } else if (body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }

  const response = await fetch(`${API}${urlPath}`, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  jar.absorb(response);

  const text = await response.text();
  let parsed = null;

  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Keep the raw text for diagnostics.
  }

  return {
    status: response.status,
    body: parsed,
    text,
    headers: response.headers,
  };
}

/** Gets a fresh mutation token, then sends the request with its CSRF header. */
async function mutation(jar, method, urlPath, body, extraHeaders = {}) {
  await request(jar, "POST", "/api/mutation-token");

  const csrf = jar.get("studiospace_csrf") ?? "";

  return request(jar, method, urlPath, {
    body,
    headers: { "x-csrf-token": csrf, ...extraHeaders },
  });
}

function expectStatus(response, expected, label) {
  assert.equal(
    response.status,
    expected,
    `${label}: expected ${expected}, got ${response.status} ${response.text.slice(0, 300)}`
  );
}

function expectCode(response, expectedCode) {
  const actual = response.body?.error?.code;
  assert.equal(
    actual,
    expectedCode,
    `expected error code ${expectedCode}, got ${actual} (${response.text.slice(0, 300)})`
  );
}

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const password = "StudioTest1";
const userA = {
  name: "Agent Alpha",
  email: `agent.a.${RUN}@example.com`,
  password,
  image: "https://example.com/avatar-alpha.png",
};
const userB = {
  name: "Agent Beta",
  email: `agent.b.${RUN}@example.com`,
  password,
};

const studioA = {
  title: `Agent Test Studio ${RUN}`,
  category: "photo-studio",
  hourlyRate: 80,
  securityDeposit: 100,
  capacity: 6,
  location: "Integration City",
  imageUrl: "https://example.com/studio.jpg",
  amenities: ["WiFi", "Lighting kit"],
  description:
    "A quiet integration-test studio with a lighting kit and fast WiFi.",
};

const studioB = {
  ...studioA,
  title: `Agent Test Annex ${RUN}`,
  hourlyRate: 300,
  category: "music-suite",
};

function tomorrowUtc() {
  return new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
}

function yesterdayUtc() {
  return new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
}

const DATE = tomorrowUtc();
const state = {
  studioAId: null,
  studioBId: null,
  bookingOne: null,
  bookingTwo: null,
  tokenA: null,
};

/* ------------------------------------------------------------------ */
/* Suite                                                               */
/* ------------------------------------------------------------------ */

async function runSuite() {
  console.log(`\nAPI origin: ${API}`);
  console.log(`Test date: ${DATE}\n`);

  /* Health ---------------------------------------------------------- */
  console.log("Health");
  await test("health reports a connected database", async () => {
    const response = await request(anon, "GET", "/api/health");
    expectStatus(response, 200, "health");
    assert.equal(response.body?.database, "connected");
  });

  /* Password policy ------------------------------------------------- */
  console.log("\nPassword policy (BetterAuth hook)");
  await test("rejects a password without an uppercase letter", async () => {
    const response = await request(anon, "POST", "/api/auth/sign-up/email", {
      body: { name: "Lower Only", email: `lower.${RUN}@example.com`, password: "alllowercase1" },
    });
    assert.ok(
      response.status >= 400 && response.status < 500,
      `expected 4xx, got ${response.status}`
    );
  });

  await test("rejects a password shorter than six characters", async () => {
    const response = await request(anon, "POST", "/api/auth/sign-up/email", {
      body: { name: "Too Short", email: `short.${RUN}@example.com`, password: "Ab1" },
    });
    assert.ok(
      response.status >= 400 && response.status < 500,
      `expected 4xx, got ${response.status}`
    );
  });

  /* Registration and sessions --------------------------------------- */
  console.log("\nRegistration and sessions");
  await test("registers the first user with a profile photo URL", async () => {
    const response = await request(jarA, "POST", "/api/auth/sign-up/email", {
      body: userA,
    });
    expectStatus(response, 200, "sign-up A");
    assert.equal(response.body?.user?.email, userA.email);
    assert.equal(
      response.body?.user?.image,
      userA.image,
      "profile photo URL was not stored"
    );
    state.userAId = response.body?.user?.id;
    assert.ok(state.userAId, "sign-up response did not include a user id");
    assert.ok(jarA.get("better-auth.session_token"), "no session cookie was set");
  });

  await test("rejects a duplicate email", async () => {
    const response = await request(anon, "POST", "/api/auth/sign-up/email", {
      body: userA,
    });
    assert.ok(
      response.status >= 400 && response.status < 500,
      `expected 4xx, got ${response.status}`
    );
  });

  await test("reads the current session", async () => {
    const response = await request(jarA, "GET", "/api/auth/get-session");
    expectStatus(response, 200, "get-session");
    assert.equal(response.body?.user?.email, userA.email);
    assert.equal(response.body?.user?.image, userA.image);
  });

  await test("signs out and clears the session", async () => {
    const out = await request(jarA, "POST", "/api/auth/sign-out", { body: {} });
    expectStatus(out, 200, "sign-out");
    const after = await request(jarA, "GET", "/api/auth/get-session");
    assert.equal(after.body, null, "session still present after sign-out");
  });

  await test("signs back in and restores the session", async () => {
    const response = await request(jarA, "POST", "/api/auth/sign-in/email", {
      body: { email: userA.email, password },
    });
    expectStatus(response, 200, "sign-in A");
    const session = await request(jarA, "GET", "/api/auth/get-session");
    assert.equal(session.body?.user?.email, userA.email);
  });

  /* Mutation token --------------------------------------------------- */
  console.log("\nMutation token");
  await test("issues a JWT and CSRF cookie for a session", async () => {
    const response = await request(jarA, "POST", "/api/mutation-token");
    expectStatus(response, 200, "mutation-token");
    assert.ok(jarA.get("studiospace_mutation"), "JWT cookie missing");
    assert.ok(jarA.get("studiospace_csrf"), "CSRF cookie missing");
    state.tokenA = jarA.get("studiospace_mutation");
  });

  await test("refuses a mutation token without a session", async () => {
    const response = await request(anon, "POST", "/api/mutation-token");
    expectStatus(response, 401, "anonymous mutation-token");
  });

  /* Studio guards ---------------------------------------------------- */
  console.log("\nStudio write guards");
  await test("rejects a write without the CSRF header", async () => {
    const response = await request(jarA, "POST", "/api/studios", { body: studioA });
    expectStatus(response, 403, "no csrf");
    expectCode(response, "CSRF_FAILED");
  });

  await test("rejects a wrong CSRF token", async () => {
    const response = await request(jarA, "POST", "/api/studios", {
      body: studioA,
      headers: { "x-csrf-token": "not-the-real-token" },
    });
    expectStatus(response, 403, "bad csrf");
    expectCode(response, "CSRF_FAILED");
  });

  await test("rejects a disallowed Origin", async () => {
    const response = await mutation(jarA, "POST", "/api/studios", studioA, {
      origin: "https://evil.example",
    });
    expectStatus(response, 403, "evil origin");
    expectCode(response, "ORIGIN_NOT_ALLOWED");
  });

  await test("rejects a missing JWT cookie", async () => {
    const saved = jarA.get("studiospace_mutation");
    jarA.remove("studiospace_mutation");
    const response = await request(jarA, "POST", "/api/studios", {
      body: studioA,
      headers: { "x-csrf-token": jarA.get("studiospace_csrf") ?? "" },
    });
    if (saved) {
      jarA.set("studiospace_mutation", saved);
    }
    expectStatus(response, 401, "missing jwt");
    expectCode(response, "MUTATION_TOKEN_MISSING");
  });

  await test("rejects a tampered JWT", async () => {
    const token = jarA.get("studiospace_mutation");
    jarA.set("studiospace_mutation", `${token}tampered`);
    const response = await request(jarA, "POST", "/api/studios", {
      body: studioA,
      headers: { "x-csrf-token": jarA.get("studiospace_csrf") ?? "" },
    });
    jarA.set("studiospace_mutation", token);
    expectStatus(response, 401, "tampered jwt");
    expectCode(response, "MUTATION_TOKEN_INVALID");
  });

  /* Studio create/list ---------------------------------------------- */
  console.log("\nStudio CRUD");
  await test("creates a studio owned by the session user", async () => {
    const response = await mutation(jarA, "POST", "/api/studios", studioA);
    expectStatus(response, 201, "create studio A");
    const studio = response.body?.studio;
    assert.ok(studio?.id, "no studio id returned");
    state.studioAId = studio.id;
    assert.equal(studio.hostId, state.userAId, "hostId was not taken from the session");
    assert.equal(studio.hostEmail, userA.email);
    assert.equal(studio.hourlyRate, studioA.hourlyRate);
    assert.equal(studio.openTime, "08:00");
    assert.equal(studio.closeTime, "22:00");
  });

  await test("creates a second studio for sorting", async () => {
    const response = await mutation(jarA, "POST", "/api/studios", studioB);
    expectStatus(response, 201, "create studio B");
    state.studioBId = response.body?.studio?.id ?? null;
    assert.ok(state.studioBId);
  });

  await test("rejects an invalid category", async () => {
    const response = await mutation(jarA, "POST", "/api/studios", {
      ...studioA,
      title: `Bad Category ${RUN}`,
      category: "not-a-category",
    });
    expectStatus(response, 400, "bad category");
    expectCode(response, "VALIDATION_ERROR");
  });

  await test("rejects invalid field values", async () => {
    const response = await mutation(jarA, "POST", "/api/studios", {
      ...studioA,
      title: "x",
      imageUrl: "javascript:alert(1)",
      description: "too short",
    });
    expectStatus(response, 400, "bad fields");
    expectCode(response, "VALIDATION_ERROR");
    assert.match(response.body?.error?.message ?? "", /Title must be/);
    assert.match(response.body?.error?.message ?? "", /image URL/);
  });

  await test("reads a studio by id", async () => {
    const response = await request(anon, "GET", `/api/studios/${state.studioAId}`);
    expectStatus(response, 200, "studio detail");
    assert.equal(response.body?.studio?.id, state.studioAId);
  });

  await test("returns 404 for an unknown studio", async () => {
    const response = await request(anon, "GET", `/api/studios/${"a".repeat(24)}`);
    expectStatus(response, 404, "unknown studio");
    expectCode(response, "STUDIO_NOT_FOUND");
  });

  await test("searches by title", async () => {
    const response = await request(
      anon,
      "GET",
      `/api/studios?q=${encodeURIComponent(RUN)}`
    );
    expectStatus(response, 200, "search");
    assert.ok(response.body.count >= 2, `expected >= 2, got ${response.body.count}`);
    assert.ok(response.body.studios.every((studio) => studio.title.includes(RUN)));
  });

  await test("treats regex characters in search as literal text", async () => {
    const response = await request(anon, "GET", "/api/studios?q=%28");
    expectStatus(response, 200, "regex-escaped search");
    assert.equal(response.body.count, 0);
  });

  await test("filters by category and price", async () => {
    const response = await request(
      anon,
      "GET",
      `/api/studios?category=photo-studio&minPrice=79&maxPrice=81&q=${RUN}`
    );
    expectStatus(response, 200, "category+price");
    assert.equal(response.body.count, 1);
    assert.equal(response.body.studios[0].id, state.studioAId);
  });

  await test("sorts by price low to high", async () => {
    const response = await request(
      anon,
      "GET",
      `/api/studios?q=${RUN}&sort=price-low`
    );
    expectStatus(response, 200, "sort low");
    const rates = response.body.studios.map((studio) => studio.hourlyRate);
    assert.deepEqual(rates, [...rates].sort((a, b) => a - b));
    assert.equal(rates[0], 80);
  });

  await test("sorts by price high to low", async () => {
    const response = await request(
      anon,
      "GET",
      `/api/studios?q=${RUN}&sort=price-high`
    );
    expectStatus(response, 200, "sort high");
    const rates = response.body.studios.map((studio) => studio.hourlyRate);
    assert.deepEqual(rates, [...rates].sort((a, b) => b - a));
    assert.equal(rates[0], 300);
  });

  await test("caps results with limit while keeping the full count", async () => {
    const response = await request(anon, "GET", `/api/studios?q=${RUN}&limit=1`);
    expectStatus(response, 200, "limit");
    assert.equal(response.body.studios.length, 1);
    assert.equal(response.body.count, 2);
  });

  await test("rejects an unknown category filter", async () => {
    const response = await request(anon, "GET", "/api/studios?category=nope");
    expectStatus(response, 400, "unknown filter category");
    expectCode(response, "INVALID_CATEGORY");
  });

  await test("lists only the current host's studios", async () => {
    const response = await request(jarA, "GET", "/api/studios/mine");
    expectStatus(response, 200, "my studios");
    assert.equal(response.body.count, 2);
    assert.ok(response.body.studios.every((studio) => studio.hostId === state.userAId));
  });

  await test("protects the host listing endpoint", async () => {
    const response = await request(anon, "GET", "/api/studios/mine");
    expectStatus(response, 401, "anonymous mine");
  });

  await test("updates an owned studio", async () => {
    const response = await mutation(jarA, "PATCH", `/api/studios/${state.studioAId}`, {
      ...studioA,
      title: `${studioA.title} Updated`,
    });
    expectStatus(response, 200, "update studio");
    assert.equal(response.body?.studio?.title, `${studioA.title} Updated`);
  });

  /* Ownership -------------------------------------------------------- */
  console.log("\nOwnership isolation");
  await test("registers the second user", async () => {
    const response = await request(jarB, "POST", "/api/auth/sign-up/email", {
      body: userB,
    });
    expectStatus(response, 200, "sign-up B");
    state.userBId = response.body?.user?.id;
    assert.ok(state.userBId);
  });

  await test("returns an empty listing list for a host with no studios", async () => {
    const response = await request(jarB, "GET", "/api/studios/mine");
    expectStatus(response, 200, "empty mine");
    assert.equal(response.body.count, 0);
    assert.deepEqual(response.body.studios, []);
  });

  await test("blocks another user from editing the studio", async () => {
    const response = await mutation(jarB, "PATCH", `/api/studios/${state.studioAId}`, {
      ...studioA,
      title: "Hijacked",
    });
    expectStatus(response, 403, "foreign update");
    expectCode(response, "FORBIDDEN");
  });

  await test("blocks another user from deleting the studio", async () => {
    const response = await mutation(jarB, "DELETE", `/api/studios/${state.studioAId}`);
    expectStatus(response, 403, "foreign delete");
    expectCode(response, "FORBIDDEN");
  });

  await test("rejects a JWT issued for a different session", async () => {
    const savedTokenB = jarB.get("studiospace_mutation");
    jarB.set("studiospace_mutation", state.tokenA);
    const response = await request(jarB, "POST", "/api/studios", {
      body: { ...studioA, title: `Misbound ${RUN}` },
      headers: { "x-csrf-token": jarB.get("studiospace_csrf") ?? "" },
    });
    jarB.set("studiospace_mutation", savedTokenB);
    expectStatus(response, 401, "misbound jwt");
    expectCode(response, "MUTATION_TOKEN_MISMATCH");
  });

  /* Bookings --------------------------------------------------------- */
  console.log("\nBookings");
  await test("creates a Pending booking with a server-calculated price", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "10:00",
      endTime: "12:00",
      // A hostile client value that the server must ignore.
      totalPrice: 1,
      hourlyRate: 1,
    });
    expectStatus(response, 201, "create booking");
    const booking = response.body?.booking;
    state.bookingOne = booking;
    assert.equal(booking.status, "Pending");
    assert.equal(booking.hours, 2);
    assert.equal(booking.hourlyRate, 80);
    assert.equal(booking.totalPrice, 160, "server price was not used");
    assert.equal(booking.userId, state.userAId);
  });

  await test("rejects an exactly overlapping booking", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "10:00",
      endTime: "12:00",
    });
    expectStatus(response, 409, "exact overlap");
    expectCode(response, "BOOKING_OVERLAP");
  });

  await test("rejects a partially overlapping booking", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "11:00",
      endTime: "13:00",
    });
    expectStatus(response, 409, "partial overlap");
    expectCode(response, "BOOKING_OVERLAP");
  });

  await test("allows a back-to-back booking", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "12:00",
      endTime: "13:00",
    });
    expectStatus(response, 201, "back-to-back");
    state.bookingTwo = response.body?.booking;
    assert.equal(state.bookingTwo.totalPrice, 80);
  });

  await test("rejects a booking in the past", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: yesterdayUtc(),
      startTime: "10:00",
      endTime: "11:00",
    });
    expectStatus(response, 400, "past date");
    expectCode(response, "VALIDATION_ERROR");
  });

  await test("rejects a time outside opening hours", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "07:00",
      endTime: "08:00",
    });
    expectStatus(response, 400, "before opening");
    expectCode(response, "INVALID_BOOKING_TIME");
  });

  await test("rejects a time that is not a 30-minute step", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "14:15",
      endTime: "15:15",
    });
    expectStatus(response, 400, "bad step");
    expectCode(response, "INVALID_BOOKING_TIME");
  });

  await test("rejects a booking longer than 12 hours", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "08:00",
      endTime: "21:00",
    });
    expectStatus(response, 400, "too long");
    expectCode(response, "INVALID_BOOKING_TIME");
  });

  await test("rejects an invalid studio id", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: "nope",
      date: DATE,
      startTime: "16:00",
      endTime: "17:00",
    });
    expectStatus(response, 400, "bad studio id");
    expectCode(response, "INVALID_STUDIO_ID");
  });

  await test("rejects a missing studio", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: "b".repeat(24),
      date: DATE,
      startTime: "16:00",
      endTime: "17:00",
    });
    expectStatus(response, 404, "missing studio");
    expectCode(response, "STUDIO_NOT_FOUND");
  });

  await test("lists only the current user's bookings", async () => {
    const mine = await request(jarA, "GET", "/api/bookings/mine");
    expectStatus(mine, 200, "my bookings");
    assert.equal(mine.body.count, 2);
    const other = await request(jarB, "GET", "/api/bookings/mine");
    expectStatus(other, 200, "other bookings");
    assert.equal(other.body.count, 0);
  });

  await test("cancels a Pending booking", async () => {
    const response = await mutation(
      jarA,
      "PATCH",
      `/api/bookings/${state.bookingOne.id}/cancel`
    );
    expectStatus(response, 200, "cancel");
    assert.equal(response.body?.booking?.status, "Cancelled");
  });

  await test("refuses to cancel the same booking twice", async () => {
    const response = await mutation(
      jarA,
      "PATCH",
      `/api/bookings/${state.bookingOne.id}/cancel`
    );
    expectStatus(response, 409, "cancel twice");
    expectCode(response, "CANCEL_NOT_ALLOWED");
  });

  await test("blocks another user from cancelling the booking", async () => {
    const response = await mutation(
      jarB,
      "PATCH",
      `/api/bookings/${state.bookingTwo.id}/cancel`
    );
    expectStatus(response, 403, "foreign cancel");
    expectCode(response, "FORBIDDEN");
  });

  await test("frees the slot after a cancellation", async () => {
    const response = await mutation(jarA, "POST", "/api/bookings", {
      studioId: state.studioAId,
      date: DATE,
      startTime: "10:00",
      endTime: "12:00",
    });
    expectStatus(response, 201, "rebook freed slot");
    state.bookingThree = response.body?.booking;
  });

  /* Concurrency ------------------------------------------------------ */
  console.log("\nConcurrency");
  await test("accepts exactly one of five simultaneous overlapping requests", async () => {
    await request(jarA, "POST", "/api/mutation-token");
    const csrf = jarA.get("studiospace_csrf") ?? "";

    const attempts = Array.from({ length: 5 }, () =>
      request(jarA, "POST", "/api/bookings", {
        body: {
          studioId: state.studioAId,
          date: DATE,
          startTime: "18:00",
          endTime: "19:00",
        },
        headers: { "x-csrf-token": csrf },
      })
    );

    const responses = await Promise.all(attempts);
    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter(
      (r) => r.status === 409 && r.body?.error?.code === "BOOKING_OVERLAP"
    );

    assert.equal(
      created.length,
      1,
      `expected 1 success, got ${created.length} (statuses: ${responses.map((r) => r.status).join(", ")})`
    );
    assert.equal(
      conflicts.length,
      4,
      `expected 4 conflicts, got ${conflicts.length} (statuses: ${responses.map((r) => r.status).join(", ")})`
    );
  });

  /* Uploads ---------------------------------------------------------- */
  console.log("\nUploads");
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
  );

  await test("reports a clear 503 when ImgBB is not configured", async () => {
    const form = new FormData();
    form.append("image", new Blob([pngBytes], { type: "image/png" }), "pixel.png");
    const response = await mutation(jarA, "POST", "/api/uploads", form);
    expectStatus(response, 503, "upload unconfigured");
    expectCode(response, "UPLOAD_NOT_CONFIGURED");
  });

  await test("rejects a file that is not an image", async () => {
    const form = new FormData();
    form.append("image", new Blob(["hello"], { type: "text/plain" }), "note.txt");
    const response = await mutation(jarA, "POST", "/api/uploads", form);
    expectStatus(response, 400, "upload wrong type");
    expectCode(response, "INVALID_FILE");
  });

  await test("protects the upload route with the mutation guard", async () => {
    const form = new FormData();
    form.append("image", new Blob([pngBytes], { type: "image/png" }), "pixel.png");
    const response = await request(jarA, "POST", "/api/uploads", {
      body: form,
      headers: { "x-csrf-token": "wrong" },
    });
    expectStatus(response, 403, "upload guard");
    expectCode(response, "CSRF_FAILED");
  });

  /* Delete and session end ------------------------------------------ */
  console.log("\nCleanup and final state");
  await test("deletes an owned studio", async () => {
    const response = await mutation(
      jarA,
      "DELETE",
      `/api/studios/${state.studioBId}`
    );
    expectStatus(response, 200, "delete studio B");
    const after = await request(anon, "GET", `/api/studios/${state.studioBId}`);
    expectStatus(after, 404, "deleted studio detail");
  });

  await test("deletes the remaining owned studio", async () => {
    const response = await mutation(
      jarA,
      "DELETE",
      `/api/studios/${state.studioAId}`
    );
    expectStatus(response, 200, "delete studio A");
    const after = await request(anon, "GET", `/api/studios/${state.studioAId}`);
    expectStatus(after, 404, "deleted studio detail");
  });

  await test("rejects a second delete", async () => {
    const response = await mutation(
      jarA,
      "DELETE",
      `/api/studios/${state.studioAId}`
    );
    expectStatus(response, 404, "double delete");
    expectCode(response, "STUDIO_NOT_FOUND");
  });

  await test("requires a session again after sign-out", async () => {
    const out = await request(jarA, "POST", "/api/auth/sign-out", { body: {} });
    expectStatus(out, 200, "sign-out at end");
    const response = await request(jarA, "GET", "/api/studios/mine");
    expectStatus(response, 401, "mine after sign-out");
  });
}

/* ------------------------------------------------------------------ */
/* Boot, run, tear down                                                */
/* ------------------------------------------------------------------ */

let replSet;
let child;

function startApi(uri) {
  child = spawn(process.execPath, ["dist/index.js"], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(PORT),
      MONGODB_URI: uri,
      MONGODB_DB: DB_NAME,
      BETTER_AUTH_URL: API,
      CLIENT_ORIGIN: API,
      BETTER_AUTH_SECRET: "integration-only-better-auth-secret",
      JWT_SECRET: "integration-only-jwt-secret",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      IMGBB_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const collect = (chunk) => {
    serverLogs.push(chunk.toString());
    if (serverLogs.length > 200) {
      serverLogs.shift();
    }
  };

  child.stdout.on("data", collect);
  child.stderr.on("data", collect);

  child.on("exit", (code) => {
    serverLogs.push(`[harness] api exited with code ${code}`);
  });
}

async function waitForHealth() {
  const deadline = Date.now() + 90_000;
  let lastError = "no response";

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API}/api/health`);
      if (response.ok) {
        return;
      }
      lastError = `health status ${response.status}`;
    } catch (error) {
      lastError = error?.message ?? String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`API did not become healthy: ${lastError}`);
}

async function main() {
  console.log("Starting ephemeral MongoDB replica set...");
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });

  // getUri already includes ?replicaSet=<name>, so transactions are available.
  const uri = replSet.getUri(DB_NAME);
  console.log("Replica set ready.");

  startApi(uri);
  console.log("Waiting for the API...");
  await waitForHealth();
  console.log("API healthy.\n");

  try {
    await runSuite();
  } finally {
    console.log("\nTearing down...");
    if (child && child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([once(child, "exit"), new Promise((r) => setTimeout(r, 5000))]);
    }
    if (replSet) {
      await replSet.stop();
    }
  }

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const skipped = results.filter((r) => r.status === "SKIP").length;

  console.log("\n==============================");
  console.log(`PASS ${passed}  FAIL ${failed}  SKIP ${skipped}  (${results.length} checks)`);
  console.log("==============================");

  if (failed > 0) {
    console.log("\nFailures:");
    for (const result of results.filter((r) => r.status === "FAIL")) {
      console.log(`- ${result.name}: ${result.error}`);
    }
    console.log("\nLast server output:");
    console.log(serverLogs.join("").slice(-4000));
    process.exitCode = 1;
  }
}

main().catch(async (error) => {
  console.error("\nHarness error:", error);
  console.error("\nLast server output:");
  console.error(serverLogs.join("").slice(-4000));
  process.exitCode = 1;

  if (child && child.exitCode === null) {
    child.kill("SIGTERM");
  }
  if (replSet) {
    await replSet.stop().catch(() => {});
  }
});
