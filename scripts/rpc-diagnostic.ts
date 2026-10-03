import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

async function rpc(method: string, params: unknown[] = []) {
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

  const data = await response.json();

  if (data.error) {
    throw new Error(
      `${method}: ${data.error.code} ${data.error.message}`
    );
  }

  return data.result;
}

function hexToNumber(value: string): number {
  return parseInt(value, 16);
}

function formatTimestamp(hex: string): string {
  return new Date(
    hexToNumber(hex) * 1000
  ).toISOString();
}

async function getBlock(number: number) {
  return await rpc(
    "eth_getBlockByNumber",
    [`0x${number.toString(16)}`, false]
  );
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log(" XTO RPC DIAGNOSTIC V2");
  console.log("========================================");
  console.log(`RPC: ${RPC_URL}`);
  console.log("");

  // ----------------------------------------
  // CHAIN ID
  // ----------------------------------------

  const chainId = hexToNumber(
    await rpc("eth_chainId")
  );

  console.log("CHAIN");
  console.log(`  chainId : ${chainId}`);
  console.log(`  expected: 4663`);
  console.log(
    `  status  : ${chainId === 4663 ? "OK" : "FAIL"}`
  );
  console.log("");

  // ----------------------------------------
  // TAKE ONE BLOCK-NUMBER SNAPSHOT
  // ----------------------------------------

  const latestNumber = hexToNumber(
    await rpc("eth_blockNumber")
  );

  console.log("BLOCK SNAPSHOT");
  console.log(`  N       : ${latestNumber}`);
  console.log(`  N-1     : ${latestNumber - 1}`);
  console.log(`  N-2     : ${latestNumber - 2}`);
  console.log("");

  // ----------------------------------------
  // FETCH EXACT BLOCKS
  // ----------------------------------------

  const blockN = await getBlock(latestNumber);
  const blockN1 = await getBlock(latestNumber - 1);
  const blockN2 = await getBlock(latestNumber - 2);

  if (!blockN || !blockN1 || !blockN2) {
    throw new Error(
      "One or more exact block requests returned null"
    );
  }

  console.log("BLOCK N");
  console.log(`  number    : ${hexToNumber(blockN.number)}`);
  console.log(`  hash      : ${blockN.hash}`);
  console.log(`  parentHash: ${blockN.parentHash}`);
  console.log(`  timestamp : ${formatTimestamp(blockN.timestamp)}`);
  console.log("");

  console.log("BLOCK N-1");
  console.log(`  number    : ${hexToNumber(blockN1.number)}`);
  console.log(`  hash      : ${blockN1.hash}`);
  console.log(`  parentHash: ${blockN1.parentHash}`);
  console.log(`  timestamp : ${formatTimestamp(blockN1.timestamp)}`);
  console.log("");

  console.log("BLOCK N-2");
  console.log(`  number    : ${hexToNumber(blockN2.number)}`);
  console.log(`  hash      : ${blockN2.hash}`);
  console.log(`  parentHash: ${blockN2.parentHash}`);
  console.log(`  timestamp : ${formatTimestamp(blockN2.timestamp)}`);
  console.log("");

  // ----------------------------------------
  // PARENT HASH VALIDATION
  // ----------------------------------------

  const checkN =
    blockN.parentHash === blockN1.hash;

  const checkN1 =
    blockN1.parentHash === blockN2.hash;

  console.log("PARENT HASH CONSISTENCY");
  console.log("----------------------------------------");
  console.log(
    `N.parentHash == N-1.hash : ${
      checkN ? "OK" : "MISMATCH"
    }`
  );
  console.log(
    `N-1.parentHash == N-2.hash : ${
      checkN1 ? "OK" : "MISMATCH"
    }`
  );
  console.log("");

  // ----------------------------------------
  // NUMBER VALIDATION
  // ----------------------------------------

  const numberCheck =
    hexToNumber(blockN.number) === latestNumber &&
    hexToNumber(blockN1.number) === latestNumber - 1 &&
    hexToNumber(blockN2.number) === latestNumber - 2;

  console.log("BLOCK NUMBER CONSISTENCY");
  console.log("----------------------------------------");
  console.log(
    `status: ${numberCheck ? "OK" : "MISMATCH"}`
  );
  console.log("");

  // ----------------------------------------
  // TIMESTAMP ORDER
  // ----------------------------------------

  const tN =
    hexToNumber(blockN.timestamp);

  const tN1 =
    hexToNumber(blockN1.timestamp);

  const tN2 =
    hexToNumber(blockN2.timestamp);

  const timestampCheck =
    tN >= tN1 && tN1 >= tN2;

  console.log("TIMESTAMP ORDER");
  console.log("----------------------------------------");
  console.log(
    `status: ${timestampCheck ? "OK" : "MISMATCH"}`
  );
  console.log("");

  // ----------------------------------------
  // FINAL RESULT
  // ----------------------------------------

  const allGood =
    chainId === 4663 &&
    numberCheck &&
    checkN &&
    checkN1 &&
    timestampCheck;

  console.log("========================================");
  console.log(
    ` FINAL STATUS: ${allGood ? "PASS" : "REVIEW REQUIRED"}`
  );
  console.log("========================================");
}

main().catch((error) => {
  console.error("");
  console.error("[DIAGNOSTIC ERROR]");
  console.error(error);
  process.exit(1);
});
