import "dotenv/config";
import { createHash } from "crypto";

const RPC = process.env.RH_RPC_URL!;
const POOL_MANAGER = "0x8366a39cc670b4001a1121b8f6a443a643e40951";
const TARGET_POOL =
  "0x3ea70ce0b34473692549f97e630a1d82dc05cea94fa55f81b50f10c8c6d8186f";

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

function keccakSignature(_signature: string) {
  throw new Error(
    "Node crypto does not provide Ethereum Keccak-256. Use cast keccak instead."
  );
}

async function main() {
  console.log("========================================");
  console.log("XTO V4 INITIALIZE DISCOVERY");
  console.log("========================================");
  console.log("PoolManager:", POOL_MANAGER);
  console.log("Target pool :", TARGET_POOL);
  console.log("");

  console.log("Canonical event:");
  console.log(
    "Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)"
  );
  console.log("");

  console.log("Calculating topic locally with Foundry...");
  console.log("");

  const { execSync } = await import("child_process");

  const topic = execSync(
    `cast keccak 'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)'`
  )
    .toString()
    .trim();

  console.log("INITIALIZE TOPIC:");
  console.log(topic);
  console.log("");

  const latest = BigInt(await rpc("eth_blockNumber", []));
  const from = latest - 500000n;

  console.log("Latest block:", latest.toString());
  console.log("From block  :", from.toString());
  console.log("");

  const logs = await rpc("eth_getLogs", [
    {
      address: POOL_MANAGER,
      fromBlock: "0x" + from.toString(16),
      toBlock: "0x" + latest.toString(16),
      topics: [topic],
    },
  ]);

  console.log("INITIALIZE EVENTS:", logs.length);
  console.log("");

  let found = false;

  for (const log of logs) {
    const poolId = log.topics[1];

    if (poolId.toLowerCase() !== TARGET_POOL.toLowerCase()) continue;

    found = true;

    console.log("========================================");
    console.log("TARGET POOL FOUND");
    console.log("========================================");

    console.log("Block:", BigInt(log.blockNumber).toString());
    console.log("TX   :", log.transactionHash);

    console.log("");
    console.log("TOPICS:");

    log.topics.forEach((t: string, i: number) => {
      console.log(`topic[${i}] = ${t}`);
    });

    console.log("");
    console.log("DATA:");
    console.log(log.data);

    console.log("");
    console.log("RAW INITIALIZE EVENT FOUND");
    console.log("");
  }

  if (!found) {
    console.log("TARGET POOL NOT FOUND IN INITIALIZE SCAN");
    console.log("");
    console.log("But Initialize discovery is working.");
    console.log("Let's print the latest 20 Initialize events.");
    console.log("");

    for (const log of logs.slice(-20)) {
      console.log("----------------------------------------");
      console.log("BLOCK:", BigInt(log.blockNumber).toString());
      console.log("TX   :", log.transactionHash);
      console.log("POOL :", log.topics[1]);
      console.log("DATA :", log.data);
    }
  }
}

main().catch((err) => {
  console.error("");
  console.error("ERROR:", err);
  process.exit(1);
});
