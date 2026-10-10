CREATE TABLE IF NOT EXISTS transactions (
    id BIGSERIAL PRIMARY KEY,
    block_number BIGINT NOT NULL,
    tx_hash TEXT NOT NULL,
    transaction_index INTEGER NOT NULL,
    from_address TEXT NOT NULL,
    to_address TEXT,
    value NUMERIC(78,0) NOT NULL DEFAULT 0,
    gas NUMERIC(78,0),
    gas_price NUMERIC(78,0),
    nonce BIGINT,
    input TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT transactions_tx_hash_key UNIQUE (tx_hash),
    CONSTRAINT transactions_block_tx_index_key
        UNIQUE (block_number, transaction_index)
);

CREATE INDEX IF NOT EXISTS idx_transactions_block
    ON transactions (block_number);

CREATE INDEX IF NOT EXISTS idx_transactions_from
    ON transactions (from_address);

CREATE INDEX IF NOT EXISTS idx_transactions_to
    ON transactions (to_address);
