import "dotenv/config";

import { pool as db } from "../database/postgres.js";
import { getBlock } from "../config/rpc.js";

const CHAIN_ID = 4663;

const WETH =
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73";

const DELAY_MS = 150;
const BATCH_SIZE = 100;

const MAX_BLOCKS = Number(
  process.env.BACKFILL_MAX_BLOCKS || "0"
);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getTargetBlocks(): Promise<number[]> {
  const result = await db.query(
    `
    SELECT DISTINCT s.block_number
    FROM swaps s
    JOIN pools p
      ON lower(p.pool_id) = lower(s.pool_id)
    JOIN logs l
      ON l.chain_id = s.chain_id
     AND l.tx_hash = s.tx_hash
     AND l.log_index = s.log_index
    WHERE s.chain_id = $1
      AND l.block_timestamp IS NULL
      AND (
        p.token0_type = 'native'
        OR p.token1_type = 'native'
        OR lower(p.currency0) = $2
        OR lower(p.currency1) = $2
      )
    ORDER BY s.block_number ASC
    LIMIT $3
    `,
    [CHAIN_ID, WETH, BATCH_SIZE]
  );

  return result.rows.map(
    (row) => Number(row.block_number)
  );
}

async function processBlock(
  blockNumber: number
): Promise<void> {
  const block = await getBlock(blockNumber);

  if (!block) {
    throw new Error(
      `Block ${blockNumber} not found`
    );
  }

  const timestampSeconds =
    parseInt(block.timestamp, 16);

  if (
    !Number.isSafeInteger(timestampSeconds) ||
    timestampSeconds <= 0
  ) {
    throw new Error(
      `Invalid timestamp block=${blockNumber} value=${block.timestamp}`
    );
  }

  const blockTimestamp =
    new Date(timestampSeconds * 1000);

  const result = await db.query(
    `
    UPDATE logs
    SET block_timestamp = $1
    WHERE chain_id = $2
      AND block_number = $3
      AND block_timestamp IS NULL
    `,
    [
      blockTimestamp,
      CHAIN_ID,
      blockNumber,
    ]
  );

  console.log(
    `[TIMESTAMP BACKFILL] block=${blockNumber} ` +
    `timestamp=${blockTimestamp.toISOString()} ` +
    `logs=${result.rowCount ?? 0}`
  );
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO TRADE TIMESTAMP BACKFILL");
  console.log(" Target: ETH/WETH trade blocks only");
  console.log("========================================");

  let processedBlocks = 0;

  while (true) {
    const blocks = await getTargetBlocks();

    if (blocks.length === 0) {
      console.log(
        `[BACKFILL COMPLETE] blocks=${processedBlocks}`
      );
      break;
    }

    for (const blockNumber of blocks) {
      let attempt = 0;

      while (true) {
        try {
          await processBlock(blockNumber);
          processedBlocks++;
          break;
        } catch (error) {
          attempt++;

          const message =
            error instanceof Error
              ? error.message
              : String(error);

          const delay =
            Math.min(
              2000 * 2 ** Math.min(attempt - 1, 5),
              30000
            ) +
            Math.floor(Math.random() * 1000);

          console.error(
            `[BACKFILL ERROR] block=${blockNumber} ` +
            `attempt=${attempt} ${message}`
          );

          console.log(
            `[BACKFILL RETRY] ${delay}ms`
          );

          await sleep(delay);
        }
      }

      await sleep(DELAY_MS);

      if (
        MAX_BLOCKS > 0 &&
        processedBlocks >= MAX_BLOCKS
      ) {
        console.log(
          `[BACKFILL TEST LIMIT] blocks=${processedBlocks}`
        );
        return;
      }
    }

    console.log(
      `[BACKFILL PROGRESS] processed=${processedBlocks}`
    );
  }
}

main()
  .catch((error) => {
    console.error("[BACKFILL FATAL]", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.end();
  });
