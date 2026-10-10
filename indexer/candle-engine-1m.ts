import "dotenv/config";
import { pool as db } from "../database/postgres.js";

const IDLE_MS = 3000;
const LOOKBACK_MINUTES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rebuildCandles(): Promise<number> {
  const result = await db.query(`
    WITH watermark AS (
      SELECT MAX(block_timestamp) AS latest_trade_time
      FROM trades
    ),
    source AS (
      SELECT
        tr.token_id,
        date_trunc('minute', tr.block_timestamp) AS open_time,
        tr.price,
        tr.native_amount::numeric / 1000000000000000000::numeric AS quote_volume,
        tr.block_timestamp,
        tr.id
      FROM trades tr
      CROSS JOIN watermark w
      WHERE tr.price IS NOT NULL
        AND tr.price > 0
        AND tr.token_amount > 0
        AND tr.native_amount > 0
        AND w.latest_trade_time IS NOT NULL
        AND tr.block_timestamp >=
          w.latest_trade_time - ($1::integer * INTERVAL '1 minute')
    ),
    aggregated AS (
      SELECT
        token_id,
        open_time,

        (array_agg(price ORDER BY block_timestamp ASC, id ASC))[1] AS open,
        MAX(price) AS high,
        MIN(price) AS low,
        (array_agg(price ORDER BY block_timestamp DESC, id DESC))[1] AS close,

        SUM(quote_volume) AS volume,
        COUNT(*)::integer AS trade_count

      FROM source
      GROUP BY token_id, open_time
    )

    INSERT INTO candles (
      token_id,
      timeframe,
      open_time,
      open,
      high,
      low,
      close,
      volume,
      trade_count,
      updated_at
    )

    SELECT
      token_id,
      '1m',
      open_time,
      open,
      high,
      low,
      close,
      volume,
      trade_count,
      NOW()
    FROM aggregated

    ON CONFLICT (token_id, timeframe, open_time)
    DO UPDATE SET
      open = EXCLUDED.open,
      high = EXCLUDED.high,
      low = EXCLUDED.low,
      close = EXCLUDED.close,
      volume = EXCLUDED.volume,
      trade_count = EXCLUDED.trade_count,
      updated_at = NOW()

    RETURNING id;
  `, [LOOKBACK_MINUTES]);

  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO CANDLE ENGINE");
  console.log(" Timeframe: 1m");
  console.log(` Rebuild window: ${LOOKBACK_MINUTES}m`);
  console.log("========================================");

  let consecutiveErrors = 0;

  while (true) {
    try {
      const candles = await rebuildCandles();

      consecutiveErrors = 0;

      if (candles > 0) {
        console.log(`[CANDLE 1M] rebuilt=${candles}`);
      }

      await sleep(IDLE_MS);
    } catch (error) {
      consecutiveErrors++;

      const delay =
        Math.min(
          5000 * 2 ** Math.min(consecutiveErrors - 1, 4),
          60000
        ) + Math.floor(Math.random() * 3000);

      console.error("[CANDLE ENGINE ERROR]", error);
      console.log(`[CANDLE ENGINE BACKOFF] ${delay}ms`);

      await sleep(delay);
    }
  }
}

main().catch(async (error) => {
  console.error("[CANDLE ENGINE FATAL]", error);
  await db.end();
  process.exit(1);
});
