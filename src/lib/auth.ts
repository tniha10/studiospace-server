import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { APIError, createAuthMiddleware } from "better-auth/api";

import { env } from "../config/env.js";
import { client, getDb } from "../db/mongodb.js";

const hasGoogleCredentials =
  env.googleClientId !== "" && env.googleClientSecret !== "";

export const auth = betterAuth({
  appName: "StudioSpace",
  baseURL: env.betterAuthUrl,
  secret: env.betterAuthSecret,

  database: mongodbAdapter(getDb(), { client }),

  trustedOrigins: env.allowedOrigins,

  emailAndPassword: {
    enabled: true,
    // The assignment requires a minimum of six characters.
    minPasswordLength: 6,
    maxPasswordLength: 128,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },

  // Google is only registered when both credentials exist.
  // Without them the app still works with email and password.
  socialProviders: hasGoogleCredentials
    ? {
        google: {
          clientId: env.googleClientId,
          clientSecret: env.googleClientSecret,
          prompt: "select_account",
        },
      }
    : {},

  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      sameSite: "lax",
      secure: env.isProduction,
      path: "/",
    },
  },

  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== "/sign-up/email") {
        return;
      }

      const body = ctx.body as { password?: unknown } | undefined;
      const password = typeof body?.password === "string" ? body.password : "";

      if (!password) {
        return;
      }

      const hasUppercase = /[A-Z]/.test(password);
      const hasLowercase = /[a-z]/.test(password);

      if (!hasUppercase || !hasLowercase) {
        throw new APIError("BAD_REQUEST", {
          message:
            "Password must include at least one uppercase and one lowercase letter.",
        });
      }
    }),
  },
});
