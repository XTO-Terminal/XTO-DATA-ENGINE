import "dotenv/config";

const RPC = process.env.RH_RPC_URL!;
const PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951";

const POOL =
  "0x5c9b2c7f82c9f8693d1b7f6972cb9deaf823949a1106694df08e1839d62ed5e6";

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

  console.log("LATEST:", latest);
  console.log("POOL:", POOL);
  console.log("");

  const ranges = [
    [latest - 1_000_000, latest],
    [latest - 5_000_000, latest],
    [latest - 20_000_000, latest],
  ];

  for (const [from, to] of ranges) {
    console.log(`SEARCH ${from} → ${to}`);

    const logs = await rpc("eth_getLogs", [{
      address: PM,
      fromBlock: hex(from),
      toBlock: hex(to),
      topics: [INIT, POOL]
    }]);

    console.log("RESULT:", logs.length);

    for (const log of logs) {
      console.log(JSON.stringify(log, null, 2));
    }

    console.log("");
  }
}

main().catch(e => {
  console.error("ERROR:", e);
  process.exit(1);
});
