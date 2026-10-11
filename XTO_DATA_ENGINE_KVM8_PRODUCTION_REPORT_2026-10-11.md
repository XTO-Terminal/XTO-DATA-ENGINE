# XTO DATA ENGINE — KVM8 Production Optimization Report

**Report date:** 2026-10-11  
**Environment:** Robinhood Chain mainnet (chain ID 4663)  
**Deployment:** Hostinger KVM8, Ubuntu 26.04  
**Project:** `/root/XTO-DATA-ENGINE`  
**Repository:** `https://github.com/XTO-Terminal/XTO-DATA-ENGINE`  
**Status:** Optimizations deployed and validated; historical catch-up still in progress.

> **Security note:** This report intentionally excludes IP addresses, credentials, API keys, database connection strings, and wallet secrets. Review before publishing to a public repository.

## 1. Executive Summary

Four source files were upgraded on the production KVM8 server to improve historical catch-up throughput and RPC reliability. TypeScript compilation passed after deployment. The three principal indexers (`xto-log`, `xto-block`, and `xto-transaction`) were active, with zero service restarts and no matching errors in the observed journal windows. A subsequent system-wide check found all 11 XTO services active.

**Key distinction:** The indexers were processing blocks faster than the observed Robinhood Chain growth rate, and their backlog was shrinking. Full chain-head synchronization and lower steady-state Alchemy Compute Unit (CU) consumption were **not yet confirmed** by the measurements in this report.

## 2. Production Changes

| File | Change | Deployed SHA-256 |
|---|---|---|
| `config/rpc.ts` | Opt-in Alchemy-primary RPC routing for indexer services | `ab7b62dbbf65888b70e81dc1945b7c9ec27c2270cadafa0bbbf13bc82e755399` |
| `indexer/log-indexer.ts` | Bounded parallel block timestamp retrieval; atomic log/checkpoint persistence; cached head during catch-up | `26228675c4ea168fb34e9027a84fe18fd12c98e57d0b92ace7b1c68381008697` |
| `indexer/block-indexer.ts` | Cached chain head while catching up, with refresh at the cached head | `cc42fc6b2b6673a942c375ad1ed7822758b7584a666ba559b713a89f39b37b97` |
| `indexer/transaction-indexer.ts` | Cached chain head while catching up, with refresh at the cached head | `78ed8c069709651eb8d5feeb1e23906e332b0e87c840ab8fe231e0b74c6dcfab` |

### Runtime routing

- `A1_ALCHEMY_LOG_PRIMARY=1`: prefer Alchemy for `eth_getLogs` in the log indexer.
- `A1_ALCHEMY_INDEXER_PRIMARY=1`: use Alchemy as primary RPC for the indexer services.
- The three indexer services were configured with the relevant flags using systemd overrides.
- The Alchemy-primary branch does **not** provide a public RPC fallback. Monitor provider failures, rate limiting, and CU budgets.

### Persistence and integrity

The log indexer obtains required timestamps before opening the database transaction and commits log writes together with its checkpoint. Timestamp fetching is bounded in groups of five. Chain-head reads are cached during catch-up, reducing unnecessary repeated head queries.

## 3. Verification and Test Results

| Verification | Observed result |
|---|---|
| Local TypeScript `tsc --noEmit` | PASS |
| Production TypeScript `tsc --noEmit` | PASS |
| Gate 8: isolated real PostgreSQL failure-injection tests | PASS |
| Gate 8: RPC, timestamp, log, checkpoint, commit rollback and replay cases | PASS |
| Gate 4B: isolated database throughput test | 200 blocks, 300 logs, 1.319 s (~151.66 blocks/s) |
| Production indexer services after deployment | 3/3 active |
| Production system-wide service check | 11/11 active |
| Observed service restarts | 0 |
| Matching errors in monitored journal windows | None detected |

**Test scope:** Gate 4B measured an isolated database-focused scenario, **not** end-to-end RPC throughput. Gate 8 used an isolated local PostgreSQL instance and fault injection; it is not a substitute for ongoing production monitoring.

## 4. Final Production Benchmark — 120.33 Seconds

**Observed Robinhood Chain growth:** 9.62 blocks/s.

| Indexer | Blocks processed | Throughput | Initial lag | Final lag | Lag shrinking? |
|---|---:|---:|---:|---:|---|
| Transaction | 3,158 | 26.24 blocks/s | 153,421 | 151,421 | Yes |
| Block | 3,702 | 30.76 blocks/s | 181,204 | 178,660 | Yes |
| Log | 7,260 | 60.33 blocks/s | 188,018 | 181,916 | Yes |

Benchmark chain head: **85,849,161 → 85,850,319**. The service-health check reported all three indexers active, zero restarts, exit status 0, and no errors matching the monitoring filters.

### Interpretation

Each indexer processed historical blocks faster than the chain generated new blocks during this window. This establishes measurable backlog reduction during the test, **not** a guarantee of sustained throughput or complete synchronization.

## 5. Subsequent Live KVM8 Monitor — 2026-10-11 13:38–13:39 UTC

