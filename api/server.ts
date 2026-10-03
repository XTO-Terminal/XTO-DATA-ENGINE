import express from "express";
import dotenv from "dotenv";
import { checkPostgres } from "../database/postgres.js";
import { checkRedis } from "../config/redis.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.get("/health", (_req, res) => {
  res.json({
    service: "XTO Data Engine API",
    status: "ok",
    version: "v1",
  });
});

app.get("/health/db", async (_req, res) => {
  try {
    const db = await checkPostgres();

    res.json({
      service: "postgresql",
      status: "ok",
      database: "xto_data_engine",
      time: db.now,
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      service: "postgresql",
      status: "error",
    });
  }
});

app.get("/health/redis", async (_req, res) => {
  try {
    const ping = await checkRedis();

    res.json({
      service: "redis",
      status: ping === "PONG" ? "ok" : "error",
    });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      service: "redis",
      status: "error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`XTO API listening on http://localhost:${PORT}`);
});
