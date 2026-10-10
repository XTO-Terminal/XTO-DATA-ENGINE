import express from "express";
import { rateLimit } from "express-rate-limit";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import dotenv from "dotenv";
import { checkPostgres, pool } from "../database/postgres.js";
import { checkRedis } from "../config/redis.js";
import { getConfiguredChainId } from "../config/rpc.js";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT || 8787);
const CHAIN_ID = getConfiguredChainId();

app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Cross-Origin-Resource-Policy", "same-site");
  res.setHeader("Cache-Control", "no-store");

  next();
});

const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "rate_limit_exceeded",
  },
});

if (process.env.ENABLE_PUBLIC_API_RATE_LIMIT === "true") {
  app.use("/api/v1", apiRateLimiter);
}

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


app.get("/api/v1/markets", async (req, res) => {
  try {
    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
      : 50;

    const result = await pool.query(
      `
      SELECT
        t.id AS token_id,
        t.address,
        t.name,
        t.symbol,
        t.decimals,

        m.last_price,
        m.price_change_5m,
        m.price_change_1h,

        m.volume_5m,
        m.volume_1h,

        m.buys_5m,
        m.sells_5m,
        m.trades_5m,

        m.buys_1h,
        m.sells_1h,
        m.trades_1h,

        m.last_trade_at,
        m.updated_at

      FROM market_metrics m
      JOIN tokens t
        ON t.id = m.token_id

      ORDER BY
        m.volume_5m DESC,
        m.last_trade_at DESC

      LIMIT $1
      `,
      [limit]
    );

    res.json({
      chainId: CHAIN_ID,
      count: result.rows.length,
      markets: result.rows.map((row) => ({
        token: {
          id: row.token_id,
          address: row.address,
          name: row.name,
          symbol: row.symbol,
          decimals: row.decimals,
        },

        price: row.last_price,

        change: {
          m5: row.price_change_5m,
          h1: row.price_change_1h,
        },

        volume: {
          m5: row.volume_5m,
          h1: row.volume_1h,
        },

        trades: {
          m5: {
            total: row.trades_5m,
            buys: row.buys_5m,
            sells: row.sells_5m,
          },
          h1: {
            total: row.trades_1h,
            buys: row.buys_1h,
            sells: row.sells_1h,
          },
        },

        lastTradeAt: row.last_trade_at,
        updatedAt: row.updated_at,
      })),
    });
  } catch (error) {
    console.error("[API /api/v1/markets]", error);

    res.status(500).json({
      error: "internal_server_error",
    });
  }
});


app.get("/api/v1/tokens/:address", async (req, res) => {
  try {
    const address = String(req.params.address || "").toLowerCase();

    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return res.status(400).json({
        error: "invalid_token_address",
      });
    }

    const result = await pool.query(
      `
      SELECT
        t.id AS token_id,
        t.address,
        t.name,
        t.symbol,
        t.decimals,
        t.total_supply,
        t.creator_address,
        t.created_block,
        t.created_at_chain,
        t.graduated,
        t.migrated,
        t.metadata_uri,

        m.last_price,
        m.price_change_5m,
        m.price_change_1h,
        m.volume_5m,
        m.volume_1h,
        m.buys_5m,
        m.sells_5m,
        m.trades_5m,
        m.buys_1h,
        m.sells_1h,
        m.trades_1h,
        m.last_trade_at,
        m.updated_at

      FROM tokens t

      LEFT JOIN market_metrics m
        ON m.token_id = t.id

      WHERE LOWER(t.address) = $1
      LIMIT 1
      `,
      [address]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "token_not_found",
      });
    }

    const row = result.rows[0];

    return res.json({
      service: "XTOTERMINAL Data API",
      chainId: CHAIN_ID,

      token: {
        id: row.token_id,
        address: row.address,
        name: row.name,
        symbol: row.symbol,
        decimals: row.decimals,
        totalSupply: row.total_supply,
        creatorAddress: row.creator_address,
        createdBlock: row.created_block,
        createdAt: row.created_at_chain,
        graduated: row.graduated,
        migrated: row.migrated,
        metadataUri: row.metadata_uri,
      },

      market: row.last_price === null
        ? null
        : {
            price: row.last_price,

            change: {
              m5: row.price_change_5m,
              h1: row.price_change_1h,
            },

            volume: {
              m5: row.volume_5m,
              h1: row.volume_1h,
            },

            trades: {
              m5: {
                total: row.trades_5m,
                buys: row.buys_5m,
                sells: row.sells_5m,
              },

              h1: {
                total: row.trades_1h,
                buys: row.buys_1h,
                sells: row.sells_1h,
              },
            },

            lastTradeAt: row.last_trade_at,
            updatedAt: row.updated_at,
          },
    });

  } catch (error) {
    console.error("[API /api/v1/tokens/:address]", error);

    return res.status(500).json({
      error: "internal_server_error",
    });
  }
});


