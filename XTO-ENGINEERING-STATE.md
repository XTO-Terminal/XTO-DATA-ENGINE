# XTO ENGINEERING STATE
Updated: 2026-10-10
Project: XTO REBUILD V3
Chain: Robinhood Chain (4663)

## 1. Current Objective
Integrate XTO Data Engine with the latest production frontend baseline.
Replace third-party market data dependencies progressively.
Build independent OHLCV and market data APIs.
Redesign DEXTERMINAL UI/UX without breaking locked functionality.

## 2. Data Engine
Repository: /home/a_z_n/XTO-DATA-ENGINE
Last committed revision: fcfd4ec
Branch: master
Hosting: Hostinger KVM, running 24/7 (operator confirmed).

Implemented components:
- RPC abstraction
- PostgreSQL
- Redis
- Block indexer
- Pool registry indexer
- PoolManager swap decoder
- PoolManager swap indexer
- Raw swap database migration
- Checkpoint and batch ingestion

Local uncommitted files include:
- database/migrations/003_pool_swaps.sql
- indexer/poolmanager-swap-indexer.ts
- src/poolmanager/
- swap decoder and worker test scripts

## 3. Current API
Verified from api/server.ts:
- GET /health
- GET /health/db
- GET /health/redis

Market data endpoints have not yet been implemented in this file.

## 4. Frontend
Local path: /mnt/e/Frontend_XTO/Rebuild_Frontend
Baseline: XTO-TERMINAL-V2-PRODUCTION

Current external data integrations:
- GMGN Kline and market information
- CMC recent trades
- Dexscreener discovery and trending
- Blockscout holder information

Frontend has not yet been integrated with the current XTO REBUILD V3 contracts.

## 5. Next Engineering Tasks
1. Inspect current Data Engine storage and market registry.
2. Define normalized market and trade data schemas.
3. Build and test independent OHLCV aggregation.
4. Expose REST market data endpoints.
5. Add authenticated or appropriately secured realtime data delivery.
6. Integrate frontend through a typed XTO API adapter.
7. Remove legacy API dependencies only after successful replacement.
8. Redesign frontend UI/UX.
9. Integrate current V3 contracts and validate complete lifecycle.

## 6. Locked Working Rules
- Preserve completed and tested components.
- One finding requires one targeted test and evidence.
- No unverified claims of production readiness.
- No private keys, passwords, or secrets in Git.
- Do not modify locked smart-contract economics.
- No production deployment without explicit approval.
- Do not use localStorage for functional persistent data.
- Update this document after every completed engineering milestone.

## 7. Test Evidence
Pending: attach previous test results and deployment evidence.
Do not mark unverified items as passed.

## 8. Current Status
Data Engine infrastructure deployed.
Market data API and OHLCV integration pending.
Frontend migration pending.

## 9. KVM Production Recovery — 2026-10-10

Production server:
- Hostname: srv2038643
- Working directory: /root/XTO-DATA-ENGINE
- Runtime: Node.js v24.20.0 with tsx
- PostgreSQL 18 and Redis: systemd active/running

XTO services reported active/running by systemd:
- xto-api
- xto-block-indexer
- xto-log-indexer
- xto-transaction-indexer
- xto-pool-registry
- xto-swap-decoder
- xto-token-discovery
- xto-trade-normalizer
- xto-candle-engine
- xto-candle-aggregator
- xto-market-metrics

Recovered production source:
- api/server.ts with REST API and WebSocket implementation
- Candle Engine 1m
- Multi-timeframe Candle Aggregator
- Market Metrics Engine V1
- Trade Normalizer V1
- Swap Decoder V2
- Pool Registry V2
- Token Discovery Indexer
- Transaction and Log Indexers
- Database migrations through 007_market_metrics.sql

Recovery and validation:
- KVM source snapshot downloaded to PC
- Clean source separated from credentials and runtime files
- Production repository created independently with existing Git history
- npm ci: PASS
- npm run typecheck: PASS
- npm reported 0 vulnerabilities
- Preliminary source secret scan: 0 matches

Important:
- KVM production source is the authoritative deployed-code baseline.
- Existing PC source is historical and must not overwrite production.
- API endpoint functionality, database contents, and end-to-end
  pipeline health still require runtime verification.
- No production service restart or deployment was performed.
- No GitHub commit or push has been performed yet.

Next milestone:
- Review Git staging and secret exclusions.
- Commit recovered production source to GitHub.
- Verify live API and data pipeline.
- Integrate XTO frontend with the verified API.
