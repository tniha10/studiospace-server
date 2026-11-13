import type { Request } from "express";

/**
 * Reads a single cookie without adding a cookie-parser dependency.
 * BetterAuth reads its own cookies; this helper is only for our JWT and CSRF cookies.
 */
export function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;

  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const [cookieName, ...rest] = part.trim().split("=");

    if (cookieName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return undefined;
}