app.get("/api/v1/trades/:address", async (req, res) => {
  try {
    const address = String(req.params.address || "").toLowerCase();

    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return res.status(400).json({
        error: "invalid_token_address",
      });
    }

    const rawLimit = Number(req.query.limit ?? 50);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100)
      : 50;

    const tokenResult = await pool.query(
      `
      SELECT
        id,
        address,
        name,
        symbol,
        decimals
      FROM tokens
      WHERE LOWER(address) = $1
      LIMIT 1
      `,
      [address]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        error: "token_not_found",
      });
    }

    const token = tokenResult.rows[0];

    const tradesResult = await pool.query(
      `
      SELECT
        id,
        tx_hash,
        log_index,
        side,
        trader_address,
        token_amount,
        native_amount,
        price,
        block_number,
        block_timestamp

      FROM trades

      WHERE token_id = $1

      ORDER BY
        block_timestamp DESC,
        id DESC

      LIMIT $2
      `,
      [token.id, limit]
    );

    return res.json({
      service: "XTOTERMINAL Data API",
      chainId: CHAIN_ID,

      token: {
        id: token.id,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      },

      count: tradesResult.rows.length,

      trades: tradesResult.rows.map((row) => ({
        id: row.id,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        side: row.side,

        // Current source: protocol-level Swap.sender.
        // Do not interpret this as a verified end-user wallet.
        sender: row.trader_address,

        tokenAmount: row.token_amount,
        nativeAmount: row.native_amount,
        price: row.price,

        blockNumber: row.block_number,
        timestamp: row.block_timestamp,
      })),
    });

  } catch (error) {
    console.error("[API /api/v1/trades/:address]", error);

    return res.status(500).json({
      error: "internal_server_error",
    });
  }
});


app.get("/api/v1/candles/:address", async (req, res) => {
  try {
    const address = String(req.params.address || "").toLowerCase();

    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return res.status(400).json({
        error: "invalid_token_address",
      });
    }

    const timeframe = String(req.query.timeframe ?? "1m");

    const supportedTimeframes = [
      "1m",
      "5m",
      "15m",
      "30m",
      "1h",
      "4h",
      "1d",
    ];

    if (!supportedTimeframes.includes(timeframe)) {
      return res.status(400).json({
        error: "unsupported_timeframe",
        supported: supportedTimeframes,
      });
    }

    const rawLimit = Number(req.query.limit ?? 100);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500)
      : 100;

    const tokenResult = await pool.query(
      `
      SELECT
        id,
        address,
        name,
        symbol,
        decimals
      FROM tokens
      WHERE LOWER(address) = $1
      LIMIT 1
      `,
      [address]
    );

    if (tokenResult.rows.length === 0) {
      return res.status(404).json({
        error: "token_not_found",
      });
    }

    const token = tokenResult.rows[0];

    const candlesResult = await pool.query(
      `
      SELECT
        open_time,
        open,
        high,
        low,
        close,
        volume,
        trade_count

      FROM candles

      WHERE token_id = $1
        AND timeframe = $2

      ORDER BY open_time DESC

      LIMIT $3
      `,
      [token.id, timeframe, limit]
    );

    const candles = candlesResult.rows
      .reverse()
      .map((row) => ({
        time: row.open_time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        trades: row.trade_count,
      }));

    return res.json({
      service: "XTOTERMINAL Data API",
      chainId: CHAIN_ID,

      token: {
        id: token.id,
        address: token.address,
        name: token.name,
        symbol: token.symbol,
        decimals: token.decimals,
      },

      timeframe,
      count: candles.length,
      candles,
    });

  } catch (error) {
    console.error("[API /api/v1/candles/:address]", error);

    return res.status(500).json({
      error: "internal_server_error",
    });
  }
});

