import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const CANDIDATES = [
  "0x5fc5360d0400a0fd4f2af552add042d716f1d168",
  "0x0bd7d308f8e1639fab988df18a8011f41eacad73",
  "0x8366a39cc670b4001a1121b8f6a443a643e40951",
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f",
  "0x23e9f67f1c45149d2daaf26198c6bde093918407",
];

const TRANSFER =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const APPROVAL =
  "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925";

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

function shortTopic(topic: string) {
  return `${topic.slice(0, 18)}...${topic.slice(-10)}`;
}

async function main() {
  const latest = parseInt(
    await rpc<string>("eth_blockNumber"),
    16
  );

  const fromBlock = latest - 999;

  console.log("========================================");
  console.log(" XTO FACTORY CANDIDATE DIAGNOSTIC V3");
  console.log("========================================");
  console.log(`Blocks : ${fromBlock} -> ${latest}`);
  console.log("");

  for (const address of CANDIDATES) {
    console.log("----------------------------------------");
    console.log(`CONTRACT : ${address}`);

    try {
      const code = await rpc<string>("eth_getCode", [
        address,
        "latest",
      ]);

      console.log(
        `CODE     : ${
          code === "0x"
            ? "EOA / NO CONTRACT"
            : `${(code.length - 2) / 2} bytes`
        }`
      );

      if (code === "0x") {
        continue;
      }

      const logs = await rpc<Log[]>("eth_getLogs", [
        {
          address,
          fromBlock: `0x${fromBlock.toString(16)}`,
          toBlock: `0x${latest.toString(16)}`,
        },
      ]);

      const topics = new Map<string, number>();

      for (const log of logs) {
        const topic = log.topics[0]?.toLowerCase();

        if (!topic) continue;

        topics.set(
          topic,
          (topics.get(topic) || 0) + 1
        );
      }

      const custom = [...topics.entries()]
        .filter(
          ([topic]) =>
            topic !== TRANSFER &&
            topic !== APPROVAL
        )
        .sort((a, b) => b[1] - a[1]);

      console.log(`LOGS     : ${logs.length}`);
      console.log(`TOPICS   : ${topics.size}`);
      console.log(`CUSTOM   : ${custom.length}`);

      if (custom.length === 0) {
        console.log("  No custom event topics.");
      } else {
        console.log("CUSTOM EVENT TOPICS:");

        custom.slice(0, 15).forEach(
          ([topic, count], i) => {
            console.log(
              `  ${String(i + 1).padStart(2, " ")}. ${shortTopic(topic)}  ${count}`
            );
            console.log(`      ${topic}`);
          }
        );
      }

      if (logs.length > 0) {
        const first = logs[0];

        console.log("");
        console.log("FIRST LOG:");
        console.log(`  block : ${parseInt(first.blockNumber, 16)}`);
        console.log(`  tx    : ${first.transactionHash}`);
        console.log(`  index : ${parseInt(first.logIndex, 16)}`);
        console.log(`  topic0: ${first.topics[0]}`);
      }

    } catch (error) {
      console.log(
        `ERROR: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`
      );
    }
  }

  console.log("");
  console.log("========================================");
  console.log(" DISCOVERY V3 COMPLETE");
  console.log("========================================");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
