import dotenv from "dotenv";
import { pool } from "../database/postgres.js";
import {
  getBlock,
  getBlockNumber,
  getChainId,
  getRpcUrl,
} from "../config/rpc.js";

dotenv.config();

const POLL_MS = Number(process.env.INDEXER_POLL_MS || 2000);
const START_BLOCK = Number(process.env.INDEXER_START_BLOCK || 0);

async function getLastProcessedBlock(): Promise<number> {
  const result = await pool.query(
    `SELECT value
     FROM indexer_state
     WHERE key = 'last_processed_block'
     LIMIT 1`
  );

  if (!result.rows.length) {
    return START_BLOCK - 1;
  }

  const value = Number(result.rows[0].value);

  return Number.isFinite(value)
    ? value
    : START_BLOCK - 1;
}

async function setLastProcessedBlock(
  blockNumber: number
): Promise<void> {
  await pool.query(
    `INSERT INTO indexer_state (key, value)
     VALUES ('last_processed_block', $1)
     ON CONFLICT (key)
     DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`,
    [String(blockNumber)]
  );

  await pool.query(
    `INSERT INTO indexer_state (key, value)
     VALUES ('status', 'running')
     ON CONFLICT (key)
     DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`
  );
}

async function saveBlock(
  blockNumber: number
): Promise<void> {
  const block = await getBlock(blockNumber);

  if (!block) {
    throw new Error(
      `Block ${blockNumber} returned null`
    );
  }

  const timestamp = new Date(
    parseInt(block.timestamp, 16) * 1000
  );

  await pool.query(
    `INSERT INTO blocks (
       block_number,
       block_hash,
       parent_hash,
       timestamp
     )
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (block_number)
     DO UPDATE SET
       block_hash = EXCLUDED.block_hash,
       parent_hash = EXCLUDED.parent_hash,
       timestamp = EXCLUDED.timestamp`,
    [
      blockNumber,
      block.hash,
      block.parentHash,
      timestamp,
    ]
  );

  await setLastProcessedBlock(blockNumber);

  console.log(
    `[INDEXER] block=${blockNumber} hash=${block.hash}`
  );
}

async function bootstrap(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO BLOCK INDEXER V1");
  console.log("========================================");

  const chainId = await getChainId();
  const latest = await getBlockNumber();

  console.log(`RPC       : ${getRpcUrl()}`);
  console.log(`Chain ID  : ${chainId}`);
  console.log(`Latest    : ${latest}`);
  console.log(`Poll      : ${POLL_MS}ms`);
  console.log("");

  if (chainId !== 4663) {
    throw new Error(
      `Wrong chain ID. Expected 4663, received ${chainId}`
    );
  }

  let lastProcessed =
    await getLastProcessedBlock();

  /*
   * First launch:
   * Do NOT backfill the entire chain.
   * Start at latest block.
   */
  if (lastProcessed < 0) {
    lastProcessed = latest - 1;
  }

  // Safety: never backfill the entire chain on first deployment.
  // If state is still at the initial value, start from latest - 1.
  if (lastProcessed === 0 && latest > 100) {
    lastProcessed = latest - 1;
  }

  console.log(
    `[INDEXER] Starting from ${lastProcessed + 1}`
  );

  let consecutiveErrors = 0;

  while (true) {
    try {
      const currentLatest =
        await getBlockNumber();

      consecutiveErrors = 0;

      if (lastProcessed < currentLatest) {
        const nextBlock =
          lastProcessed + 1;

        await saveBlock(nextBlock);

        lastProcessed = nextBlock;

        continue;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, POLL_MS)
      );
    } catch (error) {
      console.error(
        "[INDEXER ERROR]",
        error
      );

      consecutiveErrors += 1;

      const baseDelay = Math.min(
        5000 * (2 ** Math.min(consecutiveErrors - 1, 4)),
        60000
      );

      const jitter = Math.floor(Math.random() * 3000);
      const retryDelay = baseDelay + jitter;

      console.error(
        `[INDEXER RPC BACKOFF] consecutive=${consecutiveErrors} retry_in_ms=${retryDelay}`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay)
      );
    }
  }
}

bootstrap().catch(async (error) => {
  console.error(
    "[INDEXER FATAL]",
    error
  );

  await pool.end();

  process.exit(1);
});
