import dotenv from "dotenv";
import { pool as db } from "../database/postgres.js";
import {
  getBlockNumber,
  getChainId,
  getRpcUrl,
  rpc,
} from "../config/rpc.js";

dotenv.config();

const POOL_MANAGER =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const INITIALIZE_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

const POLL_MS = Number(process.env.INDEXER_POLL_MS || 2000);
const CHUNK_SIZE = 500;

type Log = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

type TokenMetadata = {
  address: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
  totalSupply: string | null;
};

function hexToNumber(value: string): number {
  return parseInt(value, 16);
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

  // ABI int24 is sign-extended to 256 bits.
  // Keep only the lower 24 bits first.
  const raw = value & 0xffffffn;

  const signed =
    raw & 0x800000n
      ? raw - 0x1000000n
      : raw;

  return Number(signed);
}

function isNative(address: string): boolean {
  return /^0x0{40}$/i.test(address);
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

async function ethCall(
  to: string,
  data: string
): Promise<string | null> {
  try {
    return await rpc<string>("eth_call", [
      {
        to,
        data,
      },
      "latest",
    ]);
  } catch {
    return null;
  }
}

function encodeSelector(selector: string): string {
  return selector.replace(/^0x/, "");
}

function decodeUint256(value: string): string | null {
  if (!value || value === "0x") {
    return null;
  }

  return BigInt(value).toString();
}

function decodeUint8(value: string): number | null {
  if (!value || value === "0x") {
    return null;
  }

  return Number(BigInt(value));
}

function decodeString(value: string): string | null {
  if (!value || value === "0x") {
    return null;
  }

  try {
    const hex = value.slice(2);

    /*
     * Standard ABI dynamic string:
     *
     * offset
     * length
     * bytes
     */
    if (hex.length >= 128) {
      const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
      const lengthOffset = offset * 2;

      const length = Number(
        BigInt(
          `0x${hex.slice(
            lengthOffset,
            lengthOffset + 64
          )}`
        )
      );

      const dataStart = lengthOffset + 64;
      const dataEnd = dataStart + length * 2;

      return Buffer.from(
        hex.slice(dataStart, dataEnd),
        "hex"
      ).toString("utf8");
    }

    /*
     * bytes32 fallback.
     */
    return Buffer.from(hex.slice(0, 64), "hex")
      .toString("utf8")
      .replace(/\0+$/, "");
  } catch {
    return null;
  }
}

async function getTokenMetadata(
  address: string
): Promise<TokenMetadata> {
  const normalized = normalizeAddress(address);

  if (isNative(normalized)) {
    return {
      address: normalized,
      name: "Native",
      symbol: "ETH",
      decimals: 18,
      totalSupply: null,
    };
  }

  const [nameRaw, symbolRaw, decimalsRaw, supplyRaw] =
    await Promise.all([
      ethCall(
        normalized,
        `0x${encodeSelector("0x06fdde03")}`
      ),
      ethCall(
        normalized,
        `0x${encodeSelector("0x95d89b41")}`
      ),
      ethCall(
        normalized,
        `0x${encodeSelector("0x313ce567")}`
      ),
      ethCall(
        normalized,
        `0x${encodeSelector("0x18160ddd")}`
      ),
    ]);

  return {
    address: normalized,
    name: decodeString(nameRaw || ""),
    symbol: decodeString(symbolRaw || ""),
    decimals: decodeUint8(decimalsRaw || ""),
    totalSupply: decodeUint256(supplyRaw || ""),
  };
}

async function getInitializeLogs(
  fromBlock: number,
  toBlock: number
): Promise<Log[]> {
  return await rpc<Log[]>("eth_getLogs", [
    {
      address: POOL_MANAGER,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      topics: [INITIALIZE_TOPIC],
    },
  ]);
}

async function getCheckpoint(): Promise<number> {
  const result = await db.query(
    `SELECT value
     FROM indexer_state
     WHERE key = 'pool_registry_last_block'
     LIMIT 1`
  );

  if (!result.rows.length) {
    return 0;
  }

  const value = Number(result.rows[0].value);

  return Number.isFinite(value) ? value : 0;
}

async function setCheckpoint(blockNumber: number) {
  await db.query(
    `INSERT INTO indexer_state (
       key,
       value,
       status
     )
     VALUES (
       'pool_registry_last_block',
       $1,
       'running'
     )
     ON CONFLICT (key)
     DO UPDATE SET
       value = EXCLUDED.value,
       status = 'running',
       updated_at = NOW()`,
    [String(blockNumber)]
  );
}

async function savePool(log: Log): Promise<void> {
  if (log.topics.length < 4) {
    throw new Error(
      `Invalid Initialize log: ${log.transactionHash}`
    );
  }

  const poolId = log.topics[1].toLowerCase();
  const currency0 = topicAddress(log.topics[2]);
  const currency1 = topicAddress(log.topics[3]);

  /*
   * Proven Robinhood PoolManager Initialize layout:
   *
   * word 0 = fee
   * word 1 = tickSpacing
   * word 2 = hooks
   * word 3 = sqrtPriceX96
   * word 4 = tick
   */
  const fee = BigInt(wordHex(log.data, 0)).toString();

  const tickSpacing = Number(
    BigInt(wordHex(log.data, 1))
  );

  const hooks = `0x${word(log.data, 2).slice(-40)}`.toLowerCase();

  const sqrtPriceX96 = BigInt(
    wordHex(log.data, 3)
  ).toString();

  const tick = signedInt24(word(log.data, 4));

  const blockNumber = hexToNumber(log.blockNumber);

  const token0 = await getTokenMetadata(currency0);
  const token1 = await getTokenMetadata(currency1);

  await db.query(
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

      isNative(currency0) ? "native" : "erc20",
      isNative(currency1) ? "native" : "erc20",

      token0.name,
      token1.name,

      token0.symbol,
      token1.symbol,

      token0.decimals,
      token1.decimals,

      token0.totalSupply,
      token1.totalSupply,

      fee,
      tickSpacing,
      hooks,
      sqrtPriceX96,
      tick,
      blockNumber,
      log.transactionHash,
    ]
  );

  console.log(
    `[POOL] block=${blockNumber} pool=${poolId} ` +
      `${token0.symbol || "ETH"}/${token1.symbol || "TOKEN"} ` +
      `fee=${fee} tick=${tick}`
  );
}

