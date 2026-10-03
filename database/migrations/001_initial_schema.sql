BEGIN;

-- =========================================================
-- XTO DATA ENGINE V1
-- Initial PostgreSQL Schema
-- =========================================================

-- ---------------------------------------------------------
-- BLOCKS
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS blocks (
    block_number BIGINT PRIMARY KEY,
    block_hash TEXT NOT NULL UNIQUE,
    parent_hash TEXT,
    timestamp TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_blocks_timestamp
    ON blocks(timestamp);


-- ---------------------------------------------------------
-- TOKENS
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS tokens (
    id BIGSERIAL PRIMARY KEY,

    address TEXT NOT NULL UNIQUE,
    name TEXT,
    symbol TEXT,
    decimals INTEGER,

    creator_address TEXT,

    total_supply NUMERIC(78, 0),

    created_block BIGINT,
    created_at_chain TIMESTAMPTZ,

    graduated BOOLEAN NOT NULL DEFAULT FALSE,
    graduated_block BIGINT,
    graduated_at TIMESTAMPTZ,

    migrated BOOLEAN NOT NULL DEFAULT FALSE,
    migrated_block BIGINT,
    migrated_at TIMESTAMPTZ,

    metadata_uri TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tokens_creator
    ON tokens(creator_address);

CREATE INDEX IF NOT EXISTS idx_tokens_graduated
    ON tokens(graduated);

CREATE INDEX IF NOT EXISTS idx_tokens_created_at
    ON tokens(created_at_chain);


-- ---------------------------------------------------------
-- MARKETS
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS markets (
    id BIGSERIAL PRIMARY KEY,

    token_id BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,

    market_type TEXT NOT NULL,

    curve_address TEXT,
    pool_address TEXT,

    base_token TEXT,
    quote_token TEXT,

    active BOOLEAN NOT NULL DEFAULT TRUE,

    created_block BIGINT,
    created_at_chain TIMESTAMPTZ,

    graduated BOOLEAN NOT NULL DEFAULT FALSE,
    migrated BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_token
    ON markets(token_id);

CREATE INDEX IF NOT EXISTS idx_markets_active
    ON markets(active);

CREATE INDEX IF NOT EXISTS idx_markets_type
    ON markets(market_type);


-- ---------------------------------------------------------
-- TRADES
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS trades (
    id BIGSERIAL PRIMARY KEY,

    token_id BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,
    market_id BIGINT REFERENCES markets(id) ON DELETE SET NULL,

    tx_hash TEXT NOT NULL,
    log_index INTEGER,

    trader_address TEXT NOT NULL,

    side TEXT NOT NULL,

    token_amount NUMERIC(78, 0) NOT NULL,
    native_amount NUMERIC(78, 0) NOT NULL,

    price NUMERIC(78, 36),

    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT trades_side_check
        CHECK (side IN ('BUY', 'SELL'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_tx_log
    ON trades(tx_hash, log_index);

CREATE INDEX IF NOT EXISTS idx_trades_token_time
    ON trades(token_id, block_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_trades_trader
    ON trades(trader_address);

CREATE INDEX IF NOT EXISTS idx_trades_block
    ON trades(block_number);


-- ---------------------------------------------------------
-- CANDLES
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS candles (
    id BIGSERIAL PRIMARY KEY,

    token_id BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,

    timeframe TEXT NOT NULL,

    open_time TIMESTAMPTZ NOT NULL,

    open NUMERIC(78, 36) NOT NULL,
    high NUMERIC(78, 36) NOT NULL,
    low NUMERIC(78, 36) NOT NULL,
    close NUMERIC(78, 36) NOT NULL,

    volume NUMERIC(78, 36) NOT NULL DEFAULT 0,

    trade_count INTEGER NOT NULL DEFAULT 0,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(token_id, timeframe, open_time)
);

CREATE INDEX IF NOT EXISTS idx_candles_lookup
    ON candles(token_id, timeframe, open_time DESC);


-- ---------------------------------------------------------
-- HOLDERS
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS holders (
    id BIGSERIAL PRIMARY KEY,

    token_id BIGINT NOT NULL REFERENCES tokens(id) ON DELETE CASCADE,

    wallet_address TEXT NOT NULL,

    balance NUMERIC(78, 0) NOT NULL DEFAULT 0,

    first_seen_block BIGINT,
    last_seen_block BIGINT,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE(token_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_holders_token_balance
    ON holders(token_id, balance DESC);

CREATE INDEX IF NOT EXISTS idx_holders_wallet
    ON holders(wallet_address);


-- ---------------------------------------------------------
-- INDEXER STATE
-- ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS indexer_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO indexer_state (key, value)
VALUES
    ('last_processed_block', '0'),
    ('status', 'initialized')
ON CONFLICT (key) DO NOTHING;

COMMIT;
