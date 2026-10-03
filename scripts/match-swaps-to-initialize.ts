import "dotenv/config";

const RPC = process.env.RH_RPC_URL!;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

const INIT_TOPIC =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

async function rpc(method: string, params: any[]) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  return "0x" + data.slice(2 + index * 64, 2 + (index + 1) * 64);
}

function addressWord(data: string, index: number) {
  return "0x" + data.slice(2 + index * 64 + 24, 2 + (index + 1) * 64);
}

function uint24(data: string, index: number) {
  return BigInt(word(data, index));
}

function signedInt24(data: string, index: number) {
  let n = BigInt(word(data, index));

  if (n >= (1n << 255n)) {
    n -= 1n << 256n;
  }

  return Number(n);
}

async function getLogsBatched(
  from: number,
  to: number,
  topics: string[],
  batchSize = 5000
) {
  const all: any[] = [];

  for (let start = from; start <= to; start += batchSize) {
    const end = Math.min(start + batchSize - 1, to);

    console.log(
      `  scanning ${start} → ${end} ...`
    );

    const logs = await rpc("eth_getLogs", [
      {
        address: POOL_MANAGER,
        fromBlock: hexBlock(start),
        toBlock: hexBlock(end),
        topics,
      },
    ]);

    all.push(...logs);

    console.log(`    logs: ${logs.length}`);

    await new Promise((r) => setTimeout(r, 100));
  }

  return all;
}

async function main() {
  console.log("========================================");
  console.log("XTO SWAP → INITIALIZE MATCHER");
  console.log("========================================");

  const latestHex = await rpc("eth_blockNumber", []);
  const latest = Number(BigInt(latestHex));

  const swapFrom = latest - 1000;

  console.log(`Latest: ${latest}`);
  console.log(`From  : ${swapFrom}`);
  console.log("");

  // ------------------------------------------------------------
  // 1. GET SWAPS
  // ------------------------------------------------------------

  const swaps = await rpc("eth_getLogs", [
    {
      address: POOL_MANAGER,
      fromBlock: hexBlock(swapFrom),
      toBlock: hexBlock(latest),
      topics: [SWAP_TOPIC],
    },
  ]);

  const poolIds = new Set<string>();

  for (const log of swaps) {
    if (log.topics?.[1]) {
      poolIds.add(log.topics[1].toLowerCase());
    }
  }

  console.log(`SWAPS: ${swaps.length}`);
  console.log(`UNIQUE POOLS: ${poolIds.size}`);
  console.log("");

  // ------------------------------------------------------------
  // 2. GET INITIALIZE EVENTS IN BATCHES
  // ------------------------------------------------------------

  const initFrom = latest - 5_000_000;

  console.log(
    `INITIALIZE RANGE: ${initFrom} → ${latest}`
  );
  console.log("");

  const initLogs = await getLogsBatched(
    initFrom,
    latest,
    [INIT_TOPIC],
    5000
  );

  console.log("");
  console.log(`TOTAL INITIALIZE LOGS: ${initLogs.length}`);
  console.log("");

  // ------------------------------------------------------------
  // 3. MATCH
  // ------------------------------------------------------------

  const matches: any[] = [];

  for (const log of initLogs) {
    const poolId = log.topics?.[1]?.toLowerCase();

    if (!poolId || !poolIds.has(poolId)) continue;

    const data = log.data;

    // Skip malformed / incomplete Initialize logs
    if (!data || data === "0x" || data.length < 2 + 64 * 7) {
      continue;
    }

    matches.push({
      poolId,
      block: Number(BigInt(log.blockNumber)),
      tx: log.transactionHash,
      currency0: addressWord(data, 0),
      currency1: addressWord(data, 1),
      fee: uint24(data, 2).toString(),
      tickSpacing: signedInt24(data, 3),
      hooks: addressWord(data, 4),
      sqrtPriceX96: BigInt(word(data, 5)).toString(),
      tick: signedInt24(data, 6),
    });
  }

  // ------------------------------------------------------------
  // 4. OUTPUT
  // ------------------------------------------------------------

  console.log("========================================");
  console.log("MATCHED POOLS");
  console.log("========================================");

  console.log(`MATCHES: ${matches.length}`);
  console.log("");

  for (const m of matches) {
    console.log("----------------------------------------");
    console.log(`POOL ID      : ${m.poolId}`);
    console.log(`BLOCK        : ${m.block}`);
    console.log(`TX           : ${m.tx}`);
    console.log(`CURRENCY0    : ${m.currency0}`);
    console.log(`CURRENCY1    : ${m.currency1}`);
    console.log(`FEE          : ${m.fee}`);
    console.log(`TICK SPACING : ${m.tickSpacing}`);
    console.log(`HOOKS        : ${m.hooks}`);
    console.log(`SQRT PRICE   : ${m.sqrtPriceX96}`);
    console.log(`TICK         : ${m.tick}`);
  }

  console.log("");
  console.log("========================================");
  console.log("DONE");
  console.log("========================================");
}

main().catch((e) => {
  console.error("");
  console.error("ERROR:", e);
  process.exit(1);
});
