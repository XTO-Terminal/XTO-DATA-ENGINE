import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const FACTORY =
  "0x6E06dCB9Cd1252b6dc94Ce844dd8fC6dDd56c1d9";

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

async function main() {
  console.log("========================================");
  console.log(" XTO OLD FACTORY DIAGNOSTIC");
  console.log("========================================");
  console.log(`RPC     : ${RPC_URL}`);
  console.log(`FACTORY : ${FACTORY}`);
  console.log("");

  const chainId = parseInt(
    await rpc<string>("eth_chainId"),
    16
  );

  const latest = parseInt(
    await rpc<string>("eth_blockNumber"),
    16
  );

  console.log("CHAIN");
  console.log("----------------------------------------");
  console.log(`chainId : ${chainId}`);
  console.log(`latest  : ${latest}`);
  console.log("");

  const code = await rpc<string>("eth_getCode", [
    FACTORY,
    "latest",
  ]);

  console.log("CONTRACT");
  console.log("----------------------------------------");

  if (code === "0x") {
    console.log("STATUS : NO CONTRACT CODE");
    return;
  }

  console.log(
    `STATUS : CONTRACT EXISTS`
  );
  console.log(
    `CODE   : ${(code.length - 2) / 2} bytes`
  );
  console.log("");

  const RANGE = 500;
  const fromBlock = latest - RANGE;

  const logs = await rpc<Log[]>("eth_getLogs", [
    {
      address: FACTORY,
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
    },
  ]);

  console.log("FACTORY LOG SCAN");
  console.log("----------------------------------------");
  console.log(`fromBlock : ${fromBlock}`);
  console.log(`toBlock   : ${latest}`);
  console.log(`range     : ${RANGE + 1}`);
  console.log(`logs      : ${logs.length}`);
  console.log("");

  const topics = new Map<string, number>();

  for (const log of logs) {
    const topic0 = log.topics[0]?.toLowerCase();

    if (!topic0) continue;

    topics.set(
      topic0,
      (topics.get(topic0) || 0) + 1
    );
  }

  console.log("EVENT TOPICS");
  console.log("----------------------------------------");

  if (topics.size === 0) {
    console.log("No events found.");
  } else {
    [...topics.entries()]
      .sort((a, b) => b[1] - a[1])
      .forEach(([topic, count], i) => {
        const standard =
          topic === TRANSFER
            ? "ERC20 Transfer"
            : topic === APPROVAL
            ? "ERC20 Approval"
            : "CUSTOM";

        console.log(
          `${String(i + 1).padStart(2, " ")}. ${topic}`
        );
        console.log(`    count : ${count}`);
        console.log(`    type  : ${standard}`);
      });
  }

  if (logs.length > 0) {
    console.log("");
    console.log("SAMPLE EVENTS");
    console.log("----------------------------------------");

    for (const log of logs.slice(0, 10)) {
      console.log(`block    : ${parseInt(log.blockNumber, 16)}`);
      console.log(`tx       : ${log.transactionHash}`);
      console.log(`logIndex : ${parseInt(log.logIndex, 16)}`);
      console.log(`topic0   : ${log.topics[0]}`);
      console.log(`topics   : ${log.topics.length}`);
      console.log(`dataSize : ${(log.data.length - 2) / 2} bytes`);
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
