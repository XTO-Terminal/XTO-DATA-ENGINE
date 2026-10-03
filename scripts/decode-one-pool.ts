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
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method,
      params,
    }),
  });

  const j: any = await r.json();

  if (j.error) throw new Error(JSON.stringify(j.error));

  return j.result;
}

function word(data: string, index: number) {
  return data.slice(2 + index * 64, 2 + (index + 1) * 64);
}

function addressFromWord(data: string, index: number) {
  return "0x" + word(data, index).slice(24);
}

function uint(data: string, index: number) {
  return BigInt("0x" + word(data, index));
}

function signed(data: string, index: number) {
  let n = uint(data, index);

  if (n >= (1n << 255n)) {
    n -= 1n << 256n;
  }

  return n;
}

async function erc20Call(
  token: string,
  selector: string
) {
  try {
    return await rpc("eth_call", [
      {
        to: token,
        data: selector,
      },
      "latest",
    ]);
  } catch {
    return null;
  }
}

function decodeString(hex: string | null) {
  if (!hex || hex === "0x") return null;

  try {
    const clean = hex.slice(2);

    // ABI dynamic string
    if (clean.length >= 128) {
      const offset = Number(BigInt("0x" + clean.slice(0, 64)));
      const len = Number(
        BigInt("0x" + clean.slice(offset * 2, offset * 2 + 64))
      );

      const bytes = clean.slice(
        offset * 2 + 64,
        offset * 2 + 64 + len * 2
      );

      return Buffer.from(bytes, "hex").toString("utf8");
    }

    // bytes32 fallback
    return Buffer.from(clean.slice(0, 64), "hex")
      .toString("utf8")
      .replace(/\0/g, "");
  } catch {
    return null;
  }
}

function decodeUint(hex: string | null) {
  if (!hex || hex === "0x") return null;

  try {
    return BigInt(hex).toString();
  } catch {
    return null;
  }
}

async function main() {
  console.log("========================================");
  console.log("XTO ONE POOL DECODER");
  console.log("========================================");
  console.log("POOL:", POOL);
  console.log("");

  // Find Initialize
  // Initialize block sudah diketahui dari discovery:
  // 78697254
  const initBlock = 78697254;

  const logs = await rpc("eth_getLogs", [
    {
      address: PM,
      topics: [INIT, POOL],
      fromBlock: "0x" + initBlock.toString(16),
      toBlock: "0x" + initBlock.toString(16),
    },
  ]);

  console.log("INITIALIZE EVENTS:", logs.length);

  if (!logs.length) {
    console.log("NO INITIALIZE FOUND");
    return;
  }

  const log = logs[0];

  console.log("");
  console.log("BLOCK:", Number(BigInt(log.blockNumber)));
  console.log("TX   :", log.transactionHash);
  console.log("");

  const data = log.data;

  console.log("===== RAW EVENT DATA =====");
  console.log("DATA LENGTH :", data.length);
  console.log("DATA BYTES  :", (data.length - 2) / 2);
  console.log("DATA        :", data);
  console.log("");

  for (let i = 0; i < data.length - 2; i += 64) {
    console.log(
      "WORD",
      String(i / 64).padStart(2, "0"),
      ":",
      data.slice(2 + i, 2 + i + 64)
    );
  }

  console.log("");
  console.log("TOPICS      :", JSON.stringify(log.topics, null, 2));
  console.log("");
  console.log("===== DECODED POOL =====");

  // Actual PoolManager Initialize layout:
  // topics[1] = poolId
  // topics[2] = currency0
  // topics[3] = currency1
  // data[0]  = fee
  // data[1]  = tickSpacing
  // data[2]  = hooks
  // data[3]  = sqrtPriceX96
  // data[4]  = tick

  const currency0 =
    "0x" + log.topics[2].slice(-40);

  const currency1 =
    "0x" + log.topics[3].slice(-40);

  const fee =
    BigInt("0x" + word(data, 0));

  const tickSpacing =
    signed(data, 1);

  const hooks =
    "0x" + word(data, 2).slice(-40);

  const sqrtPriceX96 =
    uint(data, 3);

  const tick =
    signed(data, 4);

  console.log("poolId      :", POOL);
  console.log("currency0   :", currency0);
  console.log("currency1   :", currency1);
  console.log("fee         :", fee.toString());
  console.log("tickSpacing :", tickSpacing.toString());
  console.log("hooks       :", hooks);
  console.log("sqrtPrice   :", sqrtPriceX96.toString());
  console.log("tick        :", tick.toString());
  console.log("");
  console.log("===== TOKEN CHECK =====");

  for (const [name, token] of [
    ["currency0", currency0],
    ["currency1", currency1],
  ]) {
    const code = await rpc("eth_getCode", [token, "latest"]);

    console.log("");
    console.log(name, token);
    console.log("code bytes:", (code.length - 2) / 2);

    if (code === "0x") {
      console.log("TYPE: NATIVE / NO CONTRACT");
      continue;
    }

    const symbol = decodeString(
      await erc20Call(token, "0x95d89b41")
    );

    const nameResult = decodeString(
      await erc20Call(token, "0x06fdde03")
    );

    const decimals = decodeUint(
      await erc20Call(token, "0x313ce567")
    );

    const totalSupply = decodeUint(
      await erc20Call(token, "0x18160ddd")
    );

    console.log("TYPE      : CONTRACT");
    console.log("NAME      :", nameResult ?? "N/A");
    console.log("SYMBOL    :", symbol ?? "N/A");
    console.log("DECIMALS  :", decimals ?? "N/A");
    console.log("SUPPLY    :", totalSupply ?? "N/A");
  }

  console.log("");
  console.log("========================================");
  console.log("DONE");
  console.log("========================================");
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});
