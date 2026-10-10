import "dotenv/config";
import { pool as db } from "../database/postgres.js";

const CHAIN_ID = 4663;

const POOL_MANAGER =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

const CHECKPOINT_KEY = "swap_decoder_v2_last_log_id";
const BATCH_SIZE = 500;
const IDLE_MS = 3000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function word(data: string, index: number): string {
  const start = 2 + index * 64;
  return `0x${data.slice(start, start + 64)}`;
}

function signed256(hex: string): bigint {
  const value = BigInt(hex);
  const sign = 1n << 255n;

  return value & sign
    ? value - (1n << 256n)
    : value;
}

function addressFromTopic(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

async function getCheckpoint(): Promise<number> {
  const result = await db.query(
    `SELECT value
       FROM indexer_state
      WHERE key = $1
      LIMIT 1`,
    [CHECKPOINT_KEY]
  );

  if (!result.rows.length) return 0;

  const value = Number(result.rows[0].value);

  return Number.isFinite(value) ? value : 0;
}

async function processBatch(): Promise<number> {
  const checkpoint = await getCheckpoint();

  /*
   * IMPORTANT:
   * We intentionally JOIN pools here.
   *
   * Only swaps belonging to pools already known by the
   * Pool Registry are decoded into the canonical swaps table.
   *
   * Historical swaps whose Initialize event predates our
   * current raw-log window remain safely in logs and can be
   * recovered later by historical pool backfill.
   */
  const result = await db.query(
    `SELECT
       l.id,
       l.block_number,
       l.tx_hash,
       l.log_index,
       l.topic1 AS pool_id,
       l.topic2 AS sender_topic,
       l.data
     FROM logs l
     INNER JOIN pools p
       ON lower(p.pool_id) = lower(l.topic1)
     WHERE l.chain_id = $1
       AND l.id > $2
       AND lower(l.address) = $3
       AND l.topic0 = $4
       AND l.removed = FALSE
     ORDER BY l.id ASC
     LIMIT $5`,
    [
      CHAIN_ID,
      checkpoint,
      POOL_MANAGER,
      SWAP_TOPIC,
      BATCH_SIZE,
    ]
  );

  if (!result.rows.length) {
    return 0;
  }

  for (const log of result.rows) {
    if (!log.pool_id || !log.sender_topic) {
      throw new Error(
        `Malformed Swap topics log_id=${log.id}`
      );
    }

    if (
      !log.data ||
      log.data.length !== 2 + 64 * 6
    ) {
      throw new Error(
        `Invalid Swap data log_id=${log.id} ` +
        `length=${log.data?.length}`
      );
    }

    const poolId =
      String(log.pool_id).toLowerCase();

    const sender =
      addressFromTopic(log.sender_topic);

    const amount0 =
      signed256(word(log.data, 0));

    const amount1 =
      signed256(word(log.data, 1));

    const sqrtPriceX96 =
      BigInt(word(log.data, 2));

    const liquidity =
      BigInt(word(log.data, 3));

    const tick =
      signed256(word(log.data, 4));

    const fee =
      BigInt(word(log.data, 5));

    if (
      tick < BigInt(-2147483648) ||
      tick > BigInt(2147483647)
    ) {
      throw new Error(
        `Tick outside INTEGER range log_id=${log.id}`
      );
    }

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO swaps (
           chain_id,
           pool_id,
           tx_hash,
           log_index,
           block_number,
           sender,
           amount0,
           amount1,
           sqrt_price_x96,
           liquidity,
           tick,
           fee
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,
           $7,$8,$9,$10,$11,$12
         )
         ON CONFLICT (
           chain_id,
           tx_hash,
           log_index
         )
         DO UPDATE SET
           pool_id = EXCLUDED.pool_id,
           block_number = EXCLUDED.block_number,
           sender = EXCLUDED.sender,
           amount0 = EXCLUDED.amount0,
           amount1 = EXCLUDED.amount1,
           sqrt_price_x96 = EXCLUDED.sqrt_price_x96,
           liquidity = EXCLUDED.liquidity,
           tick = EXCLUDED.tick,
           fee = EXCLUDED.fee`,
        [
          CHAIN_ID,
          poolId,
          log.tx_hash,
          Number(log.log_index),
          Number(log.block_number),
          sender,
          amount0.toString(),
          amount1.toString(),
          sqrtPriceX96.toString(),
          liquidity.toString(),
          Number(tick),
          fee.toString(),
        ]
      );

      await client.query(
        `INSERT INTO indexer_state (
           key,
           value,
           updated_at
         )
         VALUES ($1,$2,NOW())
         ON CONFLICT (key)
         DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = NOW()`,
        [
          CHECKPOINT_KEY,
          String(log.id),
        ]
      );

      await client.query("COMMIT");

      console.log(
        `[SWAP V2] log=${log.id} ` +
        `block=${log.block_number} ` +
        `pool=${poolId} ` +
        `amount0=${amount0} ` +
        `amount1=${amount1} ` +
        `tick=${tick} fee=${fee}`
      );
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return result.rows.length;
}

async function main() {
  console.log("========================================");
  console.log(" XTO SWAP DECODER V2");
  console.log(" Source: PostgreSQL raw logs");
  console.log(` Chain : ${CHAIN_ID}`);
  console.log("========================================");

  let consecutiveErrors = 0;

  while (true) {
    try {
      const processed = await processBatch();

      consecutiveErrors = 0;

      if (processed > 0) {
        console.log(
          `[SWAP V2 BATCH] processed=${processed}`
        );

        continue;
      }

      await sleep(IDLE_MS);
    } catch (error) {
      consecutiveErrors++;

      const backoff =
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
        "[SWAP V2 ERROR]",
        error
      );

      console.log(
        `[SWAP V2 BACKOFF] ${backoff}ms`
      );

      await sleep(backoff);
    }
  }
}

main().catch(async (error) => {
  console.error(
    "[SWAP V2 FATAL]",
    error
  );

  await db.end();
  process.exit(1);
});
