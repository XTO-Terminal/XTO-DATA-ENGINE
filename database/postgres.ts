import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function checkPostgres() {
  const result = await pool.query("SELECT NOW() AS now");
  return result.rows[0];
}
