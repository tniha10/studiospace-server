import { randomBytes } from "node:crypto";

import { Router } from "express";

import { env } from "../config/env.js";
import {
  CSRF_COOKIE,
  MUTATION_COOKIE,
  MUTATION_TOKEN_TTL_SECONDS,
  signMutationToken,
} from "../lib/jwt.js";
import { requireSession } from "../middleware/require-auth.js";

export const mutationTokenRouter = Router();

/**
 * Called by the client before a state-changing request.
 * The BetterAuth session cookie proves who the user is; in exchange the
 * server sets a short-lived JWT cookie plus a readable CSRF token cookie.
 */
mutationTokenRouter.post("/", requireSession, (request, response) => {
  const user = request.authUser;

  if (!user || !request.authSessionId) {
    response.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Please log in to continue." },
    });
    return;
  }

  const token = signMutationToken(user.id, request.authSessionId);
  const csrfToken = randomBytes(24).toString("hex");

  response.cookie(MUTATION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: MUTATION_TOKEN_TTL_SECONDS * 1000,
  });

  // This cookie is intentionally readable so the client can send it back
  // in the X-CSRF-Token header (double-submit cookie pattern).
  response.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: "lax",
    secure: env.isProduction,
    path: "/",
    maxAge: MUTATION_TOKEN_TTL_SECONDS * 1000,
  });

  response.json({ ok: true, expiresIn: MUTATION_TOKEN_TTL_SECONDS });
});
