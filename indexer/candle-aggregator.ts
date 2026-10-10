import "dotenv/config";
import { pool as db } from "../database/postgres.js";

const IDLE_MS = 3000;

/*
 * Higher timeframes are derived exclusively from 1m candles.
 * The 1m engine remains the canonical base candle source.
 */
const TIMEFRAMES = [
  { name: "5m",  seconds: 5 * 60,       lookback: "15 minutes" },
  { name: "15m", seconds: 15 * 60,      lookback: "45 minutes" },
  { name: "30m", seconds: 30 * 60,      lookback: "90 minutes" },
  { name: "1h",  seconds: 60 * 60,      lookback: "3 hours" },
  { name: "4h",  seconds: 4 * 60 * 60,  lookback: "12 hours" },
  { name: "1d",  seconds: 24 * 60 * 60, lookback: "3 days" },
] as const;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function rebuildTimeframe(
  timeframe: string,
  bucketSeconds: number,
  lookback: string
): Promise<number> {
  const result = await db.query(
    `
    WITH watermark AS (
      SELECT MAX(open_time) AS latest_1m_time
      FROM candles
      WHERE timeframe = '1m'
    ),

    source AS (
      SELECT
        c.id,
        c.token_id,
        c.open_time,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        c.trade_count,

        to_timestamp(
          floor(
            extract(epoch FROM c.open_time) / $1::numeric
          ) * $1::numeric
        ) AS bucket_time

      FROM candles c
      CROSS JOIN watermark w

      WHERE c.timeframe = '1m'
        AND w.latest_1m_time IS NOT NULL
        AND c.open_time >=
          w.latest_1m_time - $2::interval
    ),

    aggregated AS (
      SELECT
        token_id,
        bucket_time AS open_time,

        (array_agg(open ORDER BY open_time ASC, id ASC))[1] AS open,
        MAX(high) AS high,
        MIN(low) AS low,
        (array_agg(close ORDER BY open_time DESC, id DESC))[1] AS close,

        SUM(volume) AS volume,
        SUM(trade_count)::integer AS trade_count

      FROM source

      GROUP BY
        token_id,
        bucket_time
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
      $3,
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
    `,
    [bucketSeconds, lookback, timeframe]
  );

  return result.rowCount ?? 0;
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO CANDLE AGGREGATOR");
  console.log(" Base: 1m");
  console.log(" Higher: 5m 15m 30m 1h 4h 1d");
  console.log("========================================");

  let consecutiveErrors = 0;

  while (true) {
    try {
      const rebuilt: string[] = [];

      for (const timeframe of TIMEFRAMES) {
        const count = await rebuildTimeframe(
          timeframe.name,
          timeframe.seconds,
          timeframe.lookback
        );

        rebuilt.push(`${timeframe.name}=${count}`);
      }

      consecutiveErrors = 0;

      console.log(`[CANDLE AGGREGATOR] ${rebuilt.join(" ")}`);

      await sleep(IDLE_MS);
    } catch (error) {
      consecutiveErrors++;

      const delay =
        Math.min(
          5000 * 2 ** Math.min(consecutiveErrors - 1, 4),
          60000
        ) + Math.floor(Math.random() * 3000);

      console.error("[CANDLE AGGREGATOR ERROR]", error);
      console.log(`[CANDLE AGGREGATOR BACKOFF] ${delay}ms`);

      await sleep(delay);
    }
  }
}

main().catch(async (error) => {
  console.error("[CANDLE AGGREGATOR FATAL]", error);
  await db.end();
  process.exit(1);
});
