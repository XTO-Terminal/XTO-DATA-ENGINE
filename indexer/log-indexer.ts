import { pool as db } from "../database/postgres.js";
import {
  getBlock,
  getBlockNumber,
  getChainId,
  getLogs,
  getRpcUrl,
  type RpcLog,
} from "../config/rpc.js";

const EXPECTED_CHAIN_ID = 4663;
const CHECKPOINT_KEY = "log_indexer_last_block";

function hexToNumber(value: string): number {
  return parseInt(value, 16);
}

function normalize(value: string): string {
  return value.toLowerCase();
}

async function getCheckpoint(): Promise<number | null> {
  const result = await db.query(
    `
    SELECT value
    FROM indexer_state
    WHERE key = $1
    `,
    [CHECKPOINT_KEY]
  );

  if (result.rowCount === 0) {
    return null;
  }

  const value = Number(result.rows[0].value);

  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `Invalid checkpoint value for ${CHECKPOINT_KEY}: ${result.rows[0].value}`
    );
  }

  return value;
}

async function writeLog(
  client: any,
  chainId: number,
  log: RpcLog,
  blockTimestamp: Date
): Promise<void> {
  await client.query(
    `
    INSERT INTO logs (
      chain_id,
      block_number,
      block_hash,
      tx_hash,
      transaction_index,
      log_index,
      address,
      topic0,
      topic1,
      topic2,
      topic3,
      data,
      removed,
      block_timestamp
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
    )
    ON CONFLICT (chain_id, tx_hash, log_index)
    DO UPDATE SET
      block_number = EXCLUDED.block_number,
      block_hash = EXCLUDED.block_hash,
      transaction_index = EXCLUDED.transaction_index,
      address = EXCLUDED.address,
      topic0 = EXCLUDED.topic0,
      topic1 = EXCLUDED.topic1,
      topic2 = EXCLUDED.topic2,
      topic3 = EXCLUDED.topic3,
      data = EXCLUDED.data,
      removed = EXCLUDED.removed,
      block_timestamp = EXCLUDED.block_timestamp
    `,
    [
      chainId,
      hexToNumber(log.blockNumber),
      normalize(log.blockHash),
      normalize(log.transactionHash),
      hexToNumber(log.transactionIndex),
      hexToNumber(log.logIndex),
      normalize(log.address),
      log.topics[0]?.toLowerCase() ?? null,
      log.topics[1]?.toLowerCase() ?? null,
      log.topics[2]?.toLowerCase() ?? null,
      log.topics[3]?.toLowerCase() ?? null,
      log.data.toLowerCase(),
      log.removed ?? false,
      blockTimestamp,
    ]
  );
}

async function processBlock(
  chainId: number,
  blockNumber: number
): Promise<void> {
  const logs = await getLogs({
    fromBlock: blockNumber,
    toBlock: blockNumber,
  });

  const block = await getBlock(blockNumber);

  if (!block) {
    throw new Error(
      `Block ${blockNumber} not found while resolving timestamp`
    );
  }

  const timestampSeconds = parseInt(block.timestamp, 16);

  if (!Number.isSafeInteger(timestampSeconds) || timestampSeconds <= 0) {
    throw new Error(
      `Invalid timestamp for block ${blockNumber}: ${block.timestamp}`
    );
  }

  const blockTimestamp = new Date(timestampSeconds * 1000);

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    for (const log of logs) {
      await writeLog(
        client,
        chainId,
        log,
        blockTimestamp
      );
    }

    await client.query(
      `
      INSERT INTO indexer_state (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
      `,
      [CHECKPOINT_KEY, String(blockNumber)]
    );

    await client.query("COMMIT");

    console.log(
      `[LOG BLOCK] block=${blockNumber} logs=${logs.length}`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function main(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO LOG INDEXER V1");
  console.log("========================================");

  console.log(`RPC      : ${getRpcUrl()}`);

  const chainId = await getChainId();

  console.log(`Chain ID : ${chainId}`);

  if (chainId !== EXPECTED_CHAIN_ID) {
    throw new Error(
      `Unexpected chain ID ${chainId}; expected ${EXPECTED_CHAIN_ID}`
    );
  }

  let checkpoint = await getCheckpoint();

  if (checkpoint === null) {
    const latest = await getBlockNumber();
    checkpoint = Math.max(0, latest - 1);

    await db.query(
      `
      INSERT INTO indexer_state (key, value, updated_at)
      VALUES ($1, $2, NOW())
      ON CONFLICT (key)
      DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = NOW()
      `,
      [CHECKPOINT_KEY, String(checkpoint)]
    );

    console.log(
      `[LOG INDEXER] First launch at ${checkpoint}`
    );
  }

  let currentBlock: number = checkpoint;

  let consecutiveErrors = 0;

  while (true) {
    try {
      const latest = await getBlockNumber();

      consecutiveErrors = 0;

      if (currentBlock >= latest) {
        await new Promise((resolve) =>
          setTimeout(resolve, 1000)
        );
        continue;
      }

      const nextBlock: number = currentBlock + 1;

      await processBlock(chainId, nextBlock);

      currentBlock = nextBlock;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      console.error(
        `[LOG INDEXER ERROR] ${message}`
      );

      consecutiveErrors += 1;

      const baseDelay = Math.min(
        5000 * (2 ** Math.min(consecutiveErrors - 1, 4)),
        60000
      );

      const jitter = Math.floor(Math.random() * 3000);
      const retryDelay = baseDelay + jitter;

      console.error(
        `[LOG RPC BACKOFF] consecutive=${consecutiveErrors} retry_in_ms=${retryDelay}`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay)
      );
    }
  }
}

main().catch(async (error) => {
  console.error("[LOG INDEXER FATAL]", error);

  try {
    await db.end();
  } catch {}

  process.exit(1);
});
