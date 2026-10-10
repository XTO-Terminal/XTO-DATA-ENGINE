import dotenv from "dotenv";
import { pool as db } from "../database/postgres.js";

dotenv.config();

const CHAIN_ID = 4663;
const POOL_MANAGER =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const INITIALIZE_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

const CHECKPOINT_KEY = "pool_registry_v2_last_log_id";
const BATCH_SIZE = 100;
const IDLE_MS = 5000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function topicAddress(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}

function word(data: string, index: number): string {
  const start = 2 + index * 64;
  return data.slice(start, start + 64);
}

function wordHex(data: string, index: number): string {
  return `0x${word(data, index)}`;
}

function signedInt24(hex: string): number {
  const value = BigInt(`0x${hex}`);
  const raw = value & 0xffffffn;
  return Number(
    raw & 0x800000n
      ? raw - 0x1000000n
      : raw
  );
}

function isNative(address: string): boolean {
  return /^0x0{40}$/i.test(address);
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

async function getToken(address: string) {
  if (isNative(address)) {
    return {
      address,
      name: "Native",
      symbol: "ETH",
      decimals: 18,
      total_supply: null,
      type: "native",
    };
  }

  const result = await db.query(
    `SELECT
       address,
       name,
       symbol,
       decimals,
       total_supply
     FROM tokens
     WHERE lower(address) = $1
     LIMIT 1`,
    [address.toLowerCase()]
  );

  const token = result.rows[0];

  return {
    address: address.toLowerCase(),
    name: token?.name ?? null,
    symbol: token?.symbol ?? null,
    decimals: token?.decimals ?? null,
    total_supply: token?.total_supply ?? null,
    type: "erc20",
  };
}

async function processBatch(): Promise<number> {
  const checkpoint = await getCheckpoint();

  const result = await db.query(
    `SELECT
       id,
       block_number,
       tx_hash,
       log_index,
       topic1,
       topic2,
       topic3,
       data
     FROM logs
     WHERE chain_id = $1
       AND id > $2
       AND lower(address) = $3
       AND topic0 = $4
     ORDER BY id ASC
     LIMIT $5`,
    [
      CHAIN_ID,
      checkpoint,
      POOL_MANAGER,
      INITIALIZE_TOPIC,
      BATCH_SIZE,
    ]
  );

  if (!result.rows.length) return 0;

  for (const log of result.rows) {
    if (!log.topic1 || !log.topic2 || !log.topic3) {
      throw new Error(`Malformed Initialize log id=${log.id}`);
    }

    if (!log.data || log.data.length !== 2 + 64 * 5) {
      throw new Error(
        `Invalid Initialize data id=${log.id} length=${log.data?.length}`
      );
    }

    const poolId = String(log.topic1).toLowerCase();
    const currency0 = topicAddress(log.topic2);
    const currency1 = topicAddress(log.topic3);

    const fee = BigInt(wordHex(log.data, 0)).toString();
    const tickSpacing = Number(BigInt(wordHex(log.data, 1)));
    const hooks =
      `0x${word(log.data, 2).slice(-40)}`.toLowerCase();
    const sqrtPriceX96 =
      BigInt(wordHex(log.data, 3)).toString();
    const tick = signedInt24(word(log.data, 4));

    const token0 = await getToken(currency0);
    const token1 = await getToken(currency1);

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      await client.query(
        `INSERT INTO pools (
           pool_id,
           pool_manager,
           currency0,
           currency1,
           token0_address,
           token1_address,
           token0_type,
           token1_type,
           token0_name,
           token1_name,
           token0_symbol,
           token1_symbol,
           token0_decimals,
           token1_decimals,
           token0_total_supply,
           token1_total_supply,
           fee,
           tick_spacing,
           hooks,
           sqrt_price_x96,
           tick,
           initialized_at_block,
           initialize_tx,
           updated_at
         )
         VALUES (
           $1,$2,$3,$4,$5,$6,$7,$8,
           $9,$10,$11,$12,$13,$14,$15,$16,
           $17,$18,$19,$20,$21,$22,$23,NOW()
         )
         ON CONFLICT (pool_id)
         DO UPDATE SET
           pool_manager = EXCLUDED.pool_manager,
           currency0 = EXCLUDED.currency0,
           currency1 = EXCLUDED.currency1,
           token0_address = EXCLUDED.token0_address,
           token1_address = EXCLUDED.token1_address,
           token0_type = EXCLUDED.token0_type,
           token1_type = EXCLUDED.token1_type,
           token0_name = EXCLUDED.token0_name,
           token1_name = EXCLUDED.token1_name,
           token0_symbol = EXCLUDED.token0_symbol,
           token1_symbol = EXCLUDED.token1_symbol,
           token0_decimals = EXCLUDED.token0_decimals,
           token1_decimals = EXCLUDED.token1_decimals,
           token0_total_supply = EXCLUDED.token0_total_supply,
           token1_total_supply = EXCLUDED.token1_total_supply,
           fee = EXCLUDED.fee,
           tick_spacing = EXCLUDED.tick_spacing,
           hooks = EXCLUDED.hooks,
           sqrt_price_x96 = EXCLUDED.sqrt_price_x96,
           tick = EXCLUDED.tick,
           initialized_at_block = EXCLUDED.initialized_at_block,
           initialize_tx = EXCLUDED.initialize_tx,
           updated_at = NOW()`,
        [
          poolId,
          POOL_MANAGER,
          currency0,
          currency1,
          token0.address,
          token1.address,
          token0.type,
          token1.type,
          token0.name,
          token1.name,
          token0.symbol,
          token1.symbol,
          token0.decimals,
          token1.decimals,
          token0.total_supply,
          token1.total_supply,
          fee,
          tickSpacing,
          hooks,
          sqrtPriceX96,
          tick,
          Number(log.block_number),
          log.tx_hash,
        ]
      );

      await client.query(
        `INSERT INTO indexer_state (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key)
         DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = NOW()`,
        [CHECKPOINT_KEY, String(log.id)]
      );

      await client.query("COMMIT");

      console.log(
        `[POOL V2] log=${log.id} block=${log.block_number} ` +
        `pool=${poolId} ` +
        `${token0.symbol ?? currency0}/${token1.symbol ?? currency1} ` +
        `fee=${fee} tickSpacing=${tickSpacing} tick=${tick}`
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
  console.log(" XTO POOL REGISTRY V2");
  console.log(" Source: PostgreSQL raw logs");
  console.log(` Chain : ${CHAIN_ID}`);
  console.log("========================================");

  let consecutiveErrors = 0;

  while (true) {
    try {
      const processed = await processBatch();
      consecutiveErrors = 0;

      if (processed > 0) {
        console.log(`[POOL V2 BATCH] processed=${processed}`);
        continue;
      }

      await sleep(IDLE_MS);
    } catch (error) {
      consecutiveErrors++;

      const backoff =
        Math.min(
          5000 * 2 ** Math.min(consecutiveErrors - 1, 4),
          60000
        ) + Math.floor(Math.random() * 3000);

      console.error("[POOL V2 ERROR]", error);
      console.log(`[POOL V2 BACKOFF] ${backoff}ms`);

      await sleep(backoff);
    }
  }
}

main().catch(async (error) => {
  console.error("[POOL V2 FATAL]", error);
  await db.end();
  process.exit(1);
});
