import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

type RpcResponse<T> = {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

async function rpc<T>(
  method: string,
  params: unknown[] = []
): Promise<T> {
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

  if (!response.ok) {
    throw new Error(
      `RPC HTTP ${response.status}: ${response.statusText}`
    );
  }

  const data = (await response.json()) as RpcResponse<T>;

  if (data.error) {
    throw new Error(
      `RPC ${data.error.code}: ${data.error.message}`
    );
  }

  if (data.result === undefined) {
    throw new Error(`RPC returned no result for ${method}`);
  }

  return data.result;
}

type Log = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

function shortAddress(address: string) {
  return `${address.slice(0, 10)}...${address.slice(-8)}`;
}

async function main() {
  console.log("========================================");
  console.log(" XTO ACTIVE CONTRACT DISCOVERY V1");
  console.log("========================================");
  console.log(`RPC : ${RPC_URL}`);
  console.log("");

  const latestHex = await rpc<string>("eth_blockNumber");
  const latest = parseInt(latestHex, 16);

  const RANGE = 1000;
  const fromBlock = latest - RANGE + 1;

  console.log("BLOCK RANGE");
  console.log("----------------------------------------");
  console.log(`latest    : ${latest}`);
  console.log(`fromBlock : ${fromBlock}`);
  console.log(`toBlock   : ${latest}`);
  console.log(`range     : ${RANGE} blocks`);
  console.log("");

  const start = performance.now();

  const logs = await rpc<Log[]>("eth_getLogs", [
    {
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
    },
  ]);

  const latency = performance.now() - start;

  const byAddress = new Map<string, number>();
  const byTopic = new Map<string, number>();

  for (const log of logs) {
    const address = log.address.toLowerCase();

    byAddress.set(
      address,
      (byAddress.get(address) || 0) + 1
    );

    if (log.topics.length > 0) {
      const topic = log.topics[0].toLowerCase();

      byTopic.set(
        topic,
        (byTopic.get(topic) || 0) + 1
      );
    }
  }

  const topAddresses = [...byAddress.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30);

  const topTopics = [...byTopic.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  console.log("RESULT");
  console.log("----------------------------------------");
  console.log(`logs    : ${logs.length}`);
  console.log(`latency : ${latency.toFixed(2)} ms`);
  console.log("");

  console.log("TOP ACTIVE CONTRACTS");
  console.log("----------------------------------------");

  for (let i = 0; i < topAddresses.length; i++) {
    const [address, count] = topAddresses[i];

    console.log(
      `${String(i + 1).padStart(2, " ")}. ${shortAddress(address)}  ${count} logs`
    );
  }

  console.log("");

  console.log("TOP EVENT TOPICS");
  console.log("----------------------------------------");

  for (let i = 0; i < topTopics.length; i++) {
    const [topic, count] = topTopics[i];

    console.log(
      `${String(i + 1).padStart(2, " ")}. ${topic}  ${count}`
    );
  }

  console.log("");
  console.log("DISCOVERY COMPLETE");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
