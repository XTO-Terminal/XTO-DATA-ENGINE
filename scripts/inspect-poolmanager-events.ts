import "dotenv/config";

const RPC = process.env.RH_RPC_URL!;
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const SWAP =
  "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f";

const INIT =
  "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438";

async function rpc(method: string, params: any[]) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params
    })
  });

  const j: any = await r.json();

  if (j.error) throw new Error(JSON.stringify(j.error));

  return j.result;
}

function hex(n: number) {
  return "0x" + n.toString(16);
}

async function main() {
  const latest = Number(BigInt(await rpc("eth_blockNumber", [])));

  const logs = await rpc("eth_getLogs", [{
    address: PM,
    fromBlock: hex(latest - 20),
    toBlock: hex(latest),
    topics: [SWAP]
  }]);

  console.log("LATEST:", latest);
  console.log("SWAPS:", logs.length);
  console.log("");

  if (!logs.length) {
    console.log("NO RECENT SWAPS");
    return;
  }

  const swap = logs[logs.length - 1];

  console.log("===== SWAP =====");
  console.log("block :", Number(BigInt(swap.blockNumber)));
  console.log("tx    :", swap.transactionHash);
  console.log("topics:", JSON.stringify(swap.topics, null, 2));
  console.log("data  :", swap.data);
  console.log("");

  const txLogs = await rpc("eth_getLogs", [{
    address: PM,
    fromBlock: swap.blockNumber,
    toBlock: swap.blockNumber
  }]);

  console.log("===== ALL POOLMANAGER LOGS SAME BLOCK =====");
  console.log("COUNT:", txLogs.length);
  console.log("");

  for (const log of txLogs) {
    if (log.transactionHash !== swap.transactionHash) continue;

    console.log("----------------------------------------");
    console.log("TX:", log.transactionHash);
    console.log("topics:", JSON.stringify(log.topics, null, 2));
    console.log("data:", log.data);
  }

  console.log("");
  console.log("===== SEARCH INITIALIZE BY SWAP TX =====");

  const init = await rpc("eth_getLogs", [{
    address: PM,
    fromBlock: swap.blockNumber,
    toBlock: swap.blockNumber,
    topics: [INIT]
  }]);

  console.log("INITIALIZE SAME BLOCK:", init.length);

  for (const x of init) {
    console.log(JSON.stringify(x, null, 2));
  }
}

main().catch(e => {
  console.error("ERROR:", e);
  process.exit(1);
});
