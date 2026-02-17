import fs from "fs";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL || "";

if (!connectionString) {
  console.warn("DATABASE_URL is not set. Postgres-backed routes will fail until configured.");
}

export const pool = new Pool({
  connectionString: connectionString || undefined,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : undefined
});

export async function runSchema() {
  const sql = fs.readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
  await pool.query(sql);
}

export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
