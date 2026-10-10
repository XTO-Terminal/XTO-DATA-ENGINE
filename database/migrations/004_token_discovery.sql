BEGIN;

CREATE TABLE IF NOT EXISTS token_discovery_candidates (
    id BIGSERIAL PRIMARY KEY,

    chain_id BIGINT NOT NULL,
    address TEXT NOT NULL,
    first_seen_block BIGINT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'verified', 'rejected')),

    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    last_attempt_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT token_discovery_chain_address_key
        UNIQUE (chain_id, address)
);

CREATE INDEX IF NOT EXISTS idx_token_discovery_status
    ON token_discovery_candidates (chain_id, status);

CREATE INDEX IF NOT EXISTS idx_token_discovery_first_seen
    ON token_discovery_candidates (chain_id, first_seen_block);

COMMIT;
