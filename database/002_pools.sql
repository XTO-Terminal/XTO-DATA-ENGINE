CREATE TABLE IF NOT EXISTS pools (
    pool_id TEXT PRIMARY KEY,

    pool_manager TEXT NOT NULL,

    currency0 TEXT NOT NULL,
    currency1 TEXT NOT NULL,

    token0_address TEXT NOT NULL,
    token1_address TEXT NOT NULL,

    token0_type TEXT,
    token1_type TEXT,

    token0_name TEXT,
    token1_name TEXT,

    token0_symbol TEXT,
    token1_symbol TEXT,

    token0_decimals INTEGER,
    token1_decimals INTEGER,

    token0_total_supply NUMERIC,
    token1_total_supply NUMERIC,

    fee NUMERIC NOT NULL,
    tick_spacing INTEGER NOT NULL,

    hooks TEXT NOT NULL,

    sqrt_price_x96 NUMERIC NOT NULL,
    tick INTEGER NOT NULL,

    initialized_at_block BIGINT NOT NULL,
    initialize_tx TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pools_token0
    ON pools(token0_address);

CREATE INDEX IF NOT EXISTS idx_pools_token1
    ON pools(token1_address);

CREATE INDEX IF NOT EXISTS idx_pools_initialized_block
    ON pools(initialized_at_block);

CREATE INDEX IF NOT EXISTS idx_pools_symbols
    ON pools(token0_symbol, token1_symbol);