const server = createServer(app);


const tradeSubscriptions = new Map<WebSocket, Set<string>>();
const candleSubscriptions = new Map<WebSocket, Set<string>>();
const marketSubscriptions = new Map<WebSocket, Set<string>>();

const WS_MAX_SUBSCRIPTIONS_PER_CHANNEL = 100;

const WS_CANDLE_TIMEFRAMES = new Set([
  "1m",
  "5m",
  "15m",
  "30m",
  "1h",
  "4h",
  "1d",
]);

const wss = new WebSocketServer({
  server,
  path: "/ws",
  maxPayload: 16 * 1024,
});

wss.on("connection", (socket) => {
  const heartbeatSocket = socket as WebSocket & {
    isAlive?: boolean;
  };

  heartbeatSocket.isAlive = true;

  heartbeatSocket.on("pong", () => {
    heartbeatSocket.isAlive = true;
  });

  tradeSubscriptions.set(socket, new Set());
  candleSubscriptions.set(socket, new Set());
  marketSubscriptions.set(socket, new Set());

  console.log(`[XTOTERMINAL WS] client connected total=${wss.clients.size}`);

  socket.send(JSON.stringify({
    type: "connected",
    service: "XTOTERMINAL Realtime API",
    chainId: CHAIN_ID,
    timestamp: new Date().toISOString(),
  }));

  socket.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString());

      if (message?.type === "ping") {
        socket.send(JSON.stringify({
          type: "pong",
          timestamp: new Date().toISOString(),
        }));

        return;
      }

      if (
        message?.type === "subscribe" &&
        message?.channel === "trades"
      ) {
        const token = String(message.token || "").toLowerCase();

        if (!/^0x[a-f0-9]{40}$/.test(token)) {
          socket.send(JSON.stringify({
            type: "error",
            error: "invalid_token_address",
          }));

          return;
        }

        const subscriptions = tradeSubscriptions.get(socket);

        if (
          subscriptions &&
          !subscriptions.has(token) &&
          subscriptions.size >= WS_MAX_SUBSCRIPTIONS_PER_CHANNEL
        ) {
          socket.send(JSON.stringify({
            type: "error",
            error: "subscription_limit_reached",
            channel: "trades",
            limit: WS_MAX_SUBSCRIPTIONS_PER_CHANNEL,
          }));

          return;
        }

        subscriptions?.add(token);

        socket.send(JSON.stringify({
          type: "subscribed",
          channel: "trades",
          token,
        }));

        return;
      }

      if (
        message?.type === "subscribe" &&
        message?.channel === "candles"
      ) {
        const token = String(message.token || "").toLowerCase();
        const timeframe = String(message.timeframe || "");

        if (!/^0x[a-f0-9]{40}$/.test(token)) {
          socket.send(JSON.stringify({
            type: "error",
            error: "invalid_token_address",
          }));

          return;
        }

        if (!WS_CANDLE_TIMEFRAMES.has(timeframe)) {
          socket.send(JSON.stringify({
            type: "error",
            error: "unsupported_timeframe",
            supported: [...WS_CANDLE_TIMEFRAMES],
          }));

          return;
        }

        const key = `${token}:${timeframe}`;

        const subscriptions = candleSubscriptions.get(socket);

        if (
          subscriptions &&
          !subscriptions.has(key) &&
          subscriptions.size >= WS_MAX_SUBSCRIPTIONS_PER_CHANNEL
        ) {
          socket.send(JSON.stringify({
            type: "error",
            error: "subscription_limit_reached",
            channel: "candles",
            limit: WS_MAX_SUBSCRIPTIONS_PER_CHANNEL,
          }));

          return;
        }

        subscriptions?.add(key);

        socket.send(JSON.stringify({
          type: "subscribed",
          channel: "candles",
          token,
          timeframe,
        }));

        return;
      }

      if (
        message?.type === "subscribe" &&
        message?.channel === "market"
      ) {
        const token = String(message.token || "").toLowerCase();

        if (!/^0x[a-f0-9]{40}$/.test(token)) {
          socket.send(JSON.stringify({
            type: "error",
            error: "invalid_token_address",
          }));

          return;
        }

        const subscriptions = marketSubscriptions.get(socket);

        if (
          subscriptions &&
          !subscriptions.has(token) &&
          subscriptions.size >= WS_MAX_SUBSCRIPTIONS_PER_CHANNEL
        ) {
          socket.send(JSON.stringify({
            type: "error",
            error: "subscription_limit_reached",
            channel: "market",
            limit: WS_MAX_SUBSCRIPTIONS_PER_CHANNEL,
          }));

          return;
        }

        subscriptions?.add(token);

        socket.send(JSON.stringify({
          type: "subscribed",
          channel: "market",
          token,
        }));

        return;
      }

      if (
        message?.type === "unsubscribe" &&
        message?.channel === "market"
      ) {
        const token = String(message.token || "").toLowerCase();

        marketSubscriptions.get(socket)?.delete(token);

        socket.send(JSON.stringify({
          type: "unsubscribed",
          channel: "market",
          token,
        }));

        return;
      }

      if (
        message?.type === "unsubscribe" &&
        message?.channel === "candles"
      ) {
        const token = String(message.token || "").toLowerCase();
        const timeframe = String(message.timeframe || "");
        const key = `${token}:${timeframe}`;

        candleSubscriptions.get(socket)?.delete(key);

        socket.send(JSON.stringify({
          type: "unsubscribed",
          channel: "candles",
          token,
          timeframe,
        }));

        return;
      }

      if (
        message?.type === "unsubscribe" &&
        message?.channel === "trades"
      ) {
        const token = String(message.token || "").toLowerCase();

        tradeSubscriptions.get(socket)?.delete(token);

        socket.send(JSON.stringify({
          type: "unsubscribed",
          channel: "trades",
          token,
        }));

        return;
      }
    } catch {
      socket.send(JSON.stringify({
        type: "error",
        error: "invalid_message",
      }));
    }
  });

  socket.on("close", () => {
    tradeSubscriptions.delete(socket);
    candleSubscriptions.delete(socket);
    marketSubscriptions.delete(socket);

    console.log(`[XTOTERMINAL WS] client disconnected total=${wss.clients.size}`);
  });

  socket.on("error", (error) => {
    console.error("[XTOTERMINAL WS ERROR]", error);
  });
});


