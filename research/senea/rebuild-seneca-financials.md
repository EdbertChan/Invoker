# SENEA Financial Rebuild - Artifact Smoke Test

> **Note:** This file is a first-pass Invoker artifact-write/commit test for the
> `rebuild-seneca-financials` lane of the SENEA diligence plan. It is **not**
> final investment advice, and it is **not** a completed diligence model. The
> deterministic financial reconstruction is left to a later workflow that will
> attach primary-source filings and machine-readable metric outputs.

## Scope

This lane covers reconstructing 20+ years of Seneca Foods (`SENEA`) financials
from primary filings so that downstream claim-verification and bear-case tasks
can run against a deterministic dataset. The rebuild must reconcile both
reported (LIFO) and FIFO-adjusted views against management's non-GAAP
disclosures.

## Rebuild Checklist

A later deterministic workflow should produce, for each fiscal year going back
20+ years:

- [ ] **LIFO reserve** — pull from each 10-K inventory footnote; track changes
      year-over-year.
- [ ] **FIFO inventory** — reported inventory + LIFO reserve; reconcile with
      management's FIFO disclosure.
- [ ] **Adjusted equity** — book equity grossed up for the after-tax LIFO
      reserve.
- [ ] **Tangible book value** — adjusted equity less goodwill and other
      intangibles, on both reported and FIFO bases.
- [ ] **NCAV (Net Current Asset Value)** — current assets less total
      liabilities (and preferred claims), with a FIFO-adjusted variant.
- [ ] **Net debt** — total debt less cash and equivalents; track seasonality
      around peak inventory build.
- [ ] **FIFO EBITDA** — reconcile to management's non-GAAP FIFO EBITDA
      bridge; cross-check against operating cash flow.
- [ ] **Maintenance capex proxies** — D&A baseline, rolling capex / sales,
      and capex / revenue across cycles.
- [ ] **ROE / ROIC** — computed on both reported and FIFO-adjusted equity and
      invested capital.
- [ ] **Buybacks** — share repurchases, average price, and net share count
      change including any class-A vs class-B activity.
- [ ] **Per-share compounding** — long-run book value per share, tangible
      book per share, and FIFO-adjusted book per share CAGRs.

## Initial Source Anchors

Anchored from the source plan
(`/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`):

- Seneca's **FY2025 10-K** discloses a **LIFO reserve of $359.3 million**, plus
  FIFO-adjusted earnings and FIFO EBITDA bridges. This is the entry point for
  recomputing FIFO inventory and adjusted equity.
- **S&P Dow Jones Indices** documented the **July 2023 deletion of `SENEA`
  from the S&P SmallCap 600**. This anchors the index-flow / forced-selling
  attribution work that consumes this rebuild.
- Per Decision Gate 2 of the source plan, **Seneca valuation only passes if
  both reported and FIFO-adjusted calculations reconcile to filings**, so every
  metric must be tied back to a filing reference and a non-GAAP reconciliation
  where management provides one.

## Next Verification Steps

A later workflow should add deterministic scripts under `scripts/research/`
with concrete pass/fail commands. Initial proposals:

- `scripts/research/fetch_sec_filings.py SENEA --years 2003:2026 --out artifacts/sec/`
  — pull every 10-K, 10-Q, proxy, and 8-K into the source pack.
- `scripts/research/extract_lifo_reserve.py artifacts/sec --out artifacts/lifo_reserve.csv`
  — parse the inventory footnote across years and emit a per-year reserve
  series; gate on FY2025 ending value of $359.3m.
- `scripts/research/rebuild_senea_financials.py artifacts/sec --out artifacts/senea_metrics.csv`
  — produce the 20+ year LIFO and FIFO-adjusted income statement, balance
  sheet, and cash flow rollups.
- `scripts/research/reconcile_fifo_bridge.py artifacts/senea_metrics.csv --out artifacts/fifo_recon.json`
  — diff rebuilt FIFO earnings/EBITDA against management's disclosed bridge;
  fail if any year exceeds a configurable tolerance.
- `scripts/research/per_share_compounding.py artifacts/senea_metrics.csv --out artifacts/compounding.csv`
  — emit BVPS, tangible BVPS, and FIFO-adjusted BVPS CAGRs over rolling
  10-, 15-, and 20-year windows.
- `scripts/research/verify_claims.py artifacts/claims.json artifacts/senea_metrics.csv artifacts/sources.json`
  — re-run the claim ledger against the rebuilt metrics so downstream lanes
  inherit a deterministic evidence base.

Each script should exit non-zero on any reconciliation failure so that the
Invoker workflow can gate later lanes on a clean rebuild.
