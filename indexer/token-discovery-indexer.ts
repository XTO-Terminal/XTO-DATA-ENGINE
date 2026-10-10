import dotenv from "dotenv";
import { pool as db } from "../database/postgres.js";
import {
  ethCall,
  getChainId,
} from "../config/rpc.js";

dotenv.config();

const CHAIN_ID = Number(process.env.RH_CHAIN_ID || 4663);

const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const BATCH_SIZE = Number(
  process.env.TOKEN_DISCOVERY_BATCH_SIZE || 20
);

const CALL_DELAY_MS = Number(
  process.env.TOKEN_DISCOVERY_CALL_DELAY_MS || 250
);

const SELECTORS = {
  name: "0x06fdde03",
  symbol: "0x95d89b41",
  decimals: "0x313ce567",
  totalSupply: "0x18160ddd",
};

type Candidate = {
  address: string;
  first_seen_block: string;
  attempts: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeUint(hex: string | null): bigint | null {
  if (!hex || hex === "0x") return null;

  try {
    return BigInt(hex);
  } catch {
    return null;
  }
}

function decodeString(hex: string | null): string | null {
  if (!hex || hex === "0x") return null;

  const clean = hex.slice(2);

  try {
    if (clean.length >= 128) {
      const offset = Number(
        BigInt("0x" + clean.slice(0, 64))
      );

      const lengthPos = offset * 2;

      if (clean.length >= lengthPos + 64) {
        const length = Number(
          BigInt(
            "0x" +
            clean.slice(lengthPos, lengthPos + 64)
          )
        );

        const start = lengthPos + 64;
        const end = start + length * 2;

        if (
          Number.isSafeInteger(length) &&
          length >= 0 &&
          end <= clean.length
        ) {
          const value = Buffer.from(
            clean.slice(start, end),
            "hex"
          )
            .toString("utf8")
            .replace(/\0+$/g, "")
            .trim();

          if (value) return value;
        }
      }
    }

    if (clean.length >= 64) {
      const value = Buffer.from(
        clean.slice(0, 64),
        "hex"
      )
        .toString("utf8")
        .replace(/\0+$/g, "")
        .trim();

      return value || null;
    }
  } catch {
    return null;
  }

  return null;
}

async function call(
  address: string,
  data: string
): Promise<string | null> {
  try {
    const result = await ethCall({
      to: address,
      data,
    });

    await sleep(CALL_DELAY_MS);

    return result;
  } catch {
    await sleep(CALL_DELAY_MS);
    return null;
  }
}

async function registerCandidates(): Promise<number> {
  const result = await db.query(
    `
    INSERT INTO token_discovery_candidates (
      chain_id,
      address,
      first_seen_block
    )
    SELECT
      $1,
      lower(l.address),
      MIN(l.block_number)
    FROM logs l
    WHERE l.chain_id = $1
      AND l.topic0 = $2
    GROUP BY lower(l.address)

    ON CONFLICT (chain_id, address)
    DO UPDATE SET
      first_seen_block = LEAST(
        token_discovery_candidates.first_seen_block,
        EXCLUDED.first_seen_block
      ),
      updated_at = NOW()

    RETURNING id
    `,
    [CHAIN_ID, TRANSFER_TOPIC]
  );

  return result.rowCount ?? 0;
}

async function getPending(): Promise<Candidate[]> {
  const result = await db.query<Candidate>(
    `
    SELECT
      address,
      first_seen_block::text,
      attempts
    FROM token_discovery_candidates
    WHERE chain_id = $1
      AND status = 'pending'
    ORDER BY first_seen_block, address
    LIMIT $2
    `,
    [CHAIN_ID, BATCH_SIZE]
  );

  return result.rows;
}

async function probe(address: string) {
  /*
   * Intentionally sequential.
   * Do not burst four RPC calls simultaneously.
   */
  const nameRaw = await call(
    address,
    SELECTORS.name
  );

  const symbolRaw = await call(
    address,
    SELECTORS.symbol
  );

  const decimalsRaw = await call(
    address,
    SELECTORS.decimals
  );

  const supplyRaw = await call(
    address,
    SELECTORS.totalSupply
  );

  const name = decodeString(nameRaw);
  const symbol = decodeString(symbolRaw);
  const decimals = decodeUint(decimalsRaw);
  const supply = decodeUint(supplyRaw);

  if (
    decimals === null ||
    supply === null ||
    decimals < 0n ||
    decimals > 255n
  ) {
    return null;
  }

  if (!name && !symbol) {
    return null;
  }

  return {
    name,
    symbol,
    decimals: Number(decimals),
    totalSupply: supply.toString(),
  };
}

async function markRejected(
  address: string,
  reason: string
): Promise<void> {
  await db.query(
    `
    UPDATE token_discovery_candidates
    SET
      status = 'rejected',
      attempts = attempts + 1,
      last_error = $3,
      last_attempt_at = NOW(),
      updated_at = NOW()
    WHERE chain_id = $1
      AND address = $2
    `,
    [CHAIN_ID, address, reason]
  );
}

async function markVerified(
  candidate: Candidate,
  metadata: {
    name: string | null;
    symbol: string | null;
    decimals: number;
    totalSupply: string;
  }
): Promise<void> {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
      INSERT INTO tokens (
        address,
        name,
        symbol,
        decimals,
        total_supply,
        created_block,
        updated_at
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW())

      ON CONFLICT (address)
      DO UPDATE SET
        name = EXCLUDED.name,
        symbol = EXCLUDED.symbol,
        decimals = EXCLUDED.decimals,
        total_supply = EXCLUDED.total_supply,
        created_block = COALESCE(
          tokens.created_block,
          EXCLUDED.created_block
        ),
        updated_at = NOW()
      `,
      [
        candidate.address,
        metadata.name,
        metadata.symbol,
        metadata.decimals,
        metadata.totalSupply,
        candidate.first_seen_block,
      ]
    );

    await client.query(
      `
      UPDATE token_discovery_candidates
      SET
        status = 'verified',
        attempts = attempts + 1,
        last_error = NULL,
        last_attempt_at = NOW(),
        updated_at = NOW()
      WHERE chain_id = $1
        AND address = $2
      `,
      [CHAIN_ID, candidate.address]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runBatch(): Promise<number> {
  const registered = await registerCandidates();

  console.log(
    `[TOKEN DISCOVERY] registry_upserts=${registered}`
  );

  const pending = await getPending();

  console.log(
    `[TOKEN DISCOVERY] pending_batch=${pending.length}`
  );

  let verified = 0;
  let rejected = 0;

  for (const candidate of pending) {
    const metadata = await probe(candidate.address);

    if (!metadata) {
      await markRejected(
        candidate.address,
        "ERC20 verification failed"
      );

      rejected += 1;

      console.log(
        `[TOKEN REJECTED] ${candidate.address}`
      );

      continue;
    }

    await markVerified(candidate, metadata);

    verified += 1;

    console.log(
      `[TOKEN VERIFIED] ${candidate.address}` +
      ` symbol=${metadata.symbol ?? "?"}` +
      ` name=${metadata.name ?? "?"}` +
      ` decimals=${metadata.decimals}`
    );
  }

  console.log(
    `[TOKEN DISCOVERY BATCH] verified=${verified}` +
    ` rejected=${rejected}` +
    ` processed=${pending.length}`
  );

  return pending.length;
}

async function main(): Promise<void> {
  const actualChain = await getChainId();

  if (actualChain !== CHAIN_ID) {
    throw new Error(
      `Unexpected chain ${actualChain}; expected ${CHAIN_ID}`
    );
  }

  console.log(
    `[TOKEN DISCOVERY] chain=${CHAIN_ID}` +
    ` batch=${BATCH_SIZE}`
  );

  let consecutiveErrors = 0;

  while (true) {
    try {
      const processed = await runBatch();

      consecutiveErrors = 0;

      /*
       * Backlog exists: continue at a controlled pace.
       * No backlog: poll more slowly for newly discovered contracts.
       */
      const baseDelay =
        processed > 0 ? 5000 : 15000;

      const jitter = Math.floor(
        Math.random() * 2000
      );

      await sleep(baseDelay + jitter);
    } catch (error) {
      consecutiveErrors += 1;

      const baseDelay = Math.min(
        5000 *
          (2 ** Math.min(consecutiveErrors - 1, 4)),
        60000
      );

      const jitter = Math.floor(
        Math.random() * 3000
      );

      const retryDelay =
        baseDelay + jitter;

      console.error(
        `[TOKEN DISCOVERY ERROR]`,
        error
      );

      console.error(
        `[TOKEN DISCOVERY BACKOFF]` +
        ` consecutive=${consecutiveErrors}` +
        ` retry_in_ms=${retryDelay}`
      );

      await sleep(retryDelay);
    }
  }
}

main().catch((error) => {
  console.error(
    "[TOKEN DISCOVERY FATAL]",
    error
  );

  process.exit(1);
});
