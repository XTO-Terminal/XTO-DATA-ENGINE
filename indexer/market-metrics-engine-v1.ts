import "dotenv/config";
import { pool as db } from "../database/postgres.js";

const IDLE_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rebuildMetrics(): Promise<number> {
  const result = await db.query(`
    WITH watermark AS (
      SELECT MAX(block_timestamp) AS latest_trade_time
      FROM trades
      WHERE price IS NOT NULL
        AND price > 0
    ),

    active_tokens AS (
      SELECT DISTINCT tr.token_id
      FROM trades tr
      CROSS JOIN watermark w
      WHERE w.latest_trade_time IS NOT NULL
        AND tr.block_timestamp >=
          w.latest_trade_time - INTERVAL '1 hour'
    ),

    last_trade AS (
      SELECT DISTINCT ON (tr.token_id)
        tr.token_id,
        tr.price AS last_price,
        tr.block_timestamp AS last_trade_at
      FROM trades tr
      JOIN active_tokens a
        ON a.token_id = tr.token_id
      WHERE tr.price IS NOT NULL
        AND tr.price > 0
      ORDER BY
        tr.token_id,
        tr.block_timestamp DESC,
        tr.id DESC
    ),

    reference_5m AS (
      SELECT DISTINCT ON (tr.token_id)
        tr.token_id,
        tr.price AS reference_price
      FROM trades tr
      JOIN active_tokens a
        ON a.token_id = tr.token_id
      CROSS JOIN watermark w
      WHERE tr.price IS NOT NULL
        AND tr.price > 0
        AND tr.block_timestamp <=
          w.latest_trade_time - INTERVAL '5 minutes'
      ORDER BY
        tr.token_id,
        tr.block_timestamp DESC,
        tr.id DESC
    ),

    reference_1h AS (
      SELECT DISTINCT ON (tr.token_id)
        tr.token_id,
        tr.price AS reference_price
      FROM trades tr
      JOIN active_tokens a
        ON a.token_id = tr.token_id
      CROSS JOIN watermark w
      WHERE tr.price IS NOT NULL
        AND tr.price > 0
        AND tr.block_timestamp <=
          w.latest_trade_time - INTERVAL '1 hour'
      ORDER BY
        tr.token_id,
        tr.block_timestamp DESC,
        tr.id DESC
    ),

    stats AS (
      SELECT
        tr.token_id,

        COALESCE(
          SUM(
            tr.native_amount::numeric
            / 1000000000000000000::numeric
          ) FILTER (
            WHERE tr.block_timestamp >=
              w.latest_trade_time - INTERVAL '5 minutes'
          ),
          0
        ) AS volume_5m,

        COALESCE(
          SUM(
            tr.native_amount::numeric
            / 1000000000000000000::numeric
          ) FILTER (
            WHERE tr.block_timestamp >=
              w.latest_trade_time - INTERVAL '1 hour'
          ),
          0
        ) AS volume_1h,

        COUNT(*) FILTER (
          WHERE tr.side = 'BUY'
            AND tr.block_timestamp >=
              w.latest_trade_time - INTERVAL '5 minutes'
        )::integer AS buys_5m,

        COUNT(*) FILTER (
          WHERE tr.side = 'SELL'
            AND tr.block_timestamp >=
              w.latest_trade_time - INTERVAL '5 minutes'
        )::integer AS sells_5m,

        COUNT(*) FILTER (
          WHERE tr.block_timestamp >=
            w.latest_trade_time - INTERVAL '5 minutes'
        )::integer AS trades_5m,

        COUNT(*) FILTER (
          WHERE tr.side = 'BUY'
            AND tr.block_timestamp >=
              w.latest_trade_time - INTERVAL '1 hour'
        )::integer AS buys_1h,

        COUNT(*) FILTER (
          WHERE tr.side = 'SELL'
            AND tr.block_timestamp >=
              w.latest_trade_time - INTERVAL '1 hour'
        )::integer AS sells_1h,

        COUNT(*) FILTER (
          WHERE tr.block_timestamp >=
            w.latest_trade_time - INTERVAL '1 hour'
        )::integer AS trades_1h

      FROM trades tr
      JOIN active_tokens a
        ON a.token_id = tr.token_id
      CROSS JOIN watermark w
      WHERE tr.block_timestamp >=
        w.latest_trade_time - INTERVAL '1 hour'
      GROUP BY tr.token_id
    ),

    calculated AS (
      SELECT
        a.token_id,
        lt.last_price,

        CASE
          WHEN r5.reference_price IS NOT NULL
           AND r5.reference_price <> 0
          THEN (
            (lt.last_price - r5.reference_price)
            / r5.reference_price
          ) * 100
          ELSE NULL
        END AS price_change_5m,

        CASE
          WHEN r1.reference_price IS NOT NULL
           AND r1.reference_price <> 0
          THEN (
            (lt.last_price - r1.reference_price)
            / r1.reference_price
          ) * 100
          ELSE NULL
        END AS price_change_1h,

        s.volume_5m,
        s.volume_1h,

        s.buys_5m,
        s.sells_5m,
        s.trades_5m,

        s.buys_1h,
        s.sells_1h,
        s.trades_1h,

        lt.last_trade_at

      FROM active_tokens a

      JOIN last_trade lt
        ON lt.token_id = a.token_id

      JOIN stats s
        ON s.token_id = a.token_id

      LEFT JOIN reference_5m r5
        ON r5.token_id = a.token_id

      LEFT JOIN reference_1h r1
        ON r1.token_id = a.token_id
    )

    INSERT INTO market_metrics (
      token_id,
      last_price,
      price_change_5m,
      price_change_1h,
      volume_5m,
      volume_1h,
      buys_5m,
      sells_5m,
      trades_5m,
      buys_1h,
      sells_1h,
      trades_1h,
      last_trade_at,
      updated_at
    )

    SELECT
      token_id,
      last_price,
      price_change_5m,
      price_change_1h,
      volume_5m,
      volume_1h,
      buys_5m,
      sells_5m,
      trades_5m,
      buys_1h,
      sells_1h,
      trades_1h,
      last_trade_at,
      NOW()
    FROM calculated

    ON CONFLICT (token_id)
    DO UPDATE SET
      last_price = EXCLUDED.last_price,
      price_change_5m = EXCLUDED.price_change_5m,
      price_change_1h = EXCLUDED.price_change_1h,
      volume_5m = EXCLUDED.volume_5m,
      volume_1h = EXCLUDED.volume_1h,
      buys_5m = EXCLUDED.buys_5m,
      sells_5m = EXCLUDED.sells_5m,
      trades_5m = EXCLUDED.trades_5m,
      buys_1h = EXCLUDED.buys_1h,
      sells_1h = EXCLUDED.sells_1h,
      trades_1h = EXCLUDED.trades_1h,
      last_trade_at = EXCLUDED.last_trade_at,
      updated_at = NOW()

    RETURNING token_id;
  `);

  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO MARKET METRICS ENGINE V1");
  console.log(" Windows: 5m / 1h");
  console.log(" Watermark: blockchain event-time");
  console.log("========================================");

  let consecutiveErrors = 0;

  while (true) {
    try {
      const rebuilt = await rebuildMetrics();

      consecutiveErrors = 0;

      if (rebuilt > 0) {
        console.log(`[MARKET METRICS] rebuilt=${rebuilt}`);
      }

      await sleep(IDLE_MS);
    } catch (error) {
      consecutiveErrors++;

      const delay =
        Math.min(
          5000 * 2 ** Math.min(consecutiveErrors - 1, 4),
          60000
        ) + Math.floor(Math.random() * 3000);

      console.error("[MARKET METRICS ERROR]", error);
      console.log(`[MARKET METRICS BACKOFF] ${delay}ms`);

      await sleep(delay);
    }
  }
}

main().catch(async (error) => {
  console.error("[MARKET METRICS FATAL]", error);
  await db.end();
  process.exit(1);
});
