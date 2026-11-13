import type { NextFunction, Request, Response } from "express";
import { fromNodeHeaders } from "better-auth/node";

import { env } from "../config/env.js";
import { auth } from "../lib/auth.js";
import { getCookie } from "../lib/cookies.js";
import { HttpError } from "../lib/http-error.js";
import {
  CSRF_COOKIE,
  MUTATION_COOKIE,
  verifyMutationToken,
} from "../lib/jwt.js";

async function readSession(request: Request) {
  return auth.api.getSession({
    headers: fromNodeHeaders(request.headers),
  });
}

/** Allows the request only when a valid BetterAuth session exists. */
export async function requireSession(
  request: Request,
  _response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await readSession(request);

    if (!session) {
      throw new HttpError(401, "UNAUTHORIZED", "Please log in to continue.");
    }

    request.authUser = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    };
    request.authSessionId = session.session.id;

    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Guard for every state-changing request.
 * It checks, in order:
 *   1. a valid BetterAuth session,
 *   2. the short-lived JWT cookie,
 *   3. that the JWT belongs to the same user and session,
 *   4. the CSRF token (double-submit cookie),
 *   5. the request origin.
 */
export async function requireMutationAuth(
  request: Request,
  _response: Response,
  next: NextFunction
): Promise<void> {
  try {
    const session = await readSession(request);

    if (!session) {
      throw new HttpError(401, "UNAUTHORIZED", "Please log in to continue.");
    }

    const token = getCookie(request, MUTATION_COOKIE);

    if (!token) {
      throw new HttpError(
        401,
        "MUTATION_TOKEN_MISSING",
        "Security token missing. Please retry."
      );
    }

    const result = verifyMutationToken(token);

    if (!result.ok) {
      throw new HttpError(
        401,
        result.reason === "expired"
          ? "MUTATION_TOKEN_EXPIRED"
          : "MUTATION_TOKEN_INVALID",
        "Your security token expired. Please retry."
      );
    }

    if (
      result.payload.sub !== session.user.id ||
      result.payload.sid !== session.session.id
    ) {
      throw new HttpError(
        401,
        "MUTATION_TOKEN_MISMATCH",
        "Security token does not match your session."
      );
    }

    const csrfCookie = getCookie(request, CSRF_COOKIE);
    const csrfHeader = request.get("x-csrf-token");

    if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
      throw new HttpError(
        403,
        "CSRF_FAILED",
        "Request could not be verified. Please refresh and try again."
      );
    }

    const origin = request.get("origin");

    if (origin && !env.allowedOrigins.includes(origin)) {
      throw new HttpError(
        403,
        "ORIGIN_NOT_ALLOWED",
        "Request origin is not allowed."
      );
    }

    request.authUser = {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      image: session.user.image,
    };
    request.authSessionId = session.session.id;

    next();
  } catch (error) {
    next(error);
  }
}
