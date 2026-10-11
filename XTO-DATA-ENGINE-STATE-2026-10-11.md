# XTO DATA ENGINE — HANDOFF STATE

**Date:** 2026-10-11 (Indonesia)  
**Purpose:** Resume engineering work tonight without repeating completed audits.  
**Project:** XTO DATA ENGINE on Robinhood Chain, chain ID **4663**.  
**Repository:** `XTO-Terminal/XTO-DATA-ENGINE` (private).  
**Last confirmed KVM working tree:** `/root/XTO-DATA-ENGINE`, `master`, HEAD `8626618` before later KVM-only changes. **Verify current Git status/HEAD before modifying source.**

## 1. Executive state

- **11 systemd units reported active/running:** `xto-api`, `xto-block`, `xto-transaction`, `xto-log`, `xto-pool-v2`, `xto-swap-v2`, `xto-token`, `xto-trade`, `xto-candle-1m`, `xto-candle-aggregate`, `xto-metrics`.
- API previously returned **HTTP 200** for `/health`, `/health/db`, `/health/redis`, and `/api/v1/markets` on `127.0.0.1:8787`.
- **Do not confuse `active` with healthy indexing.** Raw RPC workers previously restarted because their RPC requests timed out; validate checkpoint movement and logs after switching providers.
- PostgreSQL 18.6 and Redis installed; Node 24.21.0; TypeScript `npm run typecheck` previously passed.
- **Historical staging backfill is partially complete**, not canonical replay and not full chain history.
- Main blocker is **RPC capacity/availability**. Public Robinhood RPC returned Cloudflare HTML `403`. Alchemy Robinhood mainnet RPC returned chain ID `4663` successfully (`200`) but historical requests later hit **HTTP 429 rate limiting**.
- **Decision pending:** Upgrade Alchemy capacity for near-term production, or provision a dedicated Robinhood Nitro full node (128 GB RAM proposed), or both in stages. No purchase or server deployment authorized yet.

## 2. Infrastructure

- Host: `srv2038643` (Hostinger KVM), Ubuntu 26.04; project directory `/root/XTO-DATA-ENGINE`.
- KVM observed capacity: **31 GiB RAM**, approximately **387 GB filesystem**, ~385 GB free at time of inspection. Not sufficient for a 128 GB RAM / multi-TB NVMe full-node target.
- Database: `xto_data_engine`, PostgreSQL role `xto`; Redis active.
- Existing tables: `blocks`, `candles`, `holders`, `indexer_state`, `logs`, `market_metrics`, `markets`, `pools`, `swaps`, `token_discovery_candidates`, `tokens`, `trades`, `transactions`.
- Additional **staging** tables created by backfill script: `xto_historical_logs`, `xto_historical_progress`.
- API bound to loopback `127.0.0.1:8787`; no public exposure confirmed.
- `.env` contains sensitive RPC/API/database settings. **Never commit or print secrets.** A protected `.env` backup was created during RPC switch.
- Database backup before historical backfill: `/root/xto-backups/pre-backfill-20261011-021127.dump` (observed ~110 KB). Verify it exists before any replay/migration.

## 3. Pipeline architecture

Raw ingest: `block-indexer.ts`, `transaction-indexer.ts`, `log-indexer.ts`.

Derived: `pool-registry-indexer-v2.ts`, `swap-decoder-v2.ts`, `token-discovery-indexer.ts`, `trade-normalizer-v1.ts`, `candle-engine-1m.ts`, `candle-aggregator.ts`, `market-metrics-engine-v1.ts`.

`candle-engine-1m` is canonical 1-minute candle source; aggregator derives 5m, 15m, 30m, 1h, 4h, 1d. Existing aggregation is bounded by lookback windows and is **not** a complete historical candle rebuild.

Avoid running older `pool-registry-indexer.ts` V1 alongside V2 without design review.

## 4. Confirmed DB snapshot before staging backfill

Last observed baseline (may now be stale; query current values):

| Metric | Value |
|---|---:|
| Blocks | 45 |
| Transactions | 159 |
| Raw logs | 339 |
| Pools | 2 |
| Swaps | 3 |
| Tokens | 12 |
| Trades | 3 |
| Candles | 7 |
| Market metrics | 1 |
| Raw block checkpoint | 85469993 |
| Transaction checkpoint | 85469993 |
| Raw log checkpoint | 85469978 |
| Pool V2 log ID checkpoint | 244 |
| Swap V2 log ID checkpoint | 168 |

**Important:** These checkpoints were captured while public RPC was failing. After switching to Alchemy, services were restarted and showed active/no immediate errors, but advancing checkpoints were **not yet independently verified**.

## 5. Historical backfill: exact state

File on KVM: `scripts/historical-backfill.mjs` (created directly on KVM; **not confirmed committed to GitHub**).

Implementation currently:
- Uses `RH_RPC_URL`, checks `eth_chainId == 4663`.
- Determines first historical window as 1,000 blocks preceding earliest canonical `logs.block_number`.
- Requests unfiltered `eth_getLogs` in **10-block batches**.
- Writes to `xto_historical_logs` with `(chain_id, tx_hash, log_index)` primary key and `ON CONFLICT DO NOTHING`.
- Stores separate progress in `xto_historical_progress`, committing batch and checkpoint together.
- Does **not** populate canonical `logs`, `pools`, `swaps`, `trades`, or `candles`.

Backfill window: **85468949 through 85469948 inclusive** (1,000 blocks).

Confirmed from SQL after first interruption:
- `xto_historical_logs`: **7,727** rows, blocks `85468949..85469738`.
- Job `historical-85468949-85469948`, checkpoint `85469738`.

