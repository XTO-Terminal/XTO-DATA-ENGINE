import "dotenv/config";
import fs from "node:fs";
import { Client } from "pg";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required");
}

const FILE =
  "logs/pool-discovery.json";

async function main() {
  console.log("========================================");
  console.log("XTO POOL DISCOVERY → POSTGRES");
  console.log("========================================");

  const snapshot = JSON.parse(
    fs.readFileSync(FILE, "utf8")
  );

  const pools = snapshot.pools ?? [];

  console.log("Snapshot:", FILE);
  console.log("Pools   :", pools.length);
  console.log("");

  const db = new Client({
    connectionString: DATABASE_URL,
  });

  await db.connect();

  let inserted = 0;
  let updated = 0;

  try {
    await db.query("BEGIN");

    for (const p of pools) {
      const result = await db.query(
        `
        INSERT INTO pools (
          pool_id,
          pool_manager,
          currency0,
          currency1,
          token0_address,
          token1_address,
          token0_type,
          token1_type,
          token0_name,
          token1_name,
          token0_symbol,
          token1_symbol,
          token0_decimals,
          token1_decimals,
          token0_total_supply,
          token1_total_supply,
          fee,
          tick_spacing,
          hooks,
          sqrt_price_x96,
          tick,
          initialized_at_block,
          initialize_tx,
          updated_at
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,
          $9,$10,$11,$12,$13,$14,$15,$16,
          $17,$18,$19,$20,$21,$22,$23,NOW()
        )
        ON CONFLICT (pool_id)
        DO UPDATE SET
          pool_manager = EXCLUDED.pool_manager,
          currency0 = EXCLUDED.currency0,
          currency1 = EXCLUDED.currency1,
          token0_address = EXCLUDED.token0_address,
          token1_address = EXCLUDED.token1_address,
          token0_type = EXCLUDED.token0_type,
          token1_type = EXCLUDED.token1_type,
          token0_name = EXCLUDED.token0_name,
          token1_name = EXCLUDED.token1_name,
          token0_symbol = EXCLUDED.token0_symbol,
          token1_symbol = EXCLUDED.token1_symbol,
          token0_decimals = EXCLUDED.token0_decimals,
          token1_decimals = EXCLUDED.token1_decimals,
          token0_total_supply = EXCLUDED.token0_total_supply,
          token1_total_supply = EXCLUDED.token1_total_supply,
          fee = EXCLUDED.fee,
          tick_spacing = EXCLUDED.tick_spacing,
          hooks = EXCLUDED.hooks,
          sqrt_price_x96 = EXCLUDED.sqrt_price_x96,
          tick = EXCLUDED.tick,
          initialized_at_block = EXCLUDED.initialized_at_block,
          initialize_tx = EXCLUDED.initialize_tx,
          updated_at = NOW()
        RETURNING
          (xmax = 0) AS inserted
        `,
        [
          p.poolId,
          p.poolManager,
          p.currency0,
          p.currency1,

          p.token0.address,
          p.token1.address,

          p.token0.type,
          p.token1.type,

          p.token0.name,
          p.token1.name,

          p.token0.symbol,
          p.token1.symbol,

          p.token0.decimals !== null
            ? Number(p.token0.decimals)
            : null,

          p.token1.decimals !== null
            ? Number(p.token1.decimals)
            : null,

          p.token0.totalSupply,
          p.token1.totalSupply,

          p.fee,
          Number(p.tickSpacing),

          p.hooks,

          p.sqrtPriceX96,
          Number(p.tick),

          p.initializedAtBlock,
          p.initializeTx,
        ]
      );

      if (result.rows[0]?.inserted) {
        inserted++;
      } else {
        updated++;
      }
    }

    await db.query("COMMIT");

    console.log("========================================");
    console.log("IMPORT COMPLETE");
    console.log("========================================");
    console.log("Snapshot pools :", pools.length);
    console.log("Inserted       :", inserted);
    console.log("Updated        :", updated);
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error("");
  console.error("ERROR:", error);
  process.exit(1);
});
