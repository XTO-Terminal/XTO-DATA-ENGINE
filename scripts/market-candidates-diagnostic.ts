import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const CANDIDATES = [
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f",
  "0x23e9f67f1c45149d2daaf26198c6bde093918407",
];

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
    throw new Error(`RPC HTTP ${response.status}`);
  }

  const data = (await response.json()) as RpcResponse<T>;

  if (data.error) {
    throw new Error(
      `RPC ${data.error.code}: ${data.error.message}`
    );
  }

  if (data.result === undefined) {
    throw new Error(`No result for ${method}`);
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

type Tx = {
  from: string;
  to: string | null;
  value: string;
  input: string;
  blockNumber: string | null;
};

async function main() {
  const latest = parseInt(
    await rpc<string>("eth_blockNumber"),
    16
  );

  const fromBlock = latest - 999;

  console.log("========================================");
  console.log(" XTO MARKET CANDIDATE DIAGNOSTIC");
  console.log("========================================");
  console.log(`Blocks : ${fromBlock} -> ${latest}`);
  console.log("");

  for (const address of CANDIDATES) {
    console.log("----------------------------------------");
    console.log(`CONTRACT : ${address}`);

    const code = await rpc<string>("eth_getCode", [
      address,
      "latest",
    ]);

    console.log(
      `CODE     : ${(code.length - 2) / 2} bytes`
    );

    const logs = await rpc<Log[]>("eth_getLogs", [
      {
        address,
        fromBlock: `0x${fromBlock.toString(16)}`,
        toBlock: `0x${latest.toString(16)}`,
      },
    ]);

    console.log(`LOGS     : ${logs.length}`);

    const topics = new Map<string, number>();

    for (const log of logs) {
      const topic = log.topics[0]?.toLowerCase();

      if (!topic) continue;

      topics.set(
        topic,
        (topics.get(topic) || 0) + 1
      );
    }

    console.log("");
    console.log("EVENT TOPICS:");

    [...topics.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([topic, count], i) => {
        console.log(
          `  ${i + 1}. ${topic}  ${count}`
        );
      });

    console.log("");

    for (const log of logs.slice(0, 3)) {
      const block = parseInt(log.blockNumber, 16);

      const tx = await rpc<Tx | null>(
        "eth_getTransactionByHash",
        [log.transactionHash]
      );

      console.log("SAMPLE EVENT");
      console.log(`  block : ${block}`);
      console.log(`  tx    : ${log.transactionHash}`);
      console.log(`  index : ${parseInt(log.logIndex, 16)}`);
      console.log(`  topic0: ${log.topics[0]}`);
      console.log(`  topics: ${log.topics.length}`);
      console.log(
        `  data  : ${(log.data.length - 2) / 2} bytes`
      );

      if (tx) {
        console.log(`  from  : ${tx.from}`);
        console.log(`  to    : ${tx.to}`);
        console.log(`  value : ${BigInt(tx.value).toString()} wei`);
        console.log(
          `  input : ${tx.input.slice(0, 74)}${tx.input.length > 74 ? "..." : ""}`
        );
      }

      console.log("");
    }
  }

  console.log("========================================");
  console.log(" DIAGNOSTIC COMPLETE");
  console.log("========================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
