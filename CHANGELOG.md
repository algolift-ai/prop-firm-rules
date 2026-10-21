# Changelog

Every release is dated. A rule or price change names the plan, the rule, the old and new value, and the firm's page that states it.

## 0.1.0 (2026-10-21)

The first release, built from AlgoLift's published prop rules registry, version 2 (2026-10-21).

- 51 plans from 6 firms: Topstep, Apex, My Funded Futures, Tradeify, TradeDay and Take Profit Trader.
- Every rule and price checked against the firm's own pages, each with its source and date.
- `schema.json`, the validator, and CI that fails on an unsourced, stale or hand-edited rule.
- The files are generated from a published version of AlgoLift's prop rules registry (every rule with its source page and check date), not from the simulator's catalogue and a separate citations file. `index.json` gains `registry` (`format`, `version`, `sha256`, `published_at`), the version the files came from; `engine/catalog.json` is the simulator's catalogue built from that version, so the hashes still check.
- Two rules join the schema, in every plan file: `account.trading_hours` (`{ start, end }`, HH:MM New York time, or null when the account may trade whenever the exchange is open; unit `time_window`) and `payouts.max_payout_pct_of_balance` (a payout's cap as a share of the balance, per payout, or null).
- Statuses follow the registry: a rule under review there (its page changed, or a new value waits) reads `differs` with the value AlgoLift simulates today; a rule the firm's pages do not state reads `not_stated`.
- `engine/catalog.json` carries the simulator's whole build of each plan (2026-10-16, the engine reads the registry): a preset's `limitations` (one sentence for each recorded rule the simulation does not apply, from the registry's taxonomy) and the settings for the rules the simulator models since then (a funded daily loss limit by profit tier, a payout split by profit slice, the floor locked by a payout request, the minimum payout request, a funded profit cap, contract growth in the funded phase only, a scaling level kept once reached). The rule files do not change.
