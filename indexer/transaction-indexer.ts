import dotenv from "dotenv";
import { pool as db } from "../database/postgres.js";
import {
  getBlockNumber,
  getBlockWithTransactions,
  getChainId,
  getRpcUrl,
  type RpcTransaction,
} from "../config/rpc.js";

dotenv.config();

const POLL_MS = Number(
  process.env.TRANSACTION_INDEXER_POLL_MS || 2000
);

const CHECKPOINT_KEY =
  "transaction_indexer_last_block";

function hexToBigIntString(value?: string): string | null {
  if (!value || value === "0x") {
    return null;
  }

  return BigInt(value).toString();
}

function hexToNumber(value?: string): number | null {
  if (!value || value === "0x") {
    return null;
  }

  return Number(BigInt(value));
}

function normalizeAddress(
  address: string | null
): string | null {
  return address ? address.toLowerCase() : null;
}

async function getCheckpoint(): Promise<number> {
  const result = await db.query(
    `SELECT value
     FROM indexer_state
     WHERE key = $1
     LIMIT 1`,
    [CHECKPOINT_KEY]
  );

  if (!result.rows.length) {
    return 0;
  }

  const value = Number(result.rows[0].value);

  return Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

async function setCheckpoint(
  blockNumber: number
): Promise<void> {
  await db.query(
    `INSERT INTO indexer_state (
       key,
       value
     )
     VALUES ($1, $2)
     ON CONFLICT (key)
     DO UPDATE SET
       value = EXCLUDED.value,
       updated_at = NOW()`,
    [CHECKPOINT_KEY, String(blockNumber)]
  );
}

async function processBlock(
  blockNumber: number
): Promise<void> {
  const block =
    await getBlockWithTransactions(blockNumber);

  if (!block) {
    throw new Error(
      `Block ${blockNumber} not found`
    );
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    for (const tx of block.transactions) {
      const transactionIndex =
        hexToNumber(tx.transactionIndex);

      const nonce = hexToNumber(tx.nonce);

      if (transactionIndex === null) {
        throw new Error(
          `Missing transactionIndex for ${tx.hash}`
        );
      }

      await client.query(
        `INSERT INTO transactions (
           block_number,
           tx_hash,
           transaction_index,
           from_address,
           to_address,
           value,
           gas,
           gas_price,
           nonce,
           input
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
         )
         ON CONFLICT (tx_hash)
         DO UPDATE SET
           block_number = EXCLUDED.block_number,
           transaction_index = EXCLUDED.transaction_index,
           from_address = EXCLUDED.from_address,
           to_address = EXCLUDED.to_address,
           value = EXCLUDED.value,
           gas = EXCLUDED.gas,
           gas_price = EXCLUDED.gas_price,
           nonce = EXCLUDED.nonce,
           input = EXCLUDED.input`,
        [
          blockNumber,
          tx.hash.toLowerCase(),
          transactionIndex,
          normalizeAddress(tx.from),
          normalizeAddress(tx.to),
          hexToBigIntString(tx.value) ?? "0",
          hexToBigIntString(tx.gas),
          hexToBigIntString(tx.gasPrice),
          nonce,
          tx.input || "0x",
        ]
      );
    }

    await client.query(
      `INSERT INTO indexer_state (
         key,
         value
       )
       VALUES ($1, $2)
       ON CONFLICT (key)
       DO UPDATE SET
         value = EXCLUDED.value,
         updated_at = NOW()`,
      [CHECKPOINT_KEY, String(blockNumber)]
    );

    await client.query("COMMIT");

    console.log(
      `[TX BLOCK] block=${blockNumber} transactions=${block.transactions.length}`
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function bootstrap(): Promise<void> {
  console.log("");
  console.log("========================================");
  console.log(" XTO TRANSACTION INDEXER V1");
  console.log("========================================");

  const chainId = await getChainId();

  if (chainId !== 4663) {
    throw new Error(
      `Wrong chain ID. Expected 4663, received ${chainId}`
    );
  }

  console.log(`RPC      : ${getRpcUrl()}`);
  console.log(`Chain ID : ${chainId}`);

  let lastProcessed = await getCheckpoint();

  /*
   * First launch starts close to chain head.
   * Historical backfill will be handled separately.
   */
  if (lastProcessed === 0) {
    const latest = await getBlockNumber();

    lastProcessed = Math.max(0, latest - 1);

    await setCheckpoint(lastProcessed);

    console.log(
      `[TX INDEXER] First launch at ${lastProcessed}`
    );
  }

  let consecutiveErrors = 0;

  while (true) {
    try {
      const latest = await getBlockNumber();

      consecutiveErrors = 0;

      if (lastProcessed < latest) {
        const nextBlock = lastProcessed + 1;

        await processBlock(nextBlock);

        lastProcessed = nextBlock;
        continue;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, POLL_MS)
      );
    } catch (error) {
      console.error(
        "[TX INDEXER ERROR]",
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
        `[TX RPC BACKOFF] consecutive=${consecutiveErrors} retry_in_ms=${retryDelay}`
      );

      await new Promise((resolve) =>
        setTimeout(resolve, retryDelay)
      );
    }
  }
}

bootstrap().catch(async (error) => {
  console.error(
    "[TX INDEXER FATAL]",
    error
  );

  await db.end();
  process.exit(1);
});
