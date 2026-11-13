import "dotenv/config";

import cors from "cors";
import express from "express";
import { toNodeHandler } from "better-auth/node";

import { env } from "./config/env.js";
import { connectToDatabase } from "./db/mongodb.js";
import { auth } from "./lib/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { bookingsRouter } from "./routes/bookings.routes.js";
import { healthRouter } from "./routes/health.routes.js";
import { mutationTokenRouter } from "./routes/mutation-token.routes.js";
import { studiosRouter } from "./routes/studios.routes.js";
import { uploadsRouter } from "./routes/uploads.routes.js";

const app = express();

// Render/Vercel run behind a proxy; this keeps secure cookies and client IPs correct.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: env.allowedOrigins,
    credentials: true,
  })
);

// BetterAuth must be mounted BEFORE express.json(), because it reads the
// raw request body. It serves /api/auth/sign-up/email, /sign-in/email,
// /callback/google, /get-session, /sign-out and the rest.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "1mb" }));

app.use("/api/health", healthRouter);
app.use("/api/mutation-token", mutationTokenRouter);
app.use("/api/studios", studiosRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/uploads", uploadsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function startServer(): Promise<void> {
  await connectToDatabase();

  app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
    console.log(`[auth]   public base URL ${env.betterAuthUrl}`);
  });
}

startServer().catch((error) => {
  console.error("[server] failed to start:", error);
  process.exit(1);
});

export { app };