let latestTradeId = 0n;

async function initializeTradeCursor() {
  const result = await pool.query(`
    SELECT COALESCE(MAX(id), 0) AS latest_trade_id
    FROM trades
  `);

  latestTradeId = BigInt(result.rows[0].latest_trade_id);

  console.log(
    `[XTOTERMINAL WS] trade cursor initialized id=${latestTradeId}`
  );
}

async function broadcastNewTrades() {
  const result = await pool.query(
    `
    SELECT
      tr.id,
      tr.tx_hash,
      tr.log_index,
      tr.side,
      tr.trader_address,
      tr.token_amount,
      tr.native_amount,
      tr.price,
      tr.block_number,
      tr.block_timestamp,
      LOWER(t.address) AS token_address,
      t.symbol

    FROM trades tr

    JOIN tokens t
      ON t.id = tr.token_id

    WHERE tr.id > $1

    ORDER BY tr.id ASC

    LIMIT 500
    `,
    [latestTradeId.toString()]
  );

  if (result.rows.length === 0) {
    return;
  }

  for (const row of result.rows) {
    const tokenAddress = row.token_address;

    const payload = JSON.stringify({
      type: "trade",
      channel: "trades",
      chainId: CHAIN_ID,

      token: {
        address: tokenAddress,
        symbol: row.symbol,
      },

      trade: {
        id: row.id,
        txHash: row.tx_hash,
        logIndex: row.log_index,
        side: row.side,

        // Protocol-level Swap.sender for now.
        sender: row.trader_address,

        tokenAmount: row.token_amount,
        nativeAmount: row.native_amount,
        price: row.price,
        blockNumber: row.block_number,
        timestamp: row.block_timestamp,
      },
    });

    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      const subscriptions = tradeSubscriptions.get(client);

      if (subscriptions?.has(tokenAddress)) {
        client.send(payload);
      }
    }

    latestTradeId = BigInt(row.id);
  }

  console.log(
    `[XTOTERMINAL WS] broadcast trades=${result.rows.length} cursor=${latestTradeId}`
  );
}

