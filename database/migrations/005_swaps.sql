BEGIN;

CREATE TABLE IF NOT EXISTS swaps (
    id BIGSERIAL PRIMARY KEY,

    chain_id BIGINT NOT NULL,
    pool_id TEXT NOT NULL,

    tx_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    block_number BIGINT NOT NULL,

    sender TEXT NOT NULL,

    amount0 NUMERIC(78,0) NOT NULL,
    amount1 NUMERIC(78,0) NOT NULL,

    sqrt_price_x96 NUMERIC(78,0) NOT NULL,
    liquidity NUMERIC(78,0) NOT NULL,
    tick INTEGER NOT NULL,
    fee NUMERIC(78,0) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT swaps_chain_tx_log_key
        UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_swaps_chain_block
    ON swaps (chain_id, block_number);

CREATE INDEX IF NOT EXISTS idx_swaps_chain_pool_block
    ON swaps (chain_id, pool_id, block_number DESC);

CREATE INDEX IF NOT EXISTS idx_swaps_sender
    ON swaps (sender);

CREATE INDEX IF NOT EXISTS idx_swaps_tx_hash
    ON swaps (tx_hash);

COMMIT;
