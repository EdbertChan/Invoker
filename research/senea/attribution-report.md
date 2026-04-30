# SENEA Attribution Report

- **Task:** analyze-senea-attribution
- **Ticker:** SENEA (Seneca Foods Corporation, Class A common stock)
- **Plan reference:** `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- **Upstream artifacts:** `research/senea/claims-source-pack.{md,json}`, `research/senea/source-register.csv`, `research/senea/financial-rebuild.{md,json}`, `research/senea/industry-bear-case.{md,json}`
- **Fiscal year end anchored:** 2025-03-31
- **Reference date:** 2026-04-30
- **Artifact status:** draft
- **Companion artifacts:** `research/senea/attribution-report.json`, `research/senea/event-attribution.csv`

## Scope

This report decomposes the SENEA price discount into attributable causes by binding each known event window to (a) a testable claim from the upstream pack, (b) the evidence available, and (c) an attribution assessment with directional sign and magnitude status. Where event-window or factor-loaded magnitudes require market-data series that have not yet been retrieved, each event is graded `magnitudeStatus = evidence-pending` and the exact data inputs needed are enumerated. No synthetic returns, fabricated event-window excess returns, or inferred percentages are emitted in this pass.

## Attribution Verdict

**Overall verdict.** The SENEA discount is best modeled as a sum of seven attribution buckets:

| Bucket | Events | Directional Sign | Status |
|---|---|---|---|
| non-fundamental-supply-shock | E-001 | negative | evidence-pending |
| fundamental-repricing | E-002, E-003 | ambiguous (positive on buybacks) | evidence-pending |
| competitor-restructuring | E-004, E-005 | positive | evidence-pending |
| commodity-input-cost-pressure | E-006 | ambiguous | evidence-pending |
| liquidity-and-coverage | E-009, E-011 | negative-structural | evidence-pending |
| liquidity-and-factor | E-007, E-010 | negative in tightening windows | evidence-pending |
| governance-discount | E-008 | negative-structural | evidence-pending |

**Why magnitudes are not reported.** All eleven events carry `magnitudeStatus = evidence-pending` because the four market-data sources required to compute event-window excess returns and factor-loaded attributions have not been retrieved in this pass:

- `S-018` -- SENEA Class A daily OHLCV from a consolidated tape vendor.
- `S-019` -- Small-cap and value factor return series (Russell 2000 family, S&P SmallCap 600, Fama-French SMB / HML).
- `S-020` -- IJR / SLY rebalance disclosures around the July 2023 SmallCap 600 reconstitution.
- `S-021` -- FRED H15T10Y / DFF / DGS2 plus FTSE Russell return series for the liquidity-window definitions.

Per the task's acceptance criterion ("If market data is unavailable, explain the limitation and provide the exact data needed rather than inventing returns"), this report enumerates the missing inputs in each event's `dataNeededIfMissing` block in `attribution-report.json` rather than imputing returns.

**Verdict in plain language.** Of the seven buckets, only `competitor-restructuring` is structurally positive for SENEA; the index-deletion shock (E-001) is one-time and partially mean-reverting, while the four other negative buckets (`liquidity-and-coverage`, `liquidity-and-factor`, `governance-discount`, and `commodity-input-cost-pressure` if pass-through is incomplete) are persistent. The `fundamental-repricing` bucket is ambiguous: the FIFO earnings-power bridge anchored at the $359.3m LIFO reserve (`S-001`) is unambiguously positive, but the per-release reaction depends on whether the market has already capitalized that bridge -- which is exactly what `E-002` would test.

## Event Timeline

The eleven events span the analysis window. Dates that are pending precise primary-source confirmation are noted as such; the corresponding open question (`Q-` upstream, `F-` from financial-rebuild, `P-` from industry-bear-case) is recorded in `Residual Unknowns`.

| Event ID | Approximate Date | Event Type | Bucket | Sign |
|---|---|---|---|---|
| E-001 | July 2023 (effective date pending Q-003) | S&P SmallCap 600 deletion | non-fundamental-supply-shock | negative |
| E-002 | FY2023-Q4 -- FY2025-Q4 (release dates pending) | Seneca earnings releases | fundamental-repricing | ambiguous |
| E-003 | FY2023-FY2025 (announcement dates pending F-004) | Buyback authorization and execution | fundamental-repricing | positive |
| E-004 | May 2025 (effective date pending P-005) | Del Monte Pacific deconsolidation of U.S. Del Monte Foods | competitor-restructuring | positive |
| E-005 | 2025 (filing date pending Q-004) | Del Monte Foods (U.S.) Chapter 11 filing | competitor-restructuring | positive |
| E-006 | FY2018-FY2025 (per-FY MD&A windows pending P-006) | Commodity / input-cost pressure (tinplate, freight, labor, energy) | commodity-input-cost-pressure | ambiguous |
| E-007 | 2022-Q1 onset; 2023-03 SVB; 2025-Q1 macro window | Equity-market liquidity windows (QT / regional-bank stress) | liquidity-and-factor | negative in tightening windows |
| E-008 | FY2025 DEF 14A filing date (pending P-009 / Q-006) | Governance disclosure (dual-class voting power) | governance-discount | negative-structural |
| E-009 | Persistent across the analysis window | Sell-side coverage absence | liquidity-and-coverage | negative-structural |
| E-010 | 2022-2024 drawdown; 2025 partial mean-reversion | Small-cap / value factor context | liquidity-and-factor | negative-then-partial-recovery |
| E-011 | Continuous across the analysis window | Trading liquidity and float utilization | liquidity-and-coverage | negative-structural |

The full event records (with `eventDate`, `eventType`, `claimTested`, `evidence`, `sourceIds`, and `attributionAssessment`) are in `attribution-report.json`, and a flat row-per-event view is in `event-attribution.csv`.

## Index Deletion Evidence

**Event:** E-001 -- S&P SmallCap 600 deletion announced by S&P Dow Jones Indices in the July 2023 rebalance.

**Claim tested.** `C-007` from `claims-source-pack.json` -- "SENEA was deleted from the S&P SmallCap 600 in July 2023, producing forced selling pressure independent of fundamentals."

**Mechanism.** Removal from the S&P SmallCap 600 forces every index-replicating fund to reweight to zero on the effective date. The two largest direct replicators are:

- iShares Core S&P SmallCap ETF (IJR), BlackRock.
- SPDR S&P 600 Small Cap ETF (SLY), State Street Global Advisors.

These funds publish daily holdings files (`S-020`); the absolute share-volume of forced selling can be computed from the pre-/post-rebalance holdings deltas multiplied by the funds' share counts.

**Evidence available.**

- The deletion is anchored at the pointer level via the S&P DJI announcement archive (`S-002`) and is the binding source for upstream claim `C-007`.
- The deletion mechanism is well-understood and the sign of the event-window excess return for the deleted name is unambiguously negative.

**Evidence pending.**

- The exact effective date in July 2023 (upstream open question Q-003).
- SENEA Class A daily OHLCV across `[t-30, t+30]` (`S-018`).
- IJR and SLY pre-/post-rebalance holdings deltas (`S-020`).
- S&P SmallCap 600 daily total return for the same window for excess-return computation (`S-019`).

**Attribution assessment.** Bucket `non-fundamental-supply-shock`. Directional sign negative. Magnitude pending.

**Bear-case interaction.** This event is the binding source for the structural-liquidity component of E-011: the deletion-driven loss of index-fund ownership compressed SENEA's institutional ownership permanently, and the bear-case framing of this is captured under E-011 rather than E-001 to avoid double-counting.

## Fundamental Repricing Evidence

This bucket covers two events: earnings-release reactions (E-002) and buyback announcements / executions (E-003).

### E-002 -- Seneca quarterly and annual earnings releases (FY2023-FY2025)

**Claims tested.** `C-003` (FIFO earnings power understated by $359.3m LIFO reserve) and `C-011` (pricing-cost recovery across cycles).

**Evidence available.**

- The FY2025 LIFO reserve of $359.3m is anchored verbatim in the upstream pack (`S-001`) and forwarded into `financial-rebuild.json` as `fifo_inventory_adjustment_gross`.
- The FIFO earnings-power bridge is fully methodologically defined in `financial-rebuild.json` -> `valuationBridge.earningsPowerBridge`.

**Evidence pending.**

- Per-release reported pre-tax income, net earnings, operating income, D&A, and the prior-year LIFO reserve required to compute the FY2025 LIFO charge (open questions `F-001`, `F-003`).
- FY2025 effective tax rate (open question `F-002`) -- this governs the after-tax FIFO add-back magnitude.
- SENEA Class A same-day and 5-day reaction to each release (`S-018`).
- A peer or S&P SmallCap 600 ex-SENEA benchmark for excess returns (`S-019`).

**Attribution assessment.** Bucket `fundamental-repricing`. Directional sign ambiguous because the bridge to repricing depends on whether the market has already capitalized FIFO earnings power. Magnitude pending.

### E-003 -- Buyback authorization and execution

**Claim tested.** `C-008` -- "Seneca has executed material share repurchases relative to float, supporting per-share compounding."

**Evidence available.**

- Buyback authorization, executions, average price, and net-buyback-percent are explicitly defined as `reportedMetrics` in `financial-rebuild.json` (entries: `buyback_authorization`, `buyback_executed_fy2025`, `buyback_avg_price_fy2025`, `net_buyback_pct_beginning_shares`).
- Authorization announcements are 8-K-disclosable; `S-005` (FY2025 DEF 14A) and the FY2025 10-K (`S-001`) are the binding primary sources.

**Evidence pending.**

- Each 8-K or press release announcing a new or expanded authorization (`S-001`, `S-005`).
- Monthly repurchase tables from FY2023-FY2025 10-Ks Item 5.
- Same-day SENEA reaction (`S-018`).
- Beginning-of-fiscal-year diluted share counts to compute net-buyback-percent.

**Attribution assessment.** Bucket `fundamental-repricing`. Directional sign positive. Magnitude pending.

### E-006 -- Commodity and input-cost pressure (cross-listed under Fundamental Repricing for completeness)

The cost-side repricing channel is technically in the `commodity-input-cost-pressure` bucket but interacts with E-002 because gross-margin surprises are the proximate driver of earnings-release reactions. See the bear-case framing in `industry-bear-case.json` `B-005` (tinplate / steel cost inflation outruns price recovery) and the bull framing in `IC-008` (rational pricing, cost pass-through). Resolution requires industry primary check `P-006` (FY2018-FY2025 revenue and gross-margin bridge against tinplate / freight indices via `S-017`) and `S-018` for the corresponding price reactions.

## Liquidity And Coverage Evidence

This bucket covers two structural events (E-009 coverage absence, E-011 trading liquidity / float) and is materially overlapped by the cyclical liquidity-and-factor bucket (E-007 macro liquidity windows, E-010 small-cap-value factor context).

### E-009 -- Sell-side coverage absence

**Claim tested.** `C-009` -- "Seneca has minimal sell-side analyst coverage, contributing to the discount."

**Evidence available.**

- Anchored via `S-006` (Seneca IR coverage page and consensus-estimate vendor records).
- Aligns with the academic neglected-stock premium documented across small-cap and micro-cap value research.

**Evidence pending.**

- Active-coverage analyst count per year from Seneca IR and a consensus-estimate vendor.
- SENEA Class A bid-ask spread and turnover by year (`S-018`).
- A peer panel of similarly sized packaged-food names with at least three covering analysts to size the relative discount.

### E-011 -- Trading liquidity and float utilization

**Claim tested.** Bear-case `B-007` (governance) and `C-009` (coverage) jointly imply structurally low liquidity. This event captures the liquidity attribution that is *not* the index-deletion shock (E-001) and is *not* the macro liquidity windows (E-007).

**Evidence available.**

- FY2025 DEF 14A insider beneficial ownership (`S-005`) defines the free-float ceiling.
- Index deletion (`E-001`) further compressed institutional ownership; pre-/post-deletion 13F aggregates are required to separate the two.

**Evidence pending.**

- SENEA Class A average daily turnover, bid-ask spread, and Amihud illiquidity by year (`S-018`).
- Pre- and post-July-2023 institutional ownership counts and percent-of-float from 13F aggregates (SEC EDGAR).
- Free-float estimate net of insider holdings (`S-005`).

### E-007 -- Equity-market liquidity windows (cyclical, cross-listed)

**Windows.** 2022-Q1 QT onset; March 2023 SVB / regional-bank stress; 2025-Q1 macro window. All three are documented Russell 2000 drawdown windows in `S-021`.

**Evidence pending.** FRED H15T10Y, DFF, DGS2 daily series (`S-021`); Russell 2000 / Russell 2000 Value / Fama-French SMB and HML daily returns (`S-019`); SENEA Class A daily OHLCV (`S-018`).

### E-010 -- Small-cap / value factor context (cyclical, cross-listed)

The 2022-2024 small-cap and small-cap-value factor drawdown overlapped with E-007. The verdict combines `E-007` and `E-010` into a single `liquidity-and-factor` bucket; any final variance decomposition must use a *joint* regression specification rather than additive single-factor regressions, otherwise the factor and liquidity-window contributions will be double-counted (residual risk `R-010`).

**Attribution assessment for the bucket.** Negative-structural for `E-009` and `E-011`. Negative-during-tightening-windows for `E-007` and `E-010`. All four magnitudes pending the market-data series `S-018`, `S-019`, `S-021`.

## Governance Discount Evidence

**Event.** E-008 -- FY2025 DEF 14A disclosing combined Class A / Class B voting power held by founding-family and insider holders.

**Claims tested.** `C-010` (dual-class structure with concentrated insider/family voting control) and bear-case `B-007` (dual-class structure prevents activist crystallization).

**Evidence available.**

- `industry-bear-case.json` grades `B-007` `partially-verified`, awaiting confirmation of combined voting power via primary check `P-009` (`S-005`).
- Plan Quick Source Anchors identify the FY2025 DEF 14A as the binding disclosure for the dual-class structure.
- Governance disclosures rarely produce a same-day price reaction; the discount mechanism is structural rather than event-driven.

**Evidence pending.**

- FY2025 DEF 14A combined Class A + Class B voting share held by founding-family / insider holders (`S-005`); upstream open question `Q-006`.
- Voting-rights ratio between Class A and Class B per the FY2025 DEF 14A.
- A comparable-multiple panel of single-class packaged-food peers across FY2018-FY2025 to size the dual-class discount (`S-018`).
- Any 13D / 13G activist filings against SENEA across 2015-2026 that may have bracketed governance-event windows (SEC EDGAR).

**Attribution assessment.** Bucket `governance-discount`. Directional sign negative-structural. Magnitude pending. The dual-class discount is a documented cross-sectional finding in the academic literature; it shows up as a multiple discount versus single-class peers rather than as an event-window excess return.

## Source Attribution

Sources used in this attribution pass, by `sourceId` (see `research/senea/source-register.csv` and the `newSourcesIntroduced` blocks in upstream JSON for full registry).

- `S-001` -- Seneca Foods FY2025 10-K (LIFO reserve $359.3m anchor, MD&A, Item 5, Item 1A). Used for E-002, E-003, E-006.
- `S-002` -- S&P Dow Jones Indices announcement of the July 2023 SmallCap 600 deletion. Used for E-001.
- `S-003` -- Del Monte Pacific FY2025 annual report (discontinued operations / deconsolidation). Used for E-004.
- `S-005` -- Seneca FY2025 DEF 14A (dual-class voting and beneficial-ownership disclosures). Used for E-003, E-008, E-011.
- `S-006` -- Seneca IR coverage page and consensus-estimate vendor records. Used for E-009.
- `S-007` -- Seneca historical 10-K and 10-Q filings (FY2005-FY2025). Used for E-002, E-006.
- `S-008` -- Del Monte Foods (U.S.) Chapter 11 PACER docket. Used for E-005.
- `S-009` -- SENEA Class A closing price on or near 2026-04-30. Registered upstream; not the binding source for any event in this pass.
- `S-014` -- Trade press coverage of the Del Monte Foods Chapter 11 and Del Monte Pacific deconsolidation. Used for E-004, E-005.
- `S-016` -- Circana / IRI / NielsenIQ canned-vegetable category aggregates. Registered upstream; relevant context for E-006 / industry framing.
- `S-017` -- Tinplate / steel price index series and FRED canned-vegetable production index. Used for E-006.
- `S-018` (newly introduced this pass) -- SENEA Class A daily OHLCV from a consolidated tape vendor. Used by every event in this pass for magnitude computation.
- `S-019` (newly introduced this pass) -- Small-cap and value factor return series (Russell 2000 family, S&P SmallCap 600, Fama-French SMB / HML). Used for E-007, E-010, E-011.
- `S-020` (newly introduced this pass) -- IJR / SLY rebalance and holdings disclosures. Used for E-001.
- `S-021` (newly introduced this pass) -- FRED H15T10Y / DFF / DGS2 plus FTSE Russell return series for liquidity-window definitions. Used for E-007, E-010.

The full structured registry, including publisher, citation, and confidence, is in `attribution-report.json` -> `newSourcesIntroduced` (this pass) and `research/senea/source-register.csv` (upstream).

## Residual Unknowns

The following residual risks block one or more event-attribution magnitudes. Each carries a pointer back to the upstream open-question identifier (`Q-`, `F-`, or `P-`) where applicable.

- **R-001 -- SmallCap 600 effective deletion date.** Carry-forward from upstream `Q-003`. Blocks `E-001`. Sources: `S-002`, `S-020`.
- **R-002 -- Per-release reported pre-tax income, net earnings, and FY2024 LIFO reserve for FY2025 LIFO-charge bridge.** Carry-forward from `F-001`, `F-003`. Blocks `E-002`, `E-006`. Sources: `S-001`, `S-007`.
- **R-003 -- FY2025 effective tax rate for after-tax FIFO add-back.** Carry-forward from `F-002`. Blocks `E-002`. Affects the binding strength of bear-case `B-010`. Sources: `S-001`, `S-010`.
- **R-004 -- Buyback authorization and execution dates plus monthly repurchase tables.** Carry-forward from `F-004`. Blocks `E-003`. Sources: `S-001`, `S-005`.
- **R-005 -- Del Monte Foods (U.S.) Chapter 11 filing entity (Del Monte Foods Inc. vs Del Monte Foods Holdings) and posture (reorganization vs Section 363 sale vs liquidation).** Carry-forward from `Q-004`. Determines bear-case `B-003` binding strength against `E-005`. Sources: `S-008`, `S-014`.
- **R-006 -- Quoted text from Del Monte Pacific FY2025 annual report discontinued-operations / deconsolidation paragraphs.** Carry-forward from industry primary check `P-005`. Blocks `E-004`. Source: `S-003`.
- **R-007 -- Combined Class A / Class B voting power held by founding-family / insider holders.** Carry-forward from `Q-006` and industry primary check `P-009`. Blocks `E-008`. Source: `S-005`.
- **R-008 -- FY2018-FY2025 revenue and gross-margin bridge versus tinplate / freight indices.** Carry-forward from industry primary check `P-006`. Blocks `E-006`. Sources: `S-001`, `S-007`, `S-017`.
- **R-009 -- SENEA Class A daily OHLCV (`S-018`).** Single largest dependency: every quantitative event-window or factor-regression magnitude depends on it. No event in this pass produces a numerical excess return without it. Blocks all eleven events.
- **R-010 -- Double-counting risk between E-007 (liquidity windows) and E-010 (factor context).** The verdict combines them into a single `liquidity-and-factor` bucket; any final variance decomposition must use a joint regression rather than additive single-factor regressions. Sources: `S-018`, `S-019`, `S-021`.
- **R-011 -- Attribution-leakage risk between E-001 (one-time index-deletion supply shock) and E-011 (structural liquidity / float).** Pre-/post-deletion 13F-aggregate ownership concentration is required to separate the one-time shock from the persistent liquidity discount it left behind. Sources: `S-018`, `S-020`.
