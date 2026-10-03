import dotenv from "dotenv";
import { performance } from "node:perf_hooks";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const FACTORY =
  "0xCb652FB45bd5bf2c93b8F6D90CFf856E4330997c";

async function rpc(method: string, params: unknown[] = []) {
  const started = performance.now();

  const response = await fetch(RPC_URL, {
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

  const raw = await response.text();
  const elapsed = performance.now() - started;

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = JSON.parse(raw);

  if (data.error) {
    throw new Error(
      `${method}: ${data.error.code} ${data.error.message}`
    );
  }

  return {
    result: data.result,
    elapsed,
    bytes: Buffer.byteLength(raw, "utf8"),
  };
}

function hex(n: number) {
  return `0x${n.toString(16)}`;
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log(" XTO FACTORY EVENT DIAGNOSTIC V1");
  console.log("========================================");
  console.log(`RPC     : ${RPC_URL}`);
  console.log(`FACTORY : ${FACTORY}`);
  console.log("");

  const chain = await rpc("eth_chainId");
  const latestRpc = await rpc("eth_blockNumber");

  const chainId = parseInt(chain.result, 16);
  const latest = parseInt(latestRpc.result, 16);

  console.log("CHAIN");
  console.log("----------------------------------------");
  console.log(`chainId : ${chainId}`);
  console.log(`latest  : ${latest}`);
  console.log("");

  const fromBlock = latest - 500;
  const toBlock = latest;

  console.log("FACTORY LOG SCAN");
  console.log("----------------------------------------");
  console.log(`fromBlock : ${fromBlock}`);
  console.log(`toBlock   : ${toBlock}`);
  console.log(`range     : ${toBlock - fromBlock + 1} blocks`);
  console.log("");

  const result = await rpc("eth_getLogs", [
    {
      address: FACTORY,
      fromBlock: hex(fromBlock),
      toBlock: hex(toBlock),
    },
  ]);

  const logs = result.result as any[];

  console.log("RESULT");
  console.log("----------------------------------------");
  console.log(`logs     : ${logs.length}`);
  console.log(`latency  : ${result.elapsed.toFixed(2)} ms`);
  console.log(`response : ${result.bytes} bytes`);
  console.log("");

  if (logs.length === 0) {
    console.log("No Factory events found in this range.");
    return;
  }

  console.log("EVENT SUMMARY");
  console.log("----------------------------------------");

  const topics = new Map<string, number>();

  for (const log of logs) {
    const topic0 = log.topics?.[0] || "(no topic0)";
    topics.set(topic0, (topics.get(topic0) || 0) + 1);
  }

  for (const [topic, count] of topics) {
    console.log(`${count.toString().padStart(6)} | ${topic}`);
  }

  console.log("");
  console.log("FIRST 10 LOGS");
  console.log("----------------------------------------");

  for (const [i, log] of logs.slice(0, 10).entries()) {
    console.log(`#${i + 1}`);
    console.log(`  address     : ${log.address}`);
    console.log(`  blockNumber : ${parseInt(log.blockNumber, 16)}`);
    console.log(`  txHash      : ${log.transactionHash}`);
    console.log(`  logIndex    : ${parseInt(log.logIndex, 16)}`);
    console.log(`  topic0      : ${log.topics?.[0] || "(none)"}`);
    console.log(`  topics      : ${log.topics?.length || 0}`);
    console.log(`  dataBytes   : ${(log.data.length - 2) / 2}`);
    console.log("");
  }

  console.log("========================================");
  console.log(" FACTORY DIAGNOSTIC COMPLETE");
  console.log("========================================");
}

main().catch((error) => {
  console.error("");
  console.error("FACTORY DIAGNOSTIC FAILED");
  console.error(error);
  process.exit(1);
});
