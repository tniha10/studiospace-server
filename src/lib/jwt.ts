import jwt from "jsonwebtoken";

import { env } from "../config/env.js";

export const MUTATION_COOKIE = "studiospace_mutation";
export const CSRF_COOKIE = "studiospace_csrf";
export const MUTATION_TOKEN_TTL_SECONDS = 15 * 60;

export type MutationTokenPayload = {
  sub: string;
  sid: string;
};

export type MutationTokenResult =
  | { ok: true; payload: MutationTokenPayload }
  | { ok: false; reason: "expired" | "invalid" };

/**
 * Creates a short-lived JWT for the current session.
 * It is NOT a login token: it only proves that a valid BetterAuth session
 * asked for it, and it expires quickly.
 */
export function signMutationToken(userId: string, sessionId: string): string {
  return jwt.sign({ sub: userId, sid: sessionId }, env.jwtSecret, {
    expiresIn: MUTATION_TOKEN_TTL_SECONDS,
    issuer: "studiospace-api",
  });
}

export function verifyMutationToken(token: string): MutationTokenResult {
  try {
    const payload = jwt.verify(token, env.jwtSecret, {
      issuer: "studiospace-api",
    });

    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.sid !== "string"
    ) {
      return { ok: false, reason: "invalid" };
    }

    return { ok: true, payload: { sub: payload.sub, sid: payload.sid } };
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { ok: false, reason: "expired" };
    }

    return { ok: false, reason: "invalid" };
  }
}
