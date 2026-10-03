import dotenv from "dotenv";
import { performance } from "node:perf_hooks";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

async function rpc(
  method: string,
  params: unknown[] = [],
  retries = 3
) {
  const started = performance.now();

  for (let attempt = 0; attempt <= retries; attempt++) {
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

    const raw = await response.text();

    if (response.status === 429) {
      if (attempt < retries) {
        const waitMs = 1000 * (attempt + 1);

        console.log(
          `  RPC 429 — retry ${attempt + 1}/${retries} in ${waitMs} ms`
        );

        await new Promise((resolve) =>
          setTimeout(resolve, waitMs)
        );

        continue;
      }

      throw new Error(
        `HTTP 429: Too Many Requests after ${retries} retries`
      );
    }

    const elapsed = performance.now() - started;

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}: ${response.statusText}`
      );
    }

    let data: any;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error("RPC returned invalid JSON");
    }

    if (data.error) {
      const error = new Error(
        `${method}: ${data.error.code} ${data.error.message}`
      );

      (error as any).rpcCode = data.error.code;
      (error as any).rpcMessage = data.error.message;
      (error as any).elapsed = elapsed;

      throw error;
    }

    return {
      result: data.result,
      elapsed,
      bytes: Buffer.byteLength(raw, "utf8"),
    };
  }

  throw new Error("RPC request failed unexpectedly");
}

function hex(number: number) {
  return `0x${number.toString(16)}`;
}

async function main() {
  console.log("");
  console.log("========================================");
  console.log(" XTO ETH_GETLOGS DIAGNOSTIC V1");
  console.log("========================================");
  console.log(`RPC: ${RPC_URL}`);
  console.log("");

  // --------------------------------------------------
  // 1. GET A STABLE BLOCK SNAPSHOT
  // --------------------------------------------------

  const latestRpc = await rpc("eth_blockNumber");
  const latest = parseInt(latestRpc.result, 16);

  console.log("BLOCK SNAPSHOT");
  console.log("----------------------------------------");
  console.log(`Latest block: ${latest}`);
  console.log("");

  // --------------------------------------------------
  // 2. TEST EMPTY FILTER
  //
  // No address/topic filter.
  // Small range only.
  // --------------------------------------------------

  const fromBlock = latest - 20;
  const toBlock = latest;

  console.log("TEST 1 — BASIC LOG SCAN");
  console.log("----------------------------------------");
  console.log(`fromBlock: ${fromBlock}`);
  console.log(`toBlock  : ${toBlock}`);
  console.log(`range    : ${toBlock - fromBlock + 1} blocks`);
  console.log("");

  try {
    const result = await rpc("eth_getLogs", [
      {
        fromBlock: hex(fromBlock),
        toBlock: hex(toBlock),
      },
    ]);

    const logs = result.result as unknown[];

    console.log("RESULT");
    console.log(`  logs     : ${logs.length}`);
    console.log(`  latency  : ${result.elapsed.toFixed(2)} ms`);
    console.log(`  response : ${result.bytes} bytes`);
    console.log("  status   : OK");
  } catch (error) {
    console.error("  status   : ERROR");
    console.error(error);
  }

  console.log("");

  // --------------------------------------------------
  // 3. TEST TOPIC FILTER
  //
  // ERC-20 Transfer event:
  //
  // Transfer(address,address,uint256)
  //
  // keccak256 =
  // 0xddf252ad...
  //
  // This does NOT write anything to DB.
  // --------------------------------------------------

  const transferTopic =
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

  console.log("TEST 2 — TOPIC FILTER");
  console.log("----------------------------------------");
  console.log("Topic: ERC-20 Transfer");
  console.log(`fromBlock: ${fromBlock}`);
  console.log(`toBlock  : ${toBlock}`);
  console.log("");

  try {
    const result = await rpc("eth_getLogs", [
      {
        fromBlock: hex(fromBlock),
        toBlock: hex(toBlock),
        topics: [transferTopic],
      },
    ]);

    const logs = result.result as any[];

    console.log("RESULT");
    console.log(`  logs     : ${logs.length}`);
    console.log(`  latency  : ${result.elapsed.toFixed(2)} ms`);
    console.log(`  response : ${result.bytes} bytes`);
    console.log("  status   : OK");

    if (logs.length > 0) {
      const first = logs[0];

      console.log("");
      console.log("FIRST LOG");
      console.log(`  address     : ${first.address}`);
      console.log(`  blockNumber : ${parseInt(first.blockNumber, 16)}`);
      console.log(`  txHash      : ${first.transactionHash}`);
      console.log(`  logIndex    : ${parseInt(first.logIndex, 16)}`);
    }
  } catch (error) {
    console.error("  status   : ERROR");
    console.error(error);
  }

  console.log("");

  // --------------------------------------------------
  // 4. TEST SMALL RANGE SCALING
  //
  // We test 20 / 100 / 500 blocks.
  // Still read-only.
  // --------------------------------------------------

  const ranges = [20, 100, 500];

  console.log("TEST 3 — RANGE SCALING");
  console.log("----------------------------------------");

  for (const size of ranges) {
    const start = latest - size + 1;

    try {
      const result = await rpc("eth_getLogs", [
        {
          fromBlock: hex(start),
          toBlock: hex(latest),
        },
      ]);

      const logs = result.result as unknown[];

      console.log(
        `${size.toString().padStart(4)} blocks | ` +
        `${logs.length.toString().padStart(6)} logs | ` +
        `${result.elapsed.toFixed(2).padStart(9)} ms | ` +
        `${result.bytes.toString().padStart(10)} bytes | OK`
      );
    } catch (error) {
      console.log(
        `${size.toString().padStart(4)} blocks | ERROR`
      );

      console.error(error);
    }
  }

  console.log("");

  // --------------------------------------------------
  // 5. TEST ADDRESS FILTER WITH ONE REAL LOG ADDRESS
  // --------------------------------------------------

  console.log("TEST 4 — ADDRESS FILTER");
  console.log("----------------------------------------");

  try {
    const topicResult = await rpc("eth_getLogs", [
      {
        fromBlock: hex(fromBlock),
        toBlock: hex(toBlock),
        topics: [transferTopic],
      },
    ]);

    const logs = topicResult.result as any[];

    if (logs.length === 0) {
      console.log(
        "No Transfer logs found in test range."
      );
    } else {
      const address = logs[0].address;

      console.log(`Using address: ${address}`);

      const result = await rpc("eth_getLogs", [
        {
          address,
          fromBlock: hex(fromBlock),
          toBlock: hex(toBlock),
        },
      ]);

      const addressLogs = result.result as unknown[];

      console.log(`  logs     : ${addressLogs.length}`);
      console.log(
        `  latency  : ${result.elapsed.toFixed(2)} ms`
      );
      console.log(
        `  response : ${result.bytes} bytes`
      );
      console.log("  status   : OK");
    }
  } catch (error) {
    console.error("  status   : ERROR");
    console.error(error);
  }

  console.log("");

  // --------------------------------------------------
  // FINAL
  // --------------------------------------------------

  console.log("========================================");
  console.log(" LOG DIAGNOSTIC COMPLETE");
  console.log("========================================");
}

main().catch((error) => {
  console.error("");
  console.error("[DIAGNOSTIC FATAL]");
  console.error(error);
  process.exit(1);
});