Subsequent Alchemy run reported another **797** events over blocks `85469739..85469838` before repeated `429`. Hence **expected** staging count **8,524** and checkpoint **85469838**, but these latest values require SQL confirmation. **110 blocks remain** (`85469839..85469948`).

RPC history:
1. Robinhood public endpoint returned connection timeouts and then `403` Cloudflare challenge.
2. Existing Alchemy key successfully accessed chain ID 4663, and `RH_RPC_URL` in KVM `.env` was switched to an Alchemy endpoint after a successful probe.
3. Historical `eth_getLogs` requests then intermittently returned `429`; retries eventually exhausted.
4. **Do not increase retry counts indefinitely or bypass provider controls.** Investigate actual Alchemy usage/quota, concurrency, and provider-supported historical query limits.

## 6. Critical correctness risks

1. **Historical replay ordering:** Pool V2 and Swap V2 use `logs.id` checkpoints, not block-number checkpoints. Importing old blocks into canonical `logs` with new IDs could process old events out of chronological order. A replay strategy must be designed/tested before canonical import.
2. **Pool dependency:** Swap V2 `INNER JOIN pools`; unknown pools' swaps may be skipped. Need historical Initialize discovery before swap replay and verify no event loss.
3. **Historical candles:** current 1m/aggregate workers use bounded windows. Build explicit historical candle generation and verify OHLCV against ordered trades.
4. **Missing market data:** `/api/v1/markets` HTTP 200 is not evidence of populated markets; no complete market builder was established.
5. **Live liveness:** `systemd active` can coexist with RPC retry loops. Require two timestamped checkpoint samples and measure block lag.
6. **Chain reorganizations and idempotency:** ensure canonical event uniqueness, removed logs handling, block timestamps, deterministic event order, and replay repeatability.
7. **Secrets:** never commit `.env`, RPC API keys, backup dumps, or sensitive logs.

## 7. Tonight's execution plan (in order)

**A. Freeze and verify current state (single batched check).**
- `git status --short; git rev-parse --short HEAD; systemctl list-units 'xto-*.service' --no-pager`.
- Query `xto_historical_progress` and count/range of `xto_historical_logs`.
- Sample live `indexer_state` twice 30–60 seconds apart, verify forward movement, compare to `eth_blockNumber` and inspect service restart counts.
- Confirm Alchemy plan, CU/s, request usage, error breakdown and RPC URL in use **without revealing credentials**.

**B. Choose RPC infrastructure based on actual requirements.**
- Fast path: paid Alchemy capacity if it supports Robinhood historical `eth_getLogs` at needed throughput; implement a centralized RPC budget/queue prioritizing live ingest over backfill and honoring `429`/`Retry-After`.
- Dedicated path: verify official Robinhood Nitro full-node deployment requirements (L1 execution + beacon dependencies, NVMe size, snapshot/sync time, pruning/history availability, observability). 128 GB RAM alone is not enough to guarantee a working historical RPC. Provision only after cost and specs approval.
- Keep API and DB independent of the selected upstream RPC; support safe provider failover.

**C. Complete the 1,000-block staging job** only after provider capacity is confirmed. Resume from saved checkpoint, never truncate staging or reset live checkpoints. Confirm expected range and row count.

**D. Build and test canonical historical replay.**
- Separate replay checkpoints and isolated tests on DB copy/staging first.
- Sort historical events by `(block_number, transaction_index, log_index)`; establish pools before swaps, swaps before trades, trades before candles/metrics.
- Guarantee idempotency and verify counts/uniqueness and missing-event detection; do not blindly rewind live log-ID checkpoints.
- Use bounded batches, transaction-safe commits, pause/resume, structured logs, rollback plan.

**E. Production hardening.**
- Health checks for checkpoint advancement and chain head lag, not only HTTP process health.
- RPC usage monitoring, retry budgets, queue/backpressure, alerting, rate-limit metrics.
- Restore-test database backup and define retention.
- Avoid claiming production readiness until live ingestion, historical completeness, market API data, and replay invariants pass.

## 8. Safe read-only restart commands

```bash
cd /root/XTO-DATA-ENGINE

git status --short && git rev-parse --short HEAD
systemctl list-units 'xto-*.service' --no-pager

runuser -u postgres -- psql -X -d xto_data_engine -c \
  'SELECT job,last_block,updated_at FROM xto_historical_progress ORDER BY updated_at DESC;'

runuser -u postgres -- psql -X -d xto_data_engine -c \
  'SELECT COUNT(*) AS n,MIN(block_number) AS first_block,MAX(block_number) AS last_block FROM xto_historical_logs;'

runuser -u postgres -- psql -X -d xto_data_engine -c \
  'SELECT key,value,updated_at FROM indexer_state ORDER BY key;'

for name in block transaction log token; do
  systemctl show "xto-$name.service" -p ActiveState -p NRestarts --no-pager
done
```

## 9. Locked working rules

- This handoff is about **XTO DATA ENGINE**. Do not rename or expand the product scope.
- Preserve existing production data, contracts, fee/economic specifications, and checkpoints.
- Never expose secrets or push runtime `.env`.
- Do not deploy new infrastructure, upgrade paid subscriptions, or make destructive DB changes without authorization.
- Prefer one coordinated batch with explicit verification over repetitive audits.
- Report observed results separately from estimates or unexecuted plans.

**Resume point:** Alchemy `429` after staged block `85469838` (reported, not SQL-verified); first priority is RPC capacity decision, then finish 110 blocks and design safe historical replay.
