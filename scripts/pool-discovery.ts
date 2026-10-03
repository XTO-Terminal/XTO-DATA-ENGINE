import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const RPC = process.env.RH_RPC_URL!;

const POOL_MANAGER =
  "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

const INIT_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

const OUTPUT = path.join(
  process.cwd(),
  "logs",
  "pool-discovery.json"
);

async function rpc(method: string, params: any[]) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const j: any = await r.json();

  if (j.error) {
    throw new Error(JSON.stringify(j.error));
  }

  return j.result;
}

function hexBlock(n: number) {
  return "0x" + n.toString(16);
}

function word(data: string, index: number) {
  return data.slice(
    2 + index * 64,
    2 + (index + 1) * 64
  );
}

function uint(data: string, index: number) {
  const w = word(data, index);

  if (!w) {
    throw new Error(`Missing word ${index}`);
  }

  return BigInt("0x" + w);
}

function signed(data: string, index: number) {
  let n = uint(data, index);

  if (n >= (1n << 255n)) {
    n -= 1n << 256n;
  }

  return n;
}

function topicAddress(topic: string) {
  return "0x" + topic.slice(-40);
}

function wordAddress(data: string, index: number) {
  return "0x" + word(data, index).slice(-40);
}

function decodeString(hex: string | null) {
  if (!hex || hex === "0x") return null;

  try {
    const clean = hex.slice(2);

    if (clean.length >= 128) {
      const offset = Number(
        BigInt("0x" + clean.slice(0, 64))
      );

      const length = Number(
        BigInt(
          "0x" +
          clean.slice(
            offset * 2,
            offset * 2 + 64
          )
        )
      );

      const bytes = clean.slice(
        offset * 2 + 64,
        offset * 2 + 64 + length * 2
      );

      return Buffer.from(bytes, "hex").toString("utf8");
    }

    return Buffer.from(
      clean.slice(0, 64),
      "hex"
    )
      .toString("utf8")
      .replace(/\0/g, "");
  } catch {
    return null;
  }
}

function decodeUint(hex: string | null) {
  if (!hex || hex === "0x") return null;

  try {
    return BigInt(hex).toString();
  } catch {
    return null;
  }
}

async function ethCall(
  token: string,
  selector: string
) {
  try {
    return await rpc("eth_call", [
      {
        to: token,
        data: selector,
      },
      "latest",
    ]);
  } catch {
    return null;
  }
}

async function tokenMetadata(
  token: string
) {
  const code = await rpc("eth_getCode", [
    token,
    "latest",
  ]);

  if (code === "0x") {
    return {
      address: token,
      type: "native",
      name: null,
      symbol: null,
      decimals: null,
      totalSupply: null,
    };
  }

  const [
    nameRaw,
    symbolRaw,
    decimalsRaw,
    supplyRaw,
  ] = await Promise.all([
    ethCall(token, "0x06fdde03"),
    ethCall(token, "0x95d89b41"),
    ethCall(token, "0x313ce567"),
    ethCall(token, "0x18160ddd"),
  ]);

  return {
    address: token,
    type: "erc20",
    name: decodeString(nameRaw),
    symbol: decodeString(symbolRaw),
    decimals: decodeUint(decimalsRaw),
    totalSupply: decodeUint(supplyRaw),
  };
}