async function processRange(
  fromBlock: number,
  toBlock: number
): Promise<void> {
  const logs = await getInitializeLogs(
    fromBlock,
    toBlock
  );

  console.log(
    `[POOL SCAN] ${fromBlock} → ${toBlock} logs=${logs.length}`
  );

  for (const log of logs) {
    await savePool(log);
  }

  await setCheckpoint(toBlock);
}

async function bootstrap() {
  console.log("");
  console.log("========================================");
  console.log(" XTO POOL REGISTRY INDEXER V1");
  console.log("========================================");

  const chainId = await getChainId();

  if (chainId !== 4663) {
    throw new Error(
      `Wrong chain ID. Expected 4663, received ${chainId}`
    );
  }

  console.log(`RPC        : ${getRpcUrl()}`);
  console.log(`Chain ID   : ${chainId}`);
  console.log(`PoolManager: ${POOL_MANAGER}`);
  console.log("");

  let lastProcessed = await getCheckpoint();

  /*
   * First launch:
   * Start close to current chain head.
   * Existing historical pools are already imported.
   */
  if (lastProcessed === 0) {
    const latest = await getBlockNumber();

    lastProcessed = Math.max(
      0,
      latest - 20
    );

    await setCheckpoint(lastProcessed);

    console.log(
      `[POOL INDEXER] First launch at ${lastProcessed}`
    );
  }

  while (true) {
    try {
      const latest = await getBlockNumber();

      if (lastProcessed < latest) {
        const toBlock = Math.min(
          lastProcessed + CHUNK_SIZE,
          latest
        );

        await processRange(
          lastProcessed + 1,
          toBlock
        );

        lastProcessed = toBlock;

        continue;
      }

      await new Promise((resolve) =>
        setTimeout(resolve, POLL_MS)
      );
    } catch (error) {
      console.error(
        "[POOL INDEXER ERROR]",
        error
      );

      await new Promise((resolve) =>
        setTimeout(resolve, 5000)
      );
    }
  }
}

bootstrap().catch(async (error) => {
  console.error(
    "[POOL INDEXER FATAL]",
    error
  );

  await db.end();

  process.exit(1);
});
