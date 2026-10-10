import "dotenv/config";
import { pool as db } from "../database/postgres.js";

const CHAIN_ID = 4663;

const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000";

const WETH =
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73";

const BATCH_SIZE = 250;
const IDLE_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

async function processBatch(): Promise<number> {
  const result = await db.query(
    `
    SELECT
      s.id AS swap_id,
      s.tx_hash,
      s.log_index,
      s.block_number,
      s.sender,
      s.amount0::text,
      s.amount1::text,

      p.currency0,
      p.currency1,
      p.token0_type,
      p.token1_type,

      l.block_timestamp,

      t.id AS token_id,
      t.address AS token_address,
      t.decimals AS token_decimals

    FROM swaps s

    JOIN pools p
      ON lower(p.pool_id) = lower(s.pool_id)

    JOIN logs l
      ON l.chain_id = s.chain_id
     AND l.tx_hash = s.tx_hash
     AND l.log_index = s.log_index

    JOIN tokens t
      ON lower(t.address) =
        CASE
          WHEN lower(p.currency0) = $2
            THEN lower(p.currency1)

          WHEN lower(p.currency1) = $2
            THEN lower(p.currency0)

          WHEN lower(p.currency0) = $3
            THEN lower(p.currency1)

          WHEN lower(p.currency1) = $3
            THEN lower(p.currency0)
        END

    LEFT JOIN trades tr
      ON tr.tx_hash = s.tx_hash
     AND tr.log_index = s.log_index

    WHERE s.chain_id = $1
      AND tr.id IS NULL
      AND l.block_timestamp IS NOT NULL
      AND t.decimals IS NOT NULL

      -- A normalized trade must exchange value on both sides.
      -- Zero-delta swap events are not BUY/SELL candidates.
      AND s.amount0 <> 0
      AND s.amount1 <> 0

      AND (
        lower(p.currency0) = $2
        OR lower(p.currency1) = $2
        OR lower(p.currency0) = $3
        OR lower(p.currency1) = $3
      )

    ORDER BY s.id ASC
    LIMIT $4
    `,
    [
      CHAIN_ID,
      ZERO_ADDRESS,
      WETH,
      BATCH_SIZE,
    ]
  );

  if (result.rows.length === 0) {
    return 0;
  }

  let inserted = 0;

  for (const row of result.rows) {
    const currency0 =
      String(row.currency0).toLowerCase();

    const currency1 =
      String(row.currency1).toLowerCase();

    const amount0 = BigInt(row.amount0);
    const amount1 = BigInt(row.amount1);

    let tokenRaw: bigint;
    let quoteRaw: bigint;

    /*
     * Base asset = discovered ERC-20 token.
     * Quote asset = native ETH or WETH.
     */
    if (
      currency0 === ZERO_ADDRESS ||
      currency0 === WETH
    ) {
      quoteRaw = amount0;
      tokenRaw = amount1;
    } else if (
      currency1 === ZERO_ADDRESS ||
      currency1 === WETH
    ) {
      tokenRaw = amount0;
      quoteRaw = amount1;
    } else {
      continue;
    }

    /*
     * PoolManager deltas:
     *
     * quote positive + token negative
     * = trader supplies quote, receives token
     * = BUY
     *
     * token positive + quote negative
     * = trader supplies token, receives quote
     * = SELL
     */
    let side: "BUY" | "SELL";

    if (quoteRaw > 0n && tokenRaw < 0n) {
      side = "BUY";
    } else if (tokenRaw > 0n && quoteRaw < 0n) {
      side = "SELL";
    } else {
      console.warn(
        `[TRADE SKIP] swap=${row.swap_id} ` +
        `unexpected deltas token=${tokenRaw} quote=${quoteRaw}`
      );
      continue;
    }

    const tokenAmount =
      absBigInt(tokenRaw);

    const nativeAmount =
      absBigInt(quoteRaw);

    /*
     * Store price as quote-native units per token,
     * adjusted to human decimals:
     *
     * price =
     * (nativeRaw / 1e18)
     * -----------------
     * (tokenRaw / 10^tokenDecimals)
     *
     * We calculate in PostgreSQL NUMERIC to avoid
     * JavaScript floating-point precision loss.
     */
    const client = await db.connect();

    try {
      await client.query("BEGIN");

      const insertResult = await client.query(
        `
        INSERT INTO trades (
          token_id,
          market_id,
          tx_hash,
          log_index,
          trader_address,
          side,
          token_amount,
          native_amount,
          price,
          block_number,
          block_timestamp
        )
        VALUES (
          $1,
          NULL,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,

          (
            ($7::numeric / 1000000000000000000::numeric)
            /
            (
              $6::numeric
              /
              power(
                10::numeric,
                $8::integer
              )
            )
          ),

          $9,
          $10
        )

        ON CONFLICT (tx_hash, log_index)
        DO NOTHING

        RETURNING id
        `,
        [
          row.token_id,
          row.tx_hash,
          Number(row.log_index),
          String(row.sender).toLowerCase(),
          side,
          tokenAmount.toString(),
          nativeAmount.toString(),
          Number(row.token_decimals),
          Number(row.block_number),
          row.block_timestamp,
        ]
      );

      await client.query("COMMIT");

      if (insertResult.rowCount === 1) {
        inserted++;
      }
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  console.log(
    `[TRADE BATCH] candidates=${result.rows.length} inserted=${inserted}`
  );

  return result.rows.length;
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO TRADE NORMALIZER V1");
  console.log(" ETH/WETH quote pairs");
  console.log(` Chain: ${CHAIN_ID}`);
  console.log("========================================");

  let consecutiveErrors = 0;

  while (true) {
    try {
      const processed = await processBatch();

      consecutiveErrors = 0;

      if (processed > 0) {
        continue;
      }

      await sleep(IDLE_MS);
    } catch (error) {
      consecutiveErrors++;

      const delay =
        Math.min(
          5000 *
            2 **
              Math.min(
                consecutiveErrors - 1,
                4
              ),
          60000
        ) +
        Math.floor(Math.random() * 3000);

      console.error(
        "[TRADE NORMALIZER ERROR]",
        error
      );

      console.log(
        `[TRADE NORMALIZER BACKOFF] ${delay}ms`
      );

      await sleep(delay);
    }
  }
}

main().catch(async (error) => {
  console.error(
    "[TRADE NORMALIZER FATAL]",
    error
  );

  await db.end();
  process.exit(1);
});
