import { Router } from "express";

import { getDb } from "../db/mongodb.js";

export const healthRouter = Router();

healthRouter.get("/", async (_request, response) => {
  let database = "disconnected";

  try {
    await getDb().command({ ping: 1 });
    database = "connected";
  } catch {
    database = "disconnected";
  }

  response.json({
    status: "ok",
    database,
    time: new Date().toISOString(),
  });
});