let latestCandleUpdatedAt = new Date(0);
let latestCandleId = 0n;

async function initializeCandleCursor() {
  const result = await pool.query(`
    SELECT
      updated_at AS latest_candle_updated_at,
      id AS latest_candle_id
    FROM candles
    ORDER BY updated_at DESC, id DESC
    LIMIT 1
  `);

  if (result.rows.length === 0) {
    latestCandleUpdatedAt = new Date(0);
    latestCandleId = 0n;
  } else {
    latestCandleUpdatedAt = new Date(
      result.rows[0].latest_candle_updated_at
    );
    latestCandleId = BigInt(
      result.rows[0].latest_candle_id
    );
  }

  console.log(
    `[XTOTERMINAL WS] candle cursor initialized updated_at=${latestCandleUpdatedAt.toISOString()} id=${latestCandleId}`
  );
}

async function broadcastUpdatedCandles() {
  const cursorUpdatedAt = latestCandleUpdatedAt;
  const cursorId = latestCandleId;

  const result = await pool.query(
    `
    SELECT
      c.id,
      c.timeframe,
      c.open_time,
      c.open,
      c.high,
      c.low,
      c.close,
      c.volume,
      c.trade_count,
      c.updated_at,
      LOWER(t.address) AS token_address,
      t.symbol

    FROM candles c

    JOIN tokens t
      ON t.id = c.token_id

    WHERE
      c.updated_at > $1
      OR (
        c.updated_at = $1
        AND c.id > $2
      )

    ORDER BY c.updated_at ASC, c.id ASC

    LIMIT 1000
    `,
    [cursorUpdatedAt, cursorId.toString()]
  );

  if (result.rows.length === 0) {
    return;
  }

  for (const row of result.rows) {
    const tokenAddress = row.token_address;
    const timeframe = row.timeframe;
    const key = `${tokenAddress}:${timeframe}`;

    const payload = JSON.stringify({
      type: "candle",
      channel: "candles",
      chainId: CHAIN_ID,

      token: {
        address: tokenAddress,
        symbol: row.symbol,
      },

      timeframe,

      candle: {
        time: row.open_time,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
        trades: row.trade_count,
      },
    });

    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      const subscriptions = candleSubscriptions.get(client);

      if (subscriptions?.has(key)) {
        client.send(payload);
      }
    }

    latestCandleUpdatedAt = new Date(row.updated_at);
    latestCandleId = BigInt(row.id);
  }

  console.log(
    `[XTOTERMINAL WS] processed candle updates=${result.rows.length} cursor=${latestCandleUpdatedAt.toISOString()} id=${latestCandleId}`
  );
}

let candleBroadcastBusy = false;

const candleBroadcastTimer = setInterval(async () => {
  if (candleBroadcastBusy) {
    return;
  }

  candleBroadcastBusy = true;

  try {
    await broadcastUpdatedCandles();
  } catch (error) {
    console.error("[XTOTERMINAL WS CANDLE BROADCAST ERROR]", error);
  } finally {
    candleBroadcastBusy = false;
  }
}, 1000);


let latestMarketUpdatedAt = new Date(0);

async function initializeMarketCursor() {
  const result = await pool.query(`
    SELECT COALESCE(MAX(updated_at), to_timestamp(0)) AS latest_market_updated_at
    FROM market_metrics
  `);

  latestMarketUpdatedAt = new Date(
    result.rows[0].latest_market_updated_at
  );

  console.log(
    `[XTOTERMINAL WS] market cursor initialized updated_at=${latestMarketUpdatedAt.toISOString()}`
  );
}