### Host resources

| Metric | Observed value |
|---|---|
| Logical CPUs | 8 |
| System load average (1 / 5 / 15 min) | 1.76 / 1.84 / 1.82 |
| RAM | 31 GiB total; 2.0 GiB used; 29 GiB available |
| Root filesystem | 387 GiB total; 9.3 GiB used (~3%) |
| Swap | None configured |
| `vmstat` CPU idle in sampled seconds | 78–92% |
| PostgreSQL | Accepting connections |
| Redis | `PONG` |
| Redis rejected connections | 0 |
| Redis total error replies | 0 |
| XTO systemd services | 11/11 active; 0 restarts reported |

Redis instantaneous operations per second were 0 at the exact sampling moment; this alone does not establish whether Redis is being used by application traffic.

### Indexer checkpoints (three snapshots, 15-second intervals)

| Indexer | Snapshot 1 | Snapshot 2 | Snapshot 3 | Approx. 30s average |
|---|---:|---:|---:|---:|
| Block | 85,744,997 | 85,745,439 | 85,745,799 | 26.71 blocks/s |
| Transaction | 85,762,399 | 85,762,774 | 85,763,064 | 22.15 blocks/s |
| Log | 85,812,863 | 85,813,713 | 85,814,353 | 49.61 blocks/s |

The 30-second averages were calculated from the first and third snapshots. **The live monitor did not sample the chain head**, so the precise lag at 13:39 UTC was not established by that monitor. The observed throughput remained above the **earlier** measured chain growth rate of 9.62 blocks/s; that earlier rate is not a simultaneous chain measurement.

### Service inventory

`xto-api`, `xto-block`, `xto-transaction`, `xto-log`, `xto-pool-v2`, `xto-swap-v2`, `xto-token`, `xto-trade`, `xto-candle-1m`, `xto-candle-aggregate`, `xto-metrics`.

All reported `active` with `NRestarts=0` in the system-wide sample. This is a service-state observation, not a complete end-to-end API correctness test.

## 6. Alchemy Compute Unit Budget and Catch-up

The Alchemy monthly CU cap was increased by the operator from **19 million to 38 million CU** during testing. At an earlier dashboard snapshot, usage was approximately **9.41 million CU**; usage may have increased since then.

### Expected behavior

1. **Catch-up phase:** indexers read historical blocks, transactions, and logs while tracking new blocks. RPC demand is elevated.
2. **Steady-state phase:** once checkpoints reach chain head, indexers should process newly arriving chain activity rather than repeatedly replaying already persisted history. Historical application queries should be served from the database or cache where supported.
3. **Validation required:** measure actual Alchemy CU/hour and CU/day **after** catch-up. Reduced CU consumption is expected but not yet proven, and the exact reduction depends on RPC methods, polling frequency, workload, and chain activity.

**Important:** A monthly CU limit is a budget/usage control, not the historical block target. Exhausting the cap may interrupt RPC access and prevent continued synchronization. Increasing the cap does not itself improve code efficiency. Previously consumed monthly CU does not reset when the indexers catch up.

## 7. Operational Safety and Recovery

- Pre-deployment backup directory: `/root/xto-backups/realtime-predeploy-20261011-124654`.
- Backup directory pointer: `/root/xto-realtime-rollback-path`.
- The source package used for the four-file upgrade was `XTO-REALTIME-OPTIMIZATION-RC1.tar.gz`.
- Before any rollback, inspect the actual backup contents and current systemd overrides. In particular, the original log-indexer override was not captured in the same way as the block and transaction service configurations.
- Do not publish `.env`, private keys, Alchemy credentials, SSH keys, database passwords, or operator wallet details.
- Do not restart or redeploy production services merely to publish this documentation.

## 8. Remaining Acceptance Gates

- [x] Four-file production patch deployed.
- [x] Production TypeScript compilation passed.
- [x] Isolated PostgreSQL rollback/integrity tests passed.
- [x] Three indexers active, zero restarts in sampled checks.
- [x] All 11 services active in sampled check.
- [x] Backlog shrinking in the 120.33-second benchmark.
- [ ] All three indexers reach and remain near current chain head.
- [ ] Record steady-state Alchemy CU/hour after catch-up.
- [ ] Verify indexer freshness and data integrity against chain-head samples.
- [ ] Validate public-facing XTO API endpoints, latency, and data correctness.
- [ ] Validate end-to-end frontend consumption of indexed market, trade, and chart data.
- [ ] Conduct a longer-duration stability and resource observation.

## 9. Release Assessment

**Deployed optimization status: PASS.**  
**Historical synchronization status: IN PROGRESS.**  
**Steady-state CU efficiency: PENDING MEASUREMENT.**  
**Frontend integration readiness: REQUIRES API/FRESHNESS VALIDATION.**

The production measurements support a substantial throughput improvement and stable sampled service operation. They do not yet support a claim that the engine has fully synchronized, that Alchemy consumption has normalized, or that the frontend integration is complete.

---

**Prepared for XTO Terminal engineering records and repository documentation.**
