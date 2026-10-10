BEGIN;

CREATE TABLE IF NOT EXISTS market_metrics (
    token_id BIGINT PRIMARY KEY
        REFERENCES tokens(id) ON DELETE CASCADE,

    last_price NUMERIC(78,36),

    price_change_5m NUMERIC(38,18),
    price_change_1h NUMERIC(38,18),

    volume_5m NUMERIC(78,36) NOT NULL DEFAULT 0,
    volume_1h NUMERIC(78,36) NOT NULL DEFAULT 0,

    buys_5m INTEGER NOT NULL DEFAULT 0,
    sells_5m INTEGER NOT NULL DEFAULT 0,
    trades_5m INTEGER NOT NULL DEFAULT 0,

    buys_1h INTEGER NOT NULL DEFAULT 0,
    sells_1h INTEGER NOT NULL DEFAULT 0,
    trades_1h INTEGER NOT NULL DEFAULT 0,

    last_trade_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_market_metrics_updated
ON market_metrics (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_metrics_volume_1h
ON market_metrics (volume_1h DESC);

COMMIT;