async function broadcastUpdatedMarkets() {
  const cursorAtStart = latestMarketUpdatedAt;

  const result = await pool.query(
    `
    SELECT
      mm.token_id,
      mm.last_price,
      mm.price_change_5m,
      mm.price_change_1h,
      mm.volume_5m,
      mm.volume_1h,
      mm.buys_5m,
      mm.sells_5m,
      mm.trades_5m,
      mm.buys_1h,
      mm.sells_1h,
      mm.trades_1h,
      mm.last_trade_at,
      mm.updated_at,
      LOWER(t.address) AS token_address,
      t.symbol

    FROM market_metrics mm

    JOIN tokens t
      ON t.id = mm.token_id

    WHERE mm.updated_at > $1

    ORDER BY mm.updated_at ASC, mm.token_id ASC
    `,
    [cursorAtStart]
  );

  if (result.rows.length === 0) {
    return;
  }

  let maxUpdatedAt = cursorAtStart;

  for (const row of result.rows) {
    const tokenAddress = row.token_address;

    const payload = JSON.stringify({
      type: "market",
      channel: "market",
      chainId: CHAIN_ID,

      token: {
        address: tokenAddress,
        symbol: row.symbol,
      },

      market: {
        lastPrice: row.last_price,

        priceChange5m: row.price_change_5m,
        priceChange1h: row.price_change_1h,

        volume5m: row.volume_5m,
        volume1h: row.volume_1h,

        buys5m: row.buys_5m,
        sells5m: row.sells_5m,
        trades5m: row.trades_5m,

        buys1h: row.buys_1h,
        sells1h: row.sells_1h,
        trades1h: row.trades_1h,

        lastTradeAt: row.last_trade_at,
      },
    });

    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) {
        continue;
      }

      const subscriptions = marketSubscriptions.get(client);

      if (subscriptions?.has(tokenAddress)) {
        client.send(payload);
      }
    }

    const rowUpdatedAt = new Date(row.updated_at);

    if (rowUpdatedAt > maxUpdatedAt) {
      maxUpdatedAt = rowUpdatedAt;
    }
  }

  latestMarketUpdatedAt = maxUpdatedAt;

  console.log(
    `[XTOTERMINAL WS] processed market updates=${result.rows.length} cursor=${latestMarketUpdatedAt.toISOString()}`
  );
}

let marketBroadcastBusy = false;

const marketBroadcastTimer = setInterval(async () => {
  if (marketBroadcastBusy) {
    return;
  }

  marketBroadcastBusy = true;

  try {
    await broadcastUpdatedMarkets();
  } catch (error) {
    console.error("[XTOTERMINAL WS MARKET BROADCAST ERROR]", error);
  } finally {
    marketBroadcastBusy = false;
  }
}, 1000);


let tradeBroadcastBusy = false;

const tradeBroadcastTimer = setInterval(async () => {
  if (tradeBroadcastBusy) {
    return;
  }

  tradeBroadcastBusy = true;

  try {
    await broadcastNewTrades();
  } catch (error) {
    console.error("[XTOTERMINAL WS BROADCAST ERROR]", error);
  } finally {
    tradeBroadcastBusy = false;
  }
}, 1000);

const heartbeat = setInterval(() => {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }

    const socket = client as WebSocket & {
      isAlive?: boolean;
    };

    if (socket.isAlive === false) {
      console.log("[XTOTERMINAL WS] terminating stale client");
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, 30000);

wss.on("close", () => {
  clearInterval(heartbeat);
  clearInterval(tradeBroadcastTimer);
  clearInterval(candleBroadcastTimer);
  clearInterval(marketBroadcastTimer);
});

Promise.all([
  initializeTradeCursor(),
  initializeCandleCursor(),
  initializeMarketCursor(),
])
  .then(() => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(
        `XTOTERMINAL REST API listening on http://127.0.0.1:${PORT}`
      );

      console.log(
        `XTOTERMINAL WebSocket listening on ws://127.0.0.1:${PORT}/ws`
      );
    });
  })
  .catch((error) => {
    console.error("[XTOTERMINAL WS INIT ERROR]", error);
    process.exit(1);
  });