async function main() {
  console.log("========================================");
  console.log("XTO POOL DISCOVERY ENGINE");
  console.log("========================================");
  console.log("PoolManager:", POOL_MANAGER);
  console.log("");

  const latest = Number(
    BigInt(
      await rpc("eth_blockNumber", [])
    )
  );

  const from = latest - 1000;

  console.log("Latest block:", latest);
  console.log("Swap range :", `${from} → ${latest}`);
  console.log("");

  // ------------------------------------------------------------
  // 1. DISCOVER ACTIVE POOLS FROM SWAPS
  // ------------------------------------------------------------

  const swaps = await rpc("eth_getLogs", [
    {
      address: POOL_MANAGER,
      fromBlock: hexBlock(from),
      toBlock: hexBlock(latest),
      topics: [SWAP_TOPIC],
    },
  ]);

  const poolIds = [
    ...new Set(
      swaps
        .map((x: any) =>
          x.topics?.[1]?.toLowerCase()
        )
        .filter(Boolean)
    ),
  ];

  console.log("SWAPS:", swaps.length);
  console.log("UNIQUE POOLS:", poolIds.length);
  console.log("");

  // ------------------------------------------------------------
  // 2. DISCOVER INITIALIZE EVENTS
  // ------------------------------------------------------------

  const discovered: any[] = [];

  let processed = 0;

  for (const poolId of poolIds) {
    processed++;

    console.log(
      `[${processed}/${poolIds.length}] ${poolId}`
    );

    // Search only the recent 10M-block window.
    // This is the RPC maximum we verified.
    const initFrom = Math.max(
      0,
      latest - 9_999_000
    );

    const logs = await rpc("eth_getLogs", [
      {
        address: POOL_MANAGER,
        fromBlock: hexBlock(initFrom),
        toBlock: hexBlock(latest),
        topics: [
          INIT_TOPIC,
          poolId,
        ],
      },
    ]);

    if (!logs.length) {
      console.log("  Initialize: NOT FOUND");
      continue;
    }

    const log = logs[0];

    const data = log.data;

    if (
      !data ||
      data.length < 2 + 64 * 5
    ) {
      console.log(
        "  Initialize: INVALID DATA"
      );
      continue;
    }

    const currency0 =
      topicAddress(log.topics[2]);

    const currency1 =
      topicAddress(log.topics[3]);

    const fee =
      uint(data, 0).toString();

    const tickSpacing =
      signed(data, 1).toString();

    const hooks =
      wordAddress(data, 2);

    const sqrtPriceX96 =
      uint(data, 3).toString();

    const tick =
      signed(data, 4).toString();

    // ----------------------------------------------------------
    // TOKEN METADATA
    // ----------------------------------------------------------

    const [token0, token1] =
      await Promise.all([
        tokenMetadata(currency0),
        tokenMetadata(currency1),
      ]);

    const item = {
      poolId,

      poolManager: POOL_MANAGER,

      initializedAtBlock:
        Number(BigInt(log.blockNumber)),

      initializeTx:
        log.transactionHash,

      currency0,
      currency1,

      fee,
      tickSpacing,
      hooks,

      sqrtPriceX96,
      tick,

      token0,
      token1,
    };

    discovered.push(item);

    console.log(
      `  ${token0.symbol ?? "NATIVE"} / ${token1.symbol ?? "UNKNOWN"}`
    );

    console.log(
      `  fee=${fee} tick=${tick}`
    );

    console.log("");
  }

  // ------------------------------------------------------------
  // 3. SAVE SNAPSHOT
  // ------------------------------------------------------------

  fs.mkdirSync(
    path.dirname(OUTPUT),
    { recursive: true }
  );

  const snapshot = {
    generatedAt:
      new Date().toISOString(),

    chainId: 4663,

    poolManager: POOL_MANAGER,

    latestBlock: latest,

    swapBlocks: {
      from,
      to: latest,
    },

    swaps: swaps.length,

    uniquePools: poolIds.length,

    discoveredPools:
      discovered.length,

    pools: discovered,
  };

  fs.writeFileSync(
    OUTPUT,
    JSON.stringify(
      snapshot,
      null,
      2
    )
  );

  console.log("");
  console.log("========================================");
  console.log("DISCOVERY COMPLETE");
  console.log("========================================");
  console.log("SWAPS           :", swaps.length);
  console.log("UNIQUE POOLS    :", poolIds.length);
  console.log(
    "DISCOVERED POOLS:",
    discovered.length
  );
  console.log("OUTPUT          :", OUTPUT);
  console.log("========================================");
}

main().catch((e) => {
  console.error("");
  console.error("ERROR:", e);
  process.exit(1);
});
