BEGIN;

-- =========================================================
-- XTO DATA ENGINE V1
-- Raw EVM Logs
--
-- Robinhood Mainnet first.
-- chain_id included from day one for future multi-chain use.
-- =========================================================

CREATE TABLE IF NOT EXISTS logs (
    id BIGSERIAL PRIMARY KEY,

    chain_id BIGINT NOT NULL,

    block_number BIGINT NOT NULL,
    block_hash TEXT NOT NULL,

    tx_hash TEXT NOT NULL,
    transaction_index INTEGER NOT NULL,
    log_index INTEGER NOT NULL,

    address TEXT NOT NULL,

    topic0 TEXT,
    topic1 TEXT,
    topic2 TEXT,
    topic3 TEXT,

    data TEXT NOT NULL DEFAULT '0x',

    removed BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT logs_chain_tx_log_key
        UNIQUE (chain_id, tx_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_logs_chain_block
    ON logs (chain_id, block_number);

CREATE INDEX IF NOT EXISTS idx_logs_chain_address
    ON logs (chain_id, address);

CREATE INDEX IF NOT EXISTS idx_logs_chain_topic0
    ON logs (chain_id, topic0);

CREATE INDEX IF NOT EXISTS idx_logs_chain_address_topic0
    ON logs (chain_id, address, topic0);

CREATE INDEX IF NOT EXISTS idx_logs_tx_hash
    ON logs (tx_hash);

COMMIT;
