import dotenv from "dotenv";

dotenv.config();

const RPC_URL =
  process.env.RH_RPC_URL ||
  "https://rpc.mainnet.chain.robinhood.com";

const CHAIN_ID = Number(process.env.RH_CHAIN_ID || 4663);

const RPC_TIMEOUT_MS = Number(
  process.env.RPC_TIMEOUT_MS || 15_000
);

const RPC_MAX_RETRIES = Number(
  process.env.RPC_MAX_RETRIES || 5
);

const RPC_BASE_BACKOFF_MS = Number(
  process.env.RPC_BASE_BACKOFF_MS || 500
);

const RPC_MAX_BACKOFF_MS = Number(
  process.env.RPC_MAX_BACKOFF_MS || 8_000
);

type RpcResponse<T> = {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, ms)
  );
}

function backoffDelay(attempt: number): number {
  const exponential = Math.min(
    RPC_BASE_BACKOFF_MS * 2 ** attempt,
    RPC_MAX_BACKOFF_MS
  );

  const jitter = Math.floor(
    Math.random() * Math.min(250, exponential / 2)
  );

  return exponential + jitter;
}

function isRetryableHttpStatus(
  status: number
): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function isRetryableRpcError(
  code: number
): boolean {
  return (
    code === -32000 ||
    code === -32005 ||
    code === -32603
  );
}

export async function rpc<T>(
  method: string,
  params: unknown[] = []
): Promise<T> {
  let lastError: unknown;

  for (
    let attempt = 0;
    attempt <= RPC_MAX_RETRIES;
    attempt++
  ) {
    try {
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
        signal: AbortSignal.timeout(
          RPC_TIMEOUT_MS
        ),
      });

      if (!response.ok) {
        const retryable =
          isRetryableHttpStatus(response.status);

        const error = new Error(
          `RPC HTTP ${response.status}: ${response.statusText}`
        );

        if (
          !retryable ||
          attempt >= RPC_MAX_RETRIES
        ) {
          throw error;
        }

        lastError = error;

        const delay = backoffDelay(attempt);

        console.warn(
          `[RPC RETRY] method=${method} ` +
            `status=${response.status} ` +
            `attempt=${attempt + 1}/${RPC_MAX_RETRIES} ` +
            `sleep=${delay}ms`
        );

        await sleep(delay);
        continue;
      }

      const data =
        (await response.json()) as RpcResponse<T>;

      if (data.error) {
        const retryable =
          isRetryableRpcError(data.error.code);

        const error = new Error(
          `RPC ${data.error.code}: ${data.error.message}`
        );

        if (
          !retryable ||
          attempt >= RPC_MAX_RETRIES
        ) {
          throw error;
        }

        lastError = error;

        const delay = backoffDelay(attempt);

        console.warn(
          `[RPC RETRY] method=${method} ` +
            `code=${data.error.code} ` +
            `attempt=${attempt + 1}/${RPC_MAX_RETRIES} ` +
            `sleep=${delay}ms`
        );

        await sleep(delay);
        continue;
      }

      if (data.result === undefined) {
        throw new Error(
          `RPC returned no result for ${method}`
        );
      }

      return data.result;
    } catch (error) {
      lastError = error;

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const isAbort =
        error instanceof Error &&
        error.name === "TimeoutError";

      const retryable =
        isAbort ||
        message.includes("fetch failed") ||
        message.includes("ECONNRESET") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ETIMEDOUT");

      if (
        !retryable ||
        attempt >= RPC_MAX_RETRIES
      ) {
        throw error;
      }

      const delay = backoffDelay(attempt);

      console.warn(
        `[RPC RETRY] method=${method} ` +
          `error=${message} ` +
          `attempt=${attempt + 1}/${RPC_MAX_RETRIES} ` +
          `sleep=${delay}ms`
      );

      await sleep(delay);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`RPC failed for ${method}`);
}

export type RpcBlock = {
  number: string;
  hash: string;
  parentHash: string;
  timestamp: string;
};

export async function getChainId(): Promise<number> {
  const result =
    await rpc<string>("eth_chainId");

  return parseInt(result, 16);
}

export async function getBlockNumber(): Promise<number> {
  const result =
    await rpc<string>("eth_blockNumber");

  return parseInt(result, 16);
}

export async function getBlock(
  blockNumber: number
): Promise<RpcBlock | null> {
  const hexBlock =
    `0x${blockNumber.toString(16)}`;

  return await rpc<RpcBlock | null>(
    "eth_getBlockByNumber",
    [hexBlock, false]
  );
}

export function getRpcUrl(): string {
  return RPC_URL;
}

export function getConfiguredChainId(): number {
  return CHAIN_ID;
}
