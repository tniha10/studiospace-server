import "dotenv/config";

function readRequired(name: string): string {
  const value = process.env[name];

  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable "${name}". Copy server/.env.example to server/.env and fill it in.`
    );
  }

  return value.trim();
}

function readNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const isProduction = process.env.NODE_ENV === "production";
const clientOrigin =
  process.env.CLIENT_ORIGIN?.trim() || "http://localhost:3000";

// In development, allow both spellings of localhost so opening the app on
// 127.0.0.1 does not fail the origin check. Production only trusts the
// configured frontend origin.
const allowedOrigins = isProduction
  ? [clientOrigin]
  : Array.from(
      new Set([
        clientOrigin,
        "http://localhost:3000",
        "http://127.0.0.1:3000",
      ])
    );

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProduction,
  port: readNumber("PORT", 5000),

  mongodbUri: readRequired("MONGODB_URI"),
  mongodbDb: process.env.MONGODB_DB?.trim() || "studiospace",

  // The public frontend origin. /api is proxied from Next.js to this server,
  // so BetterAuth, cookies and the Google callback all use this origin.
  betterAuthUrl: process.env.BETTER_AUTH_URL?.trim() || "http://localhost:3000",
  clientOrigin,
  allowedOrigins,
  betterAuthSecret: readRequired("BETTER_AUTH_SECRET"),
  jwtSecret: readRequired("JWT_SECRET"),

  googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
  imgbbApiKey: process.env.IMGBB_API_KEY?.trim() ?? "",
};
