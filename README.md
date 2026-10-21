# Prop firm rules

The rules of futures prop firm accounts as open JSON: profit targets, drawdowns and how they trail, daily loss limits, consistency rules, minimum days, contract limits, payout rules and fees. Every rule links to the firm's own page it was checked against, and carries the date it was checked.

These are the rules [AlgoLift](https://www.algolift.ai) simulates when it tests a trading strategy against a prop account. AlgoLift publishes them so you can check what the simulation assumes, and use the same data yourself.

> Firms change their rules and prices often. Before you buy an evaluation, read the firm's own page: every rule here links to it.

## What is in it

```
rules/<firm>/<plan>.json   one file per plan: one account size of one program
index.json                 every plan, with its path and when it was verified, and the registry version it came from
schema.json                what every field means, its unit, and what a valid file looks like
engine/catalog.json        AlgoLift's simulator catalogue, built from the same registry version
scripts/validate.mjs       the validator CI runs (no dependencies)
```

A plan file, shortened:

```json
{
  "id": "topstep/50k",
  "firm": { "slug": "topstep", "name": "Topstep" },
  "plan": { "slug": "50k", "name": "50K Combine", "status": "active", "source_url": "https://..." },
  "rules_verified": "2026-10-16",
  "prices_verified": "2026-10-16",
  "rules": {
    "account":    { "size": { "value": 50000, "unit": "usd", "source_url": "https://...", "verified": "2026-10-16", "status": "verified" }, ... },
    "evaluation": { "profit_target": { ... }, "max_drawdown": { ... }, "drawdown_type": { ... }, ... },
    "funded":     { ... },
    "payouts":    { ... }
  },
  "prices": { "evaluation_fee": { ... }, "recurring_fee": { ... }, "reset_fee": { ... }, "activation_fee": { ... } },
  "simulation_notes": ["the optional Daily Loss Limit add-on is not included in this preset", "..."]
}
```

Every rule is an object with the same five fields:

| Field | Meaning |
|---|---|
| `value` | The rule. `null` means the plan has no such rule (no daily loss limit, for example). |
| `unit` | `usd`, `percent`, `trading_days`, `calendar_days`, `contracts` (E-minis), and a few more; `schema.json` lists them all. |
| `source_url` | The firm's own page the rule was checked against. |
| `verified` | The date it was checked, `YYYY-MM-DD`. |
| `status` | `verified`: the page states this value. `not_stated`: the firm's pages do not state it, so the value is AlgoLift's assumption; the validator refuses it unless `allow_not_stated` is set in `prop-rules.config.json`. `differs` or `unverified`: never in a release; the validator refuses them. |

Rules that change with the payout number (a payout cap that rises with each payout, for example) are a list: the first entry is for the first payout, and the last entry applies to every later one.

`schema.json` describes every rule in words. The field names are plain: `evaluation.profit_target`, `evaluation.drawdown_type` (`end_of_day`, `intraday` or `static`), `funded.contract_scaling`, `payouts.profit_split_pct`, `prices.reset_fee`.

## How to use it

Read a file straight from GitHub:

```js
const url = "https://raw.githubusercontent.com/algolift/prop-firm-rules/main/rules/topstep/50k.json";
const plan = await fetch(url).then((r) => r.json());
console.log(plan.rules.evaluation.profit_target.value); // 3000
```

```python
import json, urllib.request
url = "https://raw.githubusercontent.com/algolift/prop-firm-rules/main/index.json"
index = json.load(urllib.request.urlopen(url))
for p in index["plans"]:
    print(p["firm"], p["plan"], p["rules_verified"])
```

Or clone the repository and read `rules/` directly. Each release is tagged, so you can pin a version.

## How each rule is sourced and dated

- **Where values come from.** AlgoLift keeps every firm's rules in one registry, each rule with the page that states it and the day it was checked. The files are generated from a published version of that registry (`index.json` names it: `registry.version` and its `sha256`), through the catalogue AlgoLift's simulator reads (`engine/catalog.json`, built from the same version), so this data and the simulation never disagree. Values are not edited by hand: each file carries a hash of its values and a hash of its catalogue entry, and the validator fails on either mismatch.
- **Where sources come from.** Each rule is checked against the firm's own pages: its rules pages, help center and checkout. The link is the page that states the rule. The firm's wording is not copied here; read it at the link.
- **Dates.** `verified` is the day a rule was last checked. Rules and prices are dated separately (`rules_verified`, `prices_verified`), because prices change more often.
- **Re-checks.** Each firm is due for a re-check every month. CI fails on any rule verified more than 45 days ago (`prop-rules.config.json`), and runs daily, so a stale rule is visible rather than silent.
- **When a firm changes a rule,** the change is recorded in the registry with its source, published as a new registry version, and the files are regenerated from it; it ships as a dated release in [CHANGELOG.md](CHANGELOG.md) with its source. A rule whose page now says something else reads `differs` until the new value is published.
- **What the simulation approximates.** Some rules are simplified in AlgoLift's simulation, and a few are left out. `simulation_notes` lists them for each plan, in plain words.
- **Discontinued plans** stay in the data while AlgoLift still simulates them, with `plan.status` set to `discontinued`.

## Reporting a correction

If a rule here does not match the firm's page, open an issue with the **Rule correction** form: the file, the rule, a link to the firm's page and what it says in your own words. Corrections are checked against the firm's page and released with the date. You can also write to support@algolift.ai.

Please do not open a pull request that edits a value in `rules/`: the files are generated, so a hand edit fails validation. The issue is the fastest way.

## Run the checks yourself

```
node --test                  # the validator's own tests
node scripts/validate.mjs    # the data: schema, sources, dates, freshness, the catalogue
```

Node 20 or later, no install step.

## AlgoLift

AlgoLift is a no-code platform for building and backtesting trading strategies. Its prop simulator runs a strategy's trades through these rules to estimate how often it would pass an evaluation and what it would cost: [Run your strategy against these rules](https://www.algolift.ai/data/prop-firm-rules).

## License

Copyright (c) 2026 AlgoLift LLC.

- The data (`rules/`, `index.json`, `engine/catalog.json`): [CC BY 4.0](LICENSE). Use it for anything, with credit: "Prop firm rules by AlgoLift (algolift.ai)".
- The schema, the validator and the tests: [MIT](LICENSE-CODE).

Firm names are used only to say which firm a rule belongs to. They belong to their owners, and this project is not affiliated with or endorsed by any firm. Nothing here is advice: it is a record of published rules, which can change at any time.
