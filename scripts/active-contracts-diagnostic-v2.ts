import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

type RpcResponse<T> = {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: { code: number; message: string };
};

async function rpc<T>(
  method: string,
  params: unknown[] = []
): Promise<T> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  const latest = parseInt(
    await rpc<string>("eth_blockNumber"),
    16
  );

  const fromBlock = latest - 999;

  const logs = await rpc<Log[]>("eth_getLogs", [
    {
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${latest.toString(16)}`,
    },
  ]);

  const counts = new Map<string, number>();

  for (const log of logs) {
    const address = log.address.toLowerCase();
    counts.set(address, (counts.get(address) || 0) + 1);
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);

  console.log("========================================");
  console.log(" XTO ACTIVE CONTRACT DISCOVERY V2");
  console.log("========================================");
  console.log(`Blocks : ${fromBlock} -> ${latest}`);
  console.log(`Logs   : ${logs.length}`);
  console.log("");

  for (let i = 0; i < top.length; i++) {
    const [address, count] = top[i];

    console.log(
      `${String(i + 1).padStart(2, " ")}. ${address}  ${count} logs`
    );
  }
}

main().catch(console.error);
