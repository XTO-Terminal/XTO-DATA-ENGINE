import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const FACTORY =
  "0x8ccd03C88740b5c433775FfA55eCB06fF2ef9191";

type RpcResponse<T> = {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

type Log = {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
};

async function rpc<T>(
  method: string,
  params: unknown[] = []
): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
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

    if (response.status === 429) {
      await new Promise((r) =>
        setTimeout(r, 1000 * (attempt + 1))
      );
      continue;
    }

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

  throw new Error("RPC retry limit reached");
}

async function main() {
  const latest = parseInt(
    await rpc<string>("eth_blockNumber"),
    16
  );

  const TOTAL_RANGE = 100_000;
  const BATCH = 5_000;

  const startBlock = Math.max(
    0,
    latest - TOTAL_RANGE + 1
  );

  console.log("========================================");
  console.log(" BASH FACTORY HISTORY DISCOVERY V1");
  console.log("========================================");
  console.log(`FACTORY : ${FACTORY}`);
  console.log(`LATEST  : ${latest}`);
  console.log(`FROM    : ${startBlock}`);
  console.log(`RANGE   : ${TOTAL_RANGE}`);
  console.log(`BATCH   : ${BATCH}`);
  console.log("");

  const allLogs: Log[] = [];

  for (
    let from = startBlock;
    from <= latest;
    from += BATCH
  ) {
    const to = Math.min(
      from + BATCH - 1,
      latest
    );

    process.stdout.write(
      `Scanning ${from} -> ${to} ... `
    );

    try {
      const logs = await rpc<Log[]>(
        "eth_getLogs",
        [
          {
            address: FACTORY,
            fromBlock: `0x${from.toString(16)}`,
            toBlock: `0x${to.toString(16)}`,
          },
        ]
      );

      allLogs.push(...logs);

      console.log(`${logs.length} logs`);
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
  console.log("RESULT");
  console.log("========================================");
  console.log(`TOTAL LOGS : ${allLogs.length}`);
  console.log("");

  const topics = new Map<string, number>();

  for (const log of allLogs) {
    const topic = log.topics[0]?.toLowerCase();

    if (!topic) continue;

    topics.set(
      topic,
      (topics.get(topic) || 0) + 1
    );
  }

  console.log("EVENT TOPICS");
  console.log("----------------------------------------");

  [...topics.entries()]
    .sort((a, b) => b[1] - a[1])
    .forEach(([topic, count], i) => {
      console.log(
        `${String(i + 1).padStart(2, " ")}. ${topic}  ${count}`
      );
    });

  if (allLogs.length > 0) {
    console.log("");
    console.log("FIRST EVENTS");
    console.log("----------------------------------------");

    for (const log of allLogs.slice(0, 10)) {
      console.log(
        `block=${parseInt(log.blockNumber, 16)} ` +
        `tx=${log.transactionHash} ` +
        `topic0=${log.topics[0]}`
      );
    }

    console.log("");
    console.log("LAST EVENTS");
    console.log("----------------------------------------");

    for (const log of allLogs.slice(-10)) {
      console.log(
        `block=${parseInt(log.blockNumber, 16)} ` +
        `tx=${log.transactionHash} ` +
        `topic0=${log.topics[0]}`
      );
    }
  }

  console.log("");
  console.log("DISCOVERY COMPLETE");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
