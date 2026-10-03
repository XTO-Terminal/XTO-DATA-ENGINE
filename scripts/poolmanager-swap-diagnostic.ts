import "dotenv/config";

const RPC = process.env.RH_RPC_URL!;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const SWAP_TOPIC =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

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

  const j = await r.json();

  if (j.error) throw new Error(JSON.stringify(j.error));

  return j.result;
}

function hexToBigInt(hex: string) {
  return BigInt(hex);
}

function signed128(hex: string) {
  const n = BigInt(hex);
  const bits = 256n;
  const max = 1n << 255n;
  return n >= max ? n - (1n << 256n) : n;
}

function word(data: string, index: number) {
  return "0x" + data.slice(2 + index * 64, 2 + (index + 1) * 64);
}

async function main() {
  console.log("========================================");
  console.log("XTO POOL MANAGER V4 SWAP DIAGNOSTIC");
  console.log("========================================");
  console.log("RPC:", RPC);
  console.log("PoolManager:", POOL_MANAGER);
  console.log("Swap topic:", SWAP_TOPIC);
  console.log("");

  const latestHex = await rpc("eth_blockNumber", []);
  const latest = BigInt(latestHex);
  const from = latest - 1000n;

  console.log("Latest block :", latest.toString());
  console.log("From block   :", from.toString());
  console.log("");

  const logs = await rpc("eth_getLogs", [{
    address: POOL_MANAGER,
    fromBlock: "0x" + from.toString(16),
    toBlock: "0x" + latest.toString(16),
    topics: [SWAP_TOPIC],
  }]);

  console.log("SWAP LOGS:", logs.length);
  console.log("");

  if (!logs.length) {
    console.log("NO SWAP EVENTS FOUND");
    return;
  }

  for (const [i, log] of logs.slice(-10).entries()) {
    console.log(`========== SWAP ${i + 1} ==========`);
    console.log("blockNumber :", BigInt(log.blockNumber).toString());
    console.log("txHash      :", log.transactionHash);
    console.log("logIndex    :", BigInt(log.logIndex).toString());

    console.log("");
    console.log("topics:");

    log.topics.forEach((t: string, n: number) => {
      console.log(`  topic[${n}] = ${t}`);
    });

    console.log("");
    console.log("data:", log.data);

    /*
      Uniswap V4 Swap event:

      topics[1] = poolId
      topics[2] = sender

      data:
        amount0
        amount1
        sqrtPriceX96
        liquidity
        tick
        fee
    */

    const poolId = log.topics[1];
    const sender =
      "0x" + log.topics[2].slice(-40);

    const amount0 = signed128(word(log.data, 0));
    const amount1 = signed128(word(log.data, 1));
    const sqrtPriceX96 = hexToBigInt(word(log.data, 2));
    const liquidity = hexToBigInt(word(log.data, 3));

    const tickRaw = BigInt(word(log.data, 4));
    const tick =
      tickRaw >= (1n << 255n)
        ? tickRaw - (1n << 256n)
        : tickRaw;

    const fee = BigInt(word(log.data, 5));

    console.log("");
    console.log("DECODED");
    console.log("----------------------------------------");
    console.log("poolId       :", poolId);
    console.log("sender       :", sender);
    console.log("amount0      :", amount0.toString());
    console.log("amount1      :", amount1.toString());
    console.log("sqrtPriceX96 :", sqrtPriceX96.toString());
    console.log("liquidity    :", liquidity.toString());
    console.log("tick         :", tick.toString());
    console.log("fee          :", fee.toString());
    console.log("");

    const tx = await rpc("eth_getTransactionByHash", [
      log.transactionHash,
    ]);

    console.log("TX FROM      :", tx?.from);
    console.log("TX TO        :", tx?.to);
    console.log("TX VALUE     :", tx?.value);
    console.log(
      "TX SELECTOR  :",
      tx?.input?.slice(0, 10)
    );

    console.log("");
  }
}

main().catch((err) => {
  console.error("");
  console.error("ERROR:", err);
  process.exit(1);
});
