import { MongoClient } from "mongodb";

import { env } from "../config/env.js";

// One client is shared by our routes and by the BetterAuth MongoDB adapter.
const client = new MongoClient(env.mongodbUri);

const db = client.db(env.mongodbDb);

export async function connectToDatabase(): Promise<void> {
  await client.connect();
  await db.command({ ping: 1 });
  console.log(`[db] connected to database "${env.mongodbDb}"`);
}

export function getDb() {
  return db;
}

export { client };
