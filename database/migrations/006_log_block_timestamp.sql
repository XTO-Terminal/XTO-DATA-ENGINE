BEGIN;

ALTER TABLE logs
ADD COLUMN IF NOT EXISTS block_timestamp TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_logs_chain_block_timestamp
ON logs (chain_id, block_timestamp);

COMMIT;
