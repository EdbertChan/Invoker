# SENEA Master Diligence Report

- **Task:** `synthesize-all-senea-diligence`
- **Workflow:** `wf-1777536856952-16`
- **Ticker:** SENEA / SENEB (Seneca Foods Corporation, SEC CIK 0000088948)
- **Reference date:** 2026-04-30
- **Fiscal year anchored:** FY2025 (year ended 2025-03-31)
- **Artifact status:** draft (synthesis-of-syntheses)
- **Companion artifacts:** `research/senea/master-diligence-report.json`, `research/senea/master-source-attribution.csv`, `research/senea/master-claim-scorecard.csv`

**Upstream workflows synthesized (read non-destructively from feature branches via `git show`):**

| Workflow ID | Track | Branch | Artifacts consumed |
| --- | --- | --- | --- |
| `wf-1777535082804-3` | Thin real latest-financial rebuild | `plan/senea-latest-financial-rebuild` | `research/senea/latest-financial-rebuild.md`, `latest-financial-rebuild.json`, `latest-financial-rebuild.csv` |
| `wf-1777535774820-8` | Prior linear final report | `plan/senea-diligence-step-5-analogs-final-report` | `research/senea/final-investment-report.md`, `final-investment-report.json`, `analog-screen.csv` |
| `wf-1777536856952-14` (a.k.a. `wf-1777536608713-14`) | Parallel claim-test fan-in synthesis | `plan/senea-claim-test-final-synthesis` | `research/senea/parallel-claim-synthesis.md`, `parallel-claim-synthesis.json`, `parallel-claim-scorecard.csv`, `parallel-analog-screen.csv` |

> **Disclaimer.** This master report is research output, not investment advice, not a recommendation, and not a solicitation to buy or sell SENEA, SENEB, or any other security mentioned. It is a reproducible synthesis of three upstream diligence tracks. Where two upstream tracks disagree, both positions are preserved with their cited upstream artifact references; the master synthesis judgment is explicit and carries an explicit confidence level. Claims classified as `unresolved` or `partial` are not assertions of fact; they require the primary-source pulls enumerated in the Unresolved Diligence Items section before any decision-relevant use.

## Executive Verdict

**Master synthesis verdict: `unresolved-with-positive-mechanism-bias-and-closing-discount-risk`.**
**Master synthesis confidence: medium-low (in the verdict); high (in the assertion that the thesis is not yet ready for a final memo).**

The three upstream tracks converge on the structural shape of the SENEA opportunity but disagree on a single quantitatively important question — whether the deep-discount-to-FIFO-book frame is still active at the 2026-04-30 reference price. The latest-financial track (`wf-1777535082804-3`) anchors the FY2025 numerical inputs from the SEC company-facts API and the FY2025 10-K (`research/senea/latest-financial-rebuild.json`). The prior linear track (`wf-1777535774820-8`) leaves price-versus-book unresolved-with-positive-mechanism-bias and explicitly declines to assign a price target (`research/senea/final-investment-report.md`). The parallel claim-test track (`wf-1777536608713-14`) flags that aggregator market data places combined SENEA + SENEB market cap above both reported and FIFO-adjusted equity, raising the possibility that the deep-discount frame has materially closed (`research/senea/parallel-claim-synthesis.md`). All three tracks agree that nothing in the assembled evidence refutes the thesis and that primary-source retrieval is the gating step for a final memo.

| Dimension | Latest-financial track (`wf-...082804-3`) | Linear final-report track (`wf-...774820-8`) | Parallel claim-test track (`wf-...608713-14`) | Master synthesis |
| --- | --- | --- | --- | --- |
| FIFO earnings power exists at >$0 | Computed: $67.1m adjusted net earnings, $171.4m FIFO EBITDA, $34.474m FY2025 LIFO charge | `partially-verified` | `partially_supported` | **partial / supported on magnitude** |
| Trades below FIFO tangible book | Computed adjusted equity $902.8m after-tax vs. reported $633m equity; price not retrieved | `unresolved` | `unresolved` (with bear-case caveat that aggregator market caps are above $902.8m FIFO equity) | **unresolved with closing-discount risk** |
| Trades at/below FIFO NCAV | Computed FIFO-adjusted NCAV $477.0m after-tax vs. reported $207.2m; price not retrieved | `unresolved` | `unresolved` | **unresolved with closing-discount risk** |
| Private-label oligopoly (Seneca + Lakeside ≈90%) | Out of scope | `unresolved` | `unresolved` | **unresolved** |
| Del Monte competitor exit | Out of scope | `partially-verified` (pointer-anchored only) | `partially_supported-anchor-only` (terminal events anchored; conduct sequence has no source ID) | **partial — anchor only** |
| S&P SmallCap 600 deletion produced forced selling | Out of scope | `partially-verified` | `unresolved` (high confidence in unresolved verdict because data is simply not collected) | **unresolved on magnitude; deletion fact pointer-anchored** |
| Insider/family control via dual class | Out of scope | `partially-verified` | `unresolved` | **partial** |
| Material buyback support | Out of scope | `unresolved` | `partially_supported` (March 2021 modified Dutch auction at $51.62 retiring 1,449,339 Class A shares ≈17.07% of relevant float, corroborated by issuer press releases) | **partial — single event corroborated; full ledger pending** |
| 20-year per-share compounding | Out of scope | `unresolved` | `unresolved` | **unresolved** |

**Where the upstream tracks disagree, and how the master synthesis judges:**

1. **Closing-discount risk on C-001 / C-002.** The linear final-report (`wf-...774820-8`) treats price-versus-book as `unresolved` but ranks the mechanism bias positive because the FIFO add-back exists and the price snapshot has not been retrieved (`research/senea/final-investment-report.md` Executive Verdict; `research/senea/final-investment-report.json finalVerdict`). The parallel claim-test track (`wf-...608713-14`) flags in its bear-case section that aggregator market data — SENEA Class A ≈$134.71 with class market cap ≈$911.6m, SENEB Class B ≈$164.79 with class market cap ≈$931.8m, combined ≈$1.8–1.9b — is *above* both reported equity (≈$633m, anchored in `research/senea/latest-financial-rebuild.json`) and FIFO-adjusted equity (≈$902.8m after-tax, anchored in `research/senea/latest-financial-rebuild.json`). The parallel track explicitly notes the aggregator share counts conflict and cannot be treated as authoritative without primary share-count disclosure. **Master synthesis judgment: closing-discount risk is real and must be foregrounded; final classification stays `unresolved` (not `refuted`) until a primary share-count and price reconciliation is produced.** Confidence: medium. Both upstream sources are cited.
2. **C-008 / buybacks.** The linear final-report classifies C-008 as `unresolved`. The parallel claim-test track classifies C-008 as `partially_supported` because the March 2021 modified Dutch auction (1,449,339 Class A shares at $51.62, ≈$74.81m gross, ≈17.07% of relevant float) is corroborated by issuer press releases (`research/senea/parallel-claim-synthesis.json claimScorecard.C-008.note`). **Master synthesis judgment: `partial`. The single-event anchor is admissible under Decision Gate 1 of the parallel track for that one event; the full FY2005-FY2025 buyback ledger and the 10-K Item 5 monthly issuer-purchase table remain unretrieved.** Confidence: medium.
3. **C-006 / Del Monte.** The linear final-report classifies C-006 as `partial`. The parallel claim-test track classifies it as `partially_supported-anchor-only`, explicitly distinguishing the two terminal events (May 2025 deconsolidation, U.S. Chapter 11) — which are pointer-anchored to `S-003` and `S-008` — from the pre-2025 conduct sequence DMC-01 through DMC-06 (2014 ownership change, price aggression, Sager Creek, restructuring, plant closures, private-label retreat) which has *no source ID* in the source pack and is `unresolved` (`research/senea/parallel-claim-synthesis.json claimFamilies.delmonte-change`). **Master synthesis judgment: `partial — anchor only`. Both upstream positions are preserved; the parallel claim-test framing is the sharper one and is adopted as the master classification.**
4. **Price target.** All three tracks decline to produce a price target. The linear final-report explicitly bases this on the missing balance-sheet line items (`F-002`, `F-003`, `F-006`); the latest-financial track has now retrieved those line items, but neither it nor the parallel claim-test track produces a comparison price. **Master synthesis: no price target is produced in this artifact. The conditions for producing one are itemized in `Unresolved Diligence Items`.**

**Bottom line.** The SENEA opportunity is best framed today as a *mechanism-rich, evidence-partially-anchored* deep-value setup with material closing-discount risk. Two well-anchored anchors — the FY2025 LIFO reserve of $359.3m and the March 2021 Dutch tender — survive across all three tracks. Five other claim families remain `unresolved` or `partial` and depend on retrievable primary sources. Eight of ten bear-case items bind even under the strongest verified bull narrative. **This is research output, not investment advice.**

## What Was Tested

This master report consolidates eleven upstream ledger claims (`C-001` through `C-011`), eleven attribution events (`E-001` through `E-011`), ten industry claims (`IC-001` through `IC-010`), ten bear-case items (`B-001` through `B-010`), three latest-financial computations (FIFO equity, FIFO NCAV, FIFO earnings), and twelve analog candidates per upstream track.

| Pillar | Test surface | Tested by | Status |
| --- | --- | --- | --- |
| Valuation & accounting (LIFO reserve, FIFO equity, FIFO NCAV, FIFO earnings power) | C-001, C-002, C-003 | Latest-financial (`wf-...082804-3`); linear final-report (`wf-...774820-8`); parallel valuation family (`wf-...608713-14`) | Anchored numerical inputs from the latest-financial track; comparison-to-price unresolved across the linear and parallel tracks |
| 20-year per-share compounding | C-004 | Linear; parallel (in valuation family) | Unresolved across both tracks |
| Industry structure (oligopoly, private-label concentration, Del Monte) | C-005, C-006, IC-001 through IC-010 | Linear; parallel (industry-structure and del-monte-change families) | Unresolved on concentration; partial on Del Monte (anchor-only) |
| Del Monte Pacific deconsolidation and U.S. Chapter 11 | C-006 (event side) | Linear; parallel del-monte-change family | Pointer-anchored on terminal events (S-003, S-008); pre-2025 conduct sequence DMC-01..DMC-06 has no source ID and is unresolved |
| Index deletion and forced selling (July 2023 S&P SmallCap 600) | C-007, E-001 | Linear (attribution bucket); parallel index-selling family | Deletion fact pointer-anchored (S-002); event-window magnitude unresolved across both tracks because OHLCV/ETF holdings/factor returns are unretrieved |
| Governance, dual-class, voting concentration, sell-side coverage | C-009, C-010, IC implicit; E-008, E-009 | Linear (attribution bucket); parallel governance-buybacks family | Partial on dual-class structure; voting share unresolved; coverage absence pointer-anchored |
| Buybacks (authorization, executions, single events) | C-008, E-003 | Linear; parallel governance-buybacks family | Partial — March 2021 Dutch tender corroborated; full ledger and Item 5 monthly table unretrieved |
| Pricing-cost recovery (crop, steel/tinplate, freight, labor) | C-011, IC-008, B-005, B-006 | Linear (deferred); parallel did **not** include this family | Unresolved-deferred (linear); not-tested (parallel) |
| Bear-case stress test | B-001 through B-010 | Linear; parallel bear-case integration | High-conviction-qualitative; eight of ten bind under strongest bull narrative |
| Analog mechanism screen | 12 candidates per upstream track | Linear; parallel | Both screens are mechanism-priors; verification per ticker pending |

## Claim Scorecard

The scorecard preserves each upstream track's verdict for each ledger claim and adds a master synthesis judgment with confidence. **No claim that was recorded as `unresolved` or `partial` upstream is silently upgraded.** Where the linear and parallel tracks disagree, both upstream positions are shown with cited upstream artifact references, and the master synthesis judgment is explicit. Per-row evidence detail and source IDs are in `research/senea/master-claim-scorecard.csv`.

| Claim | Statement (abbreviated) | Linear track verdict (`wf-...774820-8`) | Parallel track verdict (`wf-...608713-14`) | Master synthesis judgment | Master confidence | Disagreement note |
| --- | --- | --- | --- | --- | --- | --- |
| C-001 | Below FIFO tangible book | `unresolved` (positive mechanism bias) | `unresolved` (with closing-discount risk flagged in bear case) | `unresolved-closing-discount-risk` | medium-low | Latest-financial track anchors FIFO-adjusted equity at $902.8m after-tax (`research/senea/latest-financial-rebuild.json`); aggregator market cap suggests trading above this. Parallel track surfaces the risk; linear track does not. Both positions preserved. |
| C-002 | At or below FIFO NCAV | `unresolved` | `unresolved` | `unresolved-closing-discount-risk` | medium-low | Latest-financial track anchors FIFO-adjusted NCAV at $477.0m after-tax. Same closing-discount risk applies. |
| C-003 | LIFO reserve / FIFO earnings power | `partial` | `partially_supported` | `partial` | medium | All three tracks anchor the $359.3m LIFO reserve. Latest-financial track now also anchors the FY2025 LIFO charge of $34.474m, adjusted net earnings of $67.1m, and FIFO EBITDA of $171.4m. C-003a (LIFO reserve magnitude) is `supported`. C-003b (FIFO earnings power across cycles) remains pending the multi-year bridge. |
| C-004 | 20-year book value per share compounding | `unresolved` | `unresolved` | `unresolved` | low | No disagreement. FY2005-FY2024 historical 10-Ks not retrieved. |
| C-005 | Seneca + Lakeside ≈90% private-label vegetable canning | `unresolved` | `unresolved` | `unresolved` | low | No disagreement. Lakeside primary material not retrieved. Q-001 (which competitor Lakeside names) and Q-IS-A (national vs. regional vs. category-narrow basis) are blocking. |
| C-006 | Del Monte Pacific deconsolidation + U.S. Chapter 11 | `partial` | `partially_supported-anchor-only` | `partial-anchor-only` | medium | Both tracks agree the two terminal events are pointer-anchored to S-003 and S-008. Parallel track sharpens by flagging that DMC-01 through DMC-06 conduct sequence has no source ID and is unresolved. Master adopts the parallel framing. |
| C-007 | July 2023 S&P SmallCap 600 deletion produced forced selling | `partial` | `unresolved` (high confidence in the unresolved verdict because data is not collected) | `partial-deletion-fact-magnitude-unresolved` | medium | Both tracks agree the deletion fact is pointer-anchored to S-002. Linear track grades it `partial` because the deletion is anchored even though magnitude is pending; parallel track grades it `unresolved` because no event-window magnitude can be computed without OHLCV / ETF holdings / factor returns. Master synthesis: deletion fact is `partial`; magnitude is `unresolved`. Both positions preserved. |
| C-008 | Material share repurchases relative to float | `unresolved` | `partially_supported` | `partial` | medium | Disagreement. Linear track classifies as `unresolved` because authorization data is pending. Parallel track classifies as `partially_supported` because the March 2021 modified Dutch auction (1,449,339 Class A shares at $51.62, ≈$74.81m, ≈17.07% of relevant float) is corroborated by issuer press releases (`research/senea/parallel-claim-synthesis.md` Executive Verdict; `research/senea/parallel-claim-synthesis.json claimScorecard.C-008.note`). Master synthesis adopts the parallel framing for the single corroborated event; full ledger remains pending. |
| C-009 | Minimal sell-side coverage | `partial` | `unresolved` | `partial-pointer-only` | low | Linear track grades as `partial` at the pointer level (S-006); parallel track grades as `unresolved` because S-006 has not been retrieved. Master synthesis: pointer-anchored at low confidence. |
| C-010 | Dual-class structure, family voting concentration | `partial` | `unresolved` | `partial-structure-only` | low | Both tracks agree the dual-class structure is anchored; both tracks agree the combined Class A + Class B family voting share is pending P-009 / Q-006. Linear track grades the structure point as `partial`; parallel track grades the family-voting sub-claim as `unresolved`. Master synthesis: `partial` on structure; voting concentration unresolved. |
| C-011 | Pricing-cost recovery across cycles | `unresolved` (deferred) | `not-tested` (excluded from this round) | `unresolved-deferred` | n/a | No disagreement on classification; parallel track explicitly preserves as `not-tested` rather than rolling into a synthesis judgment. |

**Scorecard summary.** Of eleven ledger claims:

- **0 are `verified`** in any upstream track.
- **1 is `partial-anchor-only`** (C-006, terminal events anchored; conduct sequence unresolved).
- **6 are `partial`** (C-003, C-007 deletion-fact, C-008, C-009 pointer-only, C-010 structure-only, plus the latest-financial numerical anchors that materially advance C-003).
- **3 are `unresolved` or `unresolved-closing-discount-risk`** (C-001, C-002, C-004, C-005).
- **1 is `unresolved-deferred` / `not-tested`** (C-011).

No claim has been refuted across any of the three upstream tracks. The closing-discount risk on C-001 and C-002 is the single largest synthesis-level finding that is *new* to this master report.

## Financial Rebuild

This section consolidates the latest-financial track (`wf-1777535082804-3`) — the only upstream track that retrieved primary numerical inputs — with the bridge methodology defined by the linear final-report track and the cross-checks recorded by the parallel claim-test track. All numerical anchors trace to `research/senea/latest-financial-rebuild.json`.

**Anchored FY2025 numerical inputs (from `research/senea/latest-financial-rebuild.json`, citing SEC company facts URL `https://data.sec.gov/api/xbrl/companyfacts/CIK0000088948.json` and the FY2025 10-K `https://www.sec.gov/Archives/edgar/data/88948/000143774925020197/senea20250331_10k.htm`).**

| Metric | Value (USD) | Source |
| --- | --- | --- |
| Reported current assets | $755,654,000 | S-001 (FY2025 10-K via SEC company facts) |
| Reported current liabilities | $214,558,000 | S-001 |
| Reported total liabilities | $548,406,000 | S-001 |
| Reported stockholders' equity | $633,023,000 | S-001 |
| Reported inventory | $603,955,000 | S-001 |
| Reported goodwill | $0 | S-001 |
| Reported intangibles | $0 | S-001 |
| Reported tangible book value | $633,023,000 | S-001 (equity − goodwill − intangibles) |
| Reported NCAV | $207,248,000 | S-001 (current assets − total liabilities) |
| Reported earnings before tax | $54,483,000 | S-001 |
| Reported EBITDA | $136,958,000 | S-001 |
| LIFO reserve (FY2025) | $359,300,000 | S-001 (FY2025 10-K LIFO note) |
| Deferred tax on LIFO reserve | $89,500,000 | S-001 |
| Statutory tax rate | 24.9% | S-001 / S-010 |
| LIFO charge (FY2025) | $34,474,000 | S-001 |
| FIFO inventory | $963,255,000 | Computed: $603.955m + $359.3m |
| Adjusted earnings before tax (FIFO basis) | $88,957,000 | Computed: $54.483m + $34.474m |
| Adjusted net earnings (FIFO basis) | $67,114,000 | Computed |
| FIFO EBITDA | $171,432,000 | Computed: $136.958m + $34.474m |

**Computed bridges (latest-financial track):**

| Bridge | FY2025 value (USD) | Note |
| --- | --- | --- |
| Adjusted equity (FIFO, pre-tax) | $992,323,000 | Reported equity + LIFO reserve gross |
| Adjusted equity (FIFO, after-tax) | $902,823,000 | Reported equity + LIFO reserve × (1 − 24.9%) |
| Adjusted tangible book (FIFO, pre-tax) | $992,323,000 | Same as equity (goodwill = intangibles = 0) |
| Adjusted tangible book (FIFO, after-tax) | $902,823,000 | Same as equity (goodwill = intangibles = 0) |
| FIFO NCAV (pre-tax) | $566,548,000 | Reported NCAV + LIFO reserve gross |
| FIFO NCAV (after-tax) | $477,048,000 | Reported NCAV + LIFO reserve × (1 − 24.9%) |

**Disagreement preservation: tax rate basis.** The linear final-report track (`wf-...774820-8`) sized the after-tax LIFO add-back at the 21% U.S. federal statutory floor (`fifoAddBackAfterTaxAtFederalFloor` = $283.847m, in `research/senea/final-investment-report.json valuationBridges.tangibleBookBridge`). The latest-financial track uses the 24.9% disclosed statutory rate (after-tax add-back of $359.3m × 0.751 = $269.8m); the parallel claim-test track uses 24.9% as well, citing the same FY2025 10-K. Master synthesis adopts the latest-financial track's 24.9% rate as the anchored statutory rate; the federal-floor figure is preserved as a bear-case sensitivity from the linear track (`B-010`).

**What the bridges say at the anchored rate (24.9%):**

- FIFO-adjusted equity (after-tax) ≈ $902.8m vs. reported equity $633.0m. Equity uplift ≈ $269.8m (≈42.6% of reported equity).
- FIFO-adjusted NCAV (after-tax) ≈ $477.0m vs. reported NCAV $207.2m. NCAV uplift ≈ $269.8m (≈130% of reported NCAV).
- FIFO EBITDA (FY2025) ≈ $171.4m vs. reported EBITDA $137.0m.
- FIFO adjusted net earnings (FY2025) ≈ $67.1m vs. reported earnings before tax $54.5m.

**What is still pending.** A SENEA Class A reference price snapshot at or near 2026-04-30 (`F-006`), Class A and Class B share counts reconciled to primary disclosure (`F-007`, `U-G2-2`), and a multi-year per-share compounding history (`F-005`, `U-G2-6`). Without these, `C-001` and `C-002` cannot be moved off `unresolved`. Aggregator data summarized by the parallel claim-test track suggests combined market cap ≈$1.8–1.9b, which is *above* the FIFO-adjusted after-tax equity figure of $902.8m — this is the closing-discount risk.

**FIFO earnings-power bridge (multi-year, deferred).** `fifo_pretax_income_t = reported_pretax_income_t + (lifo_reserve_t − lifo_reserve_{t−1})`. FY2025 anchored above; FY2018-FY2024 series remains pending and is the largest blocking item for `C-011` and the cross-cycle version of `C-003`.

## Industry Structure

This section synthesizes industry findings from the linear track's industry-bear-case analysis (`wf-...774820-8`) and the parallel track's industry-structure family (`wf-...608713-14`). The latest-financial track is silent on industry structure.

**Industry verdict: `mixed-bull-pointer-anchored-bear-binding`.** No major industry claim moves from `pending` to `passed` in any upstream track. The bull narrative — Seneca + Lakeside private-label concentration with Del Monte exiting — is directionally credible at the source-pointer level but is graded `unverified` or `partially-verified` until industry primary checks `P-001` through `P-009` close.

| Industry claim | Description | Linear track status | Parallel track status | Master synthesis | Blocking checks |
| --- | --- | --- | --- | --- | --- |
| IC-001 | Seneca + Lakeside ≈90% U.S. private-label canning | `unverified` | `unresolved` (Q-001 and Q-IS-A blocking) | `unresolved` | P-001, P-002 |
| IC-002 | Lakeside is the second scale private-label producer | `partially-verified` | `unresolved` (depends on which competitor Lakeside names) | `partial` | P-002 |
| IC-003 | Del Monte Foods (US) is significant branded participant | `partially-verified` | `unresolved` | `partial` | P-004, P-005 |
| IC-004 | Long tail of smaller producers (Hanover, Faribault, Furmano's, Truitt, Allens) | `unverified` | `unresolved` | `unresolved` | P-003 |
| IC-005 | Private-label dollar share is high in mass / club | `unverified` | `unresolved` | `unresolved` | P-002, P-008 |
| IC-006 | Del Monte Pacific deconsolidated U.S. business May 2025 | `partially-verified` | `supported_by_anchor` (DMC-07) | `partial-anchor-only` | P-004, P-005 |
| IC-007 | Del Monte Foods (US) Chapter 11 in 2025 | `partially-verified` | `supported_by_anchor` (DMC-08) | `partial-anchor-only` | P-004 |
| IC-008 | Pricing rational; cost moves passed through | `unverified` | `not-tested` (parallel did not run C-011 family) | `unresolved-deferred` | P-006 |
| IC-009 | Customer concentration in large grocers / mass / club | `unverified` | `unresolved` | `unresolved` | P-008 |
| IC-010 | Per-capita US canned-vegetable consumption in secular decline | `unverified` | `unresolved` | `unresolved` | P-007 |

**Disagreement note: IC-001 framing.** The linear track grades IC-001 as `unverified` and writes that the ≈90% figure is "self-reported" but "directionally credible." The parallel track explicitly flags Q-IS-A: the figure cannot be tied to a measurement basis (units vs. dollars, full vegetable canning vs. canned corn / green beans / peas, U.S. national vs. retailer-region) and cannot be tied to a time period without the full Lakeside primary text. The parallel framing is sharper and is adopted as the master synthesis basis.

**Bear case binds even under the strongest bull industry-structure narrative** (eight of ten bear items, expanded in the Bear Case section).

## Del Monte Evidence

Del Monte is a load-bearing element of the bull industry-structure narrative because the thesis treats Del Monte's U.S. exit as a market-structure improvement for SENEA. The linear track and the parallel track agree on the two terminal events but disagree on what is admissible for the pre-2025 conduct sequence.

**Terminal events (anchored across both tracks):**

| Event | Description | Source ID | Status |
| --- | --- | --- | --- |
| DMC-07 / IC-006 | Del Monte Pacific deconsolidated U.S. Del Monte Foods business effective May 2025 | S-003 (Del Monte Pacific FY2025 annual report) | Pointer-anchored across both tracks |
| DMC-08 / IC-007 | Del Monte Foods (U.S.) Chapter 11 filing in 2025 | S-008 (PACER bankruptcy docket; Del Monte Foods press release) | Pointer-anchored across both tracks |

**Pre-2025 conduct sequence (no source ID across either track):**

| Sub-claim | Description | Status |
| --- | --- | --- |
| DMC-01 | 2014 Del Monte Pacific acquisition / ownership change | `unresolved` — no source ID in pack |
| DMC-02 | Post-2014 Del Monte price aggression | `unresolved` — no source ID in pack |
| DMC-03 | Sager Creek integration / write-down history | `unresolved` — no source ID in pack |
| DMC-04 | Multi-year restructurings | `unresolved` — no source ID in pack |
| DMC-05 | Plant closures / asset sales | `unresolved` — no source ID in pack |
| DMC-06 | Private-label retreat | `unresolved` — pointer/inference only |

**Disagreement preservation.** The linear final-report track summarizes Del Monte as `partial` and treats it as a directional positive for the SENEA thesis (`research/senea/final-investment-report.md` Industry And Bear Case Summary, listing IC-006 / IC-007 as `partially-verified`). The parallel claim-test track sharpens this in two ways (`research/senea/parallel-claim-synthesis.md` Bear Case Integration item 3): (a) Chapter 11 is reorganization, not liquidation — operating capacity and customer contracts frequently survive a reorganization under new ownership; and (b) even if Del Monte exits private-label, Lakeside or another supplier may absorb the volume on aggressive terms. Bear-case item `B-003` (Del Monte may emerge leaner from Chapter 11) is binding regardless of how the bull narrative resolves.

**Master synthesis:**

- C-006 is `partial-anchor-only`. Two terminal events are pointer-anchored to S-003 and S-008. Pre-2025 conduct sequence DMC-01 through DMC-06 is `unresolved` and lacks a source ID.
- The bull "competitor exit" framing is admissible only after primary-source retrieval lands DMC-07/DMC-08 quotations from S-003 and S-008, plus a §363 sale order or disclosure-statement read on whether Chapter 11 results in capacity exit (plant closures, asset abandonment) or capacity transfer (going-concern sale, reorganized emergence).
- `Q-IS-D` (capacity exit vs. capacity transfer) and `Q-DMC-07` (which Del Monte entity filed) are the highest-leverage Del Monte-side unresolved items.

## Index And Attribution Evidence

This section consolidates the linear track's attribution analysis (`research/senea/final-investment-report.md` Attribution Summary; `research/senea/final-investment-report.json attributionSummary`) with the parallel track's index-deletion / forced-selling family analysis (`research/senea/parallel-claim-synthesis.md` Bear Case Integration item 4; `research/senea/parallel-claim-synthesis.json claimFamilies.index-selling`).

**Seven attribution buckets, eleven events, all magnitudes pending.** The SENEA discount decomposes into:

| Bucket | Events | Sign | Magnitude status | Master synthesis |
| --- | --- | --- | --- | --- |
| non-fundamental-supply-shock | E-001 (S&P SmallCap 600 deletion July 2023) | negative one-time | evidence-pending (S-018, S-020) | Pointer-anchored fact; magnitude unresolved |
| fundamental-repricing | E-002 (earnings releases), E-003 (buyback announcements) | ambiguous (positive on buybacks) | evidence-pending (S-001, S-005, S-018) | Single buyback event (March 2021 Dutch tender) corroborated by parallel track; full series unresolved |
| competitor-restructuring | E-004 (Del Monte Pacific deconsolidation), E-005 (Del Monte US Chapter 11) | positive | evidence-pending (S-003, S-008, S-014, S-018) | Terminal events anchored; magnitude unresolved |
| commodity-input-cost-pressure | E-006 (FY2018-FY2025 input-cost cycle) | ambiguous | evidence-pending (S-001, S-007, S-017, S-018) | Methodology-defined; multi-year bridge deferred |
| liquidity-and-coverage | E-009 (sell-side coverage absence), E-011 (turnover / spread / float) | negative-structural | evidence-pending (S-006, S-018) | Pointer-anchored; magnitude unresolved |
| liquidity-and-factor | E-007 (Fed QT / SVB liquidity windows), E-010 (small-cap / value factor) | negative-in-tightening-windows | evidence-pending (S-018, S-019, S-021) | Methodology-defined; joint Fama-French regression required |
| governance-discount | E-008 (FY2025 DEF 14A dual-class voting) | negative-structural | evidence-pending (S-005, S-018) | Pointer-anchored; magnitude unresolved |

**Master data dependency.** S-018 (SENEA Class A daily OHLCV from a consolidated tape vendor) blocks all eleven event-window magnitudes. Without S-018, no event produces a numerical excess return, and the bull "forced-selling-driven discount" narrative cannot be size-anchored.

**Bear-case attribution overlay (parallel track item 4).** Even if S-018 is retrieved, the parallel track flags four risks that the linear track did not foreground: (a) Russell 2000 reconstitution may overlap with the July 2023 S&P SmallCap 600 deletion window, splitting forced-selling volume between the two index families; (b) S&P deletions are pre-announced and arbitrageurs front-run, so cumulative abnormal returns at the effective date may be near zero even when the flow story is real; (c) mid-2023 small-cap value factor weakness can absorb part of the negative drift; (d) concurrent FY2024-cycle Seneca fundamentals may explain part of the cumulative weakness independent of index flows. **Master synthesis: the index-deletion-as-forced-selling story is plausible but binds only inside a joint Fama-French + Russell-membership control. C-007 stays `partial` on the deletion fact and `unresolved` on magnitude.**

**Residual risks (carry-forward of upstream `R-` items):** R-009 (S-018 master dependency), R-010 (joint factor regression to avoid double-counting between E-007 and E-010), R-011 (13F-aggregate ownership concentration pre-/post-July-2023 to separate E-001 from E-011).

## Governance And Buybacks

This section consolidates the linear track's dual-class / governance-discount analysis with the parallel track's governance-buybacks family (`research/senea/parallel-claim-synthesis.json claimFamilies.governance-buybacks`).

**Anchored across both tracks:**

- Dual-class share structure exists (Class A, Class B). Pointer-anchored to S-001 and S-005.
- March 2021 modified Dutch auction tender (corroborated by parallel track via issuer press releases): 1,449,339 Class A shares repurchased at $51.62, ≈$74.81m gross, ≈17.07% of relevant float. **This is the single most material disagreement-resolved item between the linear and parallel tracks.** The parallel track admits this single event under Decision Gate 1; the linear track does not (because it works at the 10-K Item 5 monthly issuer-purchase table level rather than the press-release level).

**Pending across both tracks (Decision Gate 1 unmet):**

- Combined Class A + Class B family / insider voting concentration (Q-006, P-009, OQ-G2). DEF 14A Security Ownership of Certain Beneficial Owners and Management table not retrieved.
- 10-K Item 5 monthly issuer-purchase table covering FY2025. Required to test SC-G8 (counter-cyclical buyback pattern: did SENEA repurchase at 52-week highs or at tangible-book / FIFO-book lows?).
- DEF 14A Item 13 (related-party transactions, family-owned suppliers, related leases). Required to distinguish "controlled but aligned" from "controlled with risk."
- IR coverage page snapshot and consensus-estimate vendor query (S-006). Required to anchor C-009 (sell-side coverage absence).
- Buyback authorization and execution dates (F-004, R-004). Required to attribute E-003 to specific announcement windows.

**Bear-case binding.** B-007 (dual-class blocks activist crystallization) binds even under the strongest verified bull narrative. The parallel track adds: if combined Class A + Class B family voting power is materially below a control threshold (e.g., < 35%), the dual-class control narrative weakens. This is a primary-source check against the FY2025 DEF 14A.

**Master synthesis:**

- C-008 is `partial`. The March 2021 Dutch tender is admissible under the parallel track's Decision Gate 1 for that one event. Full ledger remains pending.
- C-009 is `partial-pointer-only`. IR coverage page (S-006) is pointer-anchored but not retrieved.
- C-010 is `partial-structure-only`. Dual-class structure is anchored; combined family voting share is unresolved pending P-009.

## Bear Case

Eight of ten bear-case items bind even under the strongest verified version of the bull narrative. The parallel claim-test track adds six bear-case sharpenings (research/senea/parallel-claim-synthesis.md Bear Case Integration items 1–6) that are not in the linear track.

**Bear items from the linear track (`research/senea/final-investment-report.json industrySummary.bindingBearItems`):**

| ID | Title | Source IDs | Binding? |
| --- | --- | --- | --- |
| B-001 | Secular per-capita decline | S-012, S-016 | Yes |
| B-002 | Customer concentration caps pricing power | S-001, S-015 | Yes |
| B-003 | Del Monte may emerge leaner from Chapter 11 | S-003, S-008, S-014 | Yes |
| B-004 | ≈90% private-label figure self-reported | S-004, S-012, S-016 | No (non-binding qualifier) |
| B-005 | Tinplate / steel cost inflation outruns price recovery | S-001, S-014, S-017 | Yes |
| B-006 | Climate / crop-yield variability | S-001 | Yes |
| B-007 | Dual-class blocks activist crystallization | S-005 | Yes |
| B-008 | Private-label margins structurally below branded | S-014, S-015 | Yes |
| B-009 | Substitution to fresh / frozen | S-012, S-016 | No (non-binding qualifier) |
| B-010 | After-tax LIFO add-back is smaller than gross | S-001, S-010 | Yes |

**Bear-case sharpenings from the parallel track:**

1. **Closing-discount frame (parallel item 1).** Aggregator market caps suggest combined SENEA + SENEB ≈$1.8–1.9b, *above* both reported book ($633m) and FIFO-adjusted equity ($902.8m). If those aggregator figures hold up against primary share counts, the deep-discount frame has materially closed and the residual case is FIFO-adjusted earnings power and ongoing buybacks rather than NCAV. **This is the single most important new bear-case finding in the master synthesis.**
2. **Concentration figure provenance (parallel item 2).** The Lakeside ≈90% statement is a self-interested marketing claim. Without third-party industry data and without the full Lakeside primary text in context (Q-IS-A), the figure cannot be tied to a measurement basis or time period. Lakeside's quoted "one other competitor" may not be Seneca; Q-001 explicitly flags this ambiguity.
3. **Del Monte capacity (parallel item 3).** Chapter 11 is reorganization, not liquidation. Q-IS-D (capacity exit vs. transfer) and Q-DMC-07 (which Del Monte entity filed) are unresolved.
4. **Index-deletion attribution (parallel item 4).** Russell 2000 reconstitution overlap, S&P pre-announcement front-running, small-cap value factor weakness, and concurrent FY2024-cycle fundamentals may each absorb part of the negative drift.
5. **Buyback story counter-cyclicality (parallel item 5).** A single 2021 tender does not substantiate a 20-year per-share compounding claim. If 10-K Item 5 monthly issuer-purchase tables show repurchases concentrated near 52-week highs rather than near tangible-book / FIFO-book lows, SC-G8 fails. Working-capital release that reduces inventory dollars without liquidating a LIFO layer in tax terms does not necessarily trigger the $89.5m LIFO recapture.
6. **Governance dual-class risk (parallel item 6).** DEF 14A Item 13 (related-party transactions) is unread. Without that read, "controlled but aligned" cannot be distinguished from "controlled with risk." If founding-family combined voting power is materially below a control threshold, the dual-class control narrative weakens.

**Master synthesis bear-case classification.** The bear case is `high-conviction-qualitative`. Eight of ten linear-track bear items bind under the strongest bull narrative; the six parallel-track sharpenings narrow further the conditions under which the bull thesis can be admitted to a memo.

## Analog Stock Screen

Two upstream tracks produced analog screens. They overlap on five tickers (TR, JBSS, BRID, FRD, ZEUS) and diverge on the remaining seven each. Both screens are explicitly priors / triage tools — every candidate carries `verificationStatus = unresolved-needs-primary-source-verification` and requires primary-source pulls per ticker before being treated as a comparable.

**Linear track screen (`research/senea/analog-screen.csv`, 12 candidates):** HNFSA (Hanover Foods), IMKTA (Ingles Markets), DDS (Dillard's), WMK (Weis Markets), JBSS, LAS.A (Lassonde Industries), BRID, TR, CALM (Cal-Maine Foods), MUEL (Paul Mueller), FRD, ZEUS.

**Parallel track screen (`research/senea/parallel-analog-screen.csv`, 12 candidates):** TR, JBSS, BRID, LWAY (Lifeway Foods), HOFT (Hooker Furnishings), ZEUS, FRD, IIIN (Insteel Industries), ETD (Ethan Allen), GEF / GEF.B (Greif), HBB / HBBA (Hamilton Beach), CRD.A / CRD.B (Crawford & Company).

**Disagreement note: CALM (Cal-Maine Foods).** The linear track includes CALM with mechanism-fit `M2: N` (no LIFO inventory cushion). The parallel track explicitly excludes CALM "because it lacks LIFO mechanism." Master synthesis adopts the parallel track's exclusion rationale and demotes CALM to a *non-LIFO governance-only mechanism reference* (similar to TR).

**Disagreement note: HOFT, ETD, GEF, IIIN, HBB, CRD.** The parallel track adds six tickers absent from the linear track. The parallel track's selection rationale is that the LIFO-mechanism side of the thesis benefits from a multi-name comparable cohort even where family control is absent (HOFT, ETD), and that dual-class controlled small-caps in non-food niches (GEF, HBB, CRD) capture the governance / asset / buyback features even where the niche is different. **Master synthesis includes the union of the two screens** — 19 distinct tickers — with the explicit caveat that none has been verified against primary sources.

**Master synthesis screen (union of both upstream screens):**

| Ticker | Company | Niche | Source track(s) | Mechanism-fit class | Verification status |
| --- | --- | --- | --- | --- | --- |
| HNFSA | Hanover Foods Corporation | Private-label canned vegetables / sauces | Linear | direct-industry-peer | `unresolved-needs-primary-source-verification` |
| IMKTA | Ingles Markets, Incorporated | Family-controlled grocer | Linear | lifo-family-control-asset-backed | `unresolved-needs-primary-source-verification` |
| DDS | Dillard's, Inc. | Family-controlled department store | Linear | lifo-family-control-asset-backed | `unresolved-needs-primary-source-verification` |
| WMK | Weis Markets, Inc. | Family-controlled grocer | Linear | lifo-family-control-asset-backed | `unresolved-needs-primary-source-verification` |
| JBSS | John B. Sanfilippo & Son, Inc. | Tree-nut packaged foods | Linear + parallel | direct-industry-peer | `unresolved-needs-primary-source-verification` |
| LAS.A | Lassonde Industries Inc. | Canadian private-label fruit-juice | Linear | direct-industry-peer | `unresolved-needs-primary-source-verification` |
| BRID | Bridgford Foods Corporation | Frozen / refrigerated foods | Linear + parallel | direct-industry-peer | `unresolved-needs-primary-source-verification` |
| TR | Tootsie Roll Industries, Inc. | Confectionery | Linear + parallel | direct-industry-peer-mechanism-reference | `unresolved-needs-primary-source-verification` |
| CALM | Cal-Maine Foods, Inc. | Egg producer | Linear (parallel excludes) | non-LIFO governance-only mechanism reference | `unresolved-needs-primary-source-verification` |
| MUEL | Paul Mueller Company | Stainless-steel processing equipment | Linear | lifo-family-control-asset-backed | `unresolved-needs-primary-source-verification` |
| FRD | Friedman Industries, Incorporated | Steel-coil processor | Linear + parallel | lifo-small-cap-asset-backed | `unresolved-needs-primary-source-verification` |
| ZEUS | Olympic Steel, Inc. | Steel service center | Linear + parallel | lifo-small-cap-asset-backed | `unresolved-needs-primary-source-verification` |
| LWAY | Lifeway Foods | Cultured dairy / kefir | Parallel | family-controlled-small-cap-food | `unresolved-needs-primary-source-verification` |
| HOFT | Hooker Furnishings | Furniture (LIFO) | Parallel | lifo-mechanism-no-family-control | `unresolved-needs-primary-source-verification` |
| IIIN | Insteel Industries | Steel wire products | Parallel | durable-niche-buyback-no-family-control | `unresolved-needs-primary-source-verification` |
| ETD | Ethan Allen Interiors | Furniture | Parallel | lifo-vertically-integrated | `unresolved-needs-primary-source-verification` |
| GEF / GEF.B | Greif, Inc. | Industrial packaging | Parallel | dual-class-industrial-packaging | `unresolved-needs-primary-source-verification` |
| HBB / HBBA | Hamilton Beach Brands Holding | Small-appliance distribution | Parallel | dual-class-controlled-small-cap | `unresolved-needs-primary-source-verification` |
| CRD.A / CRD.B | Crawford & Company | Insurance claims management | Parallel | dual-class-controlled-non-industrial | `unresolved-needs-primary-source-verification` |

**How to read this screen.** Each candidate maps onto a subset of SENEA's discount mechanism (asset-backed, accounting-hidden, undercovered small-cap, possible forced-selling exposure, insider/family control, buyback support, boring durable niche). Inclusion is *not* an endorsement. The natural next step is a per-ticker primary-source pull mirroring the SENEA workflow: 10-K balance sheet for asset-backed and accounting-hidden, proxy for family control, IR coverage page for undercovered, ETF / index membership for forced-selling exposure, Item 5 buyback table for buyback support, Item 1 'Business' for durable niche. Until those pulls happen, every candidate is `unresolved-needs-primary-source-verification` (master unresolved item `U-001`).

## Source Attribution

This section preserves explicit source IDs across all three upstream tracks. The master synthesis uses source IDs `S-001` through `S-021` from the consolidated source register, plus the upstream artifacts themselves as references. Per-row attribution is in `research/senea/master-source-attribution.csv`.

**Primary filings:**

- **S-001** — Seneca Foods FY2025 10-K (`https://www.sec.gov/Archives/edgar/data/88948/000143774925020197/senea20250331_10k.htm`). Anchors LIFO reserve ($359.3m), LIFO charge ($34.474m), reported balance-sheet aggregates ($633.0m equity, $755.7m current assets, $548.4m total liabilities, $604.0m inventory, $0 goodwill, $0 intangibles), reported earnings before tax ($54.5m), reported EBITDA ($137.0m). Also pointer-anchors Item 1 (business description), Item 1A (risk factors), Item 5 (issuer purchases), Income Taxes note, Class A / Class B share counts. Used by all three upstream tracks. Retrieval status: numerically retrieved by latest-financial track (`wf-...082804-3`) via SEC company facts API (`https://data.sec.gov/api/xbrl/companyfacts/CIK0000088948.json`); textual retrieval (Item 5 monthly issuer-purchase table, full Item 1, Item 1A) still pending.
- **S-003** — Del Monte Pacific Limited FY2025 annual report. Anchors deconsolidation effective May 2025 (DMC-07 / IC-006). Retrieval status: not retrieved.
- **S-005** — Seneca Foods FY2025 DEF 14A. Anchors dual-class structure pointer; Security Ownership of Certain Beneficial Owners and Management table is the primary source for combined family voting concentration. Retrieval status: not retrieved.
- **S-007** — Seneca Foods historical 10-K and 10-Q filings (FY2005-FY2025). Anchors per-share compounding bridge, year-by-year buyback ledger, multi-year LIFO charge series. Retrieval status: not retrieved.
- **S-011** — Seneca Foods cover-page share counts (FY2025 10-K, most recent 10-Q). Anchors Class A and Class B share counts for per-share calculations. Retrieval status: not retrieved.
- **S-015** — Retailer 10-K / 20-F private-label disclosures. Anchors customer concentration (B-002, IC-009). Retrieval status: not retrieved.

**Index / corporate action:**

- **S-002** — S&P Dow Jones Indices announcement of July 2023 SENEA deletion. Anchors deletion fact (C-007, E-001). Retrieval status: not retrieved.
- **S-008** — Del Monte Foods (U.S.) Chapter 11 bankruptcy filing and supporting docket records (PACER). Anchors Chapter 11 filing event (DMC-08 / IC-007). Retrieval status: not retrieved.
- **S-020** — IJR / SLY / VIOO rebalance disclosures. Anchors index ETF rebalance flows in the deletion event window. Retrieval status: not retrieved.

**Industry / market data:**

- **S-004** — Lakeside Foods ≈90% private-label statement. Anchors IC-001 / C-005 at the source-pointer level. Retrieval status: not retrieved.
- **S-012** — USDA ERS + Census ASM canned-vegetable trend data. Anchors B-001 (secular per-capita decline). Retrieval status: not retrieved.
- **S-013** — Trade press on smaller producers (Hanover, Faribault, Furmano's, Truitt, Allens / Sager Creek). Retrieval status: not retrieved.
- **S-014** — Del Monte trade-press wire copy. Retrieval status: not retrieved.
- **S-016** — Circana / NielsenIQ syndicated panel data. Retrieval status: not retrieved.
- **S-017** — CRU Tinplate / S&P Platts / FRED canned-vegetable production index. Anchors B-005 (tinplate cost compression). Retrieval status: not retrieved.

**Market data series:**

- **S-009** — SENEA Class A reference price snapshot. Required to compute price-versus-FIFO-book and price-versus-FIFO-NCAV. Retrieval status: not retrieved.
- **S-018** — SENEA Class A daily OHLCV from a consolidated tape vendor. Master event-window dependency for E-001 through E-011. Retrieval status: not retrieved.
- **S-019** — Russell 2000 / Fama-French factor returns. Retrieval status: not retrieved.
- **S-021** — FRED rates / liquidity windows. Retrieval status: not retrieved.

**Corporate / coverage:**

- **S-006** — Seneca IR coverage page and consensus-estimate vendor records. Anchors C-009 at the source-pointer level. Retrieval status: not retrieved.
- **S-010** — U.S. federal statutory rate / SENEA effective rate cross-reference. Anchors after-tax LIFO add-back computation. Retrieval status: not retrieved (numerical anchor in latest-financial track via SEC company facts is 24.9% statutory rate from S-001).

**Tertiary references** (admitted only as supporting context, never as primary citations; carried over from the parallel claim-test track): StockTitan SENEA financials page (`https://www.stocktitan.net/financials/SENEA/`), StockTitan SENEB overview (`https://www.stocktitan.net/overview/SENEB/`), GuruFocus Seneca Foods Book Value per Share page (`https://www.gurufocus.com/term/Book+Value+Per+Share/SENEB/Book-Value-per-Share/Seneca-Foods`), Investing.com SENEA quote page (`https://www.investing.com/equities/seneca-foods-corp-(a)`), CompaniesMarketCap Seneca Foods shares outstanding (`https://companiesmarketcap.com/seneca-foods/shares-outstanding/`), Overlooked Alpha Seneca write-up (`https://www.overlookedalpha.com/p/seneca-foods-stock`), Seneca Foods press releases on the March 2021 modified Dutch auction tender plus GlobeNewswire / MarketScreener mirrors.

**Upstream artifact references (used by reference, not by inheritance):**

- `research/senea/latest-financial-rebuild.md`, `latest-financial-rebuild.json`, `latest-financial-rebuild.csv` (track `wf-1777535082804-3`, branch `plan/senea-latest-financial-rebuild`).
- `research/senea/final-investment-report.md`, `final-investment-report.json`, `analog-screen.csv` (track `wf-1777535774820-8`, branch `plan/senea-diligence-step-5-analogs-final-report`).
- `research/senea/parallel-claim-synthesis.md`, `parallel-claim-synthesis.json`, `parallel-claim-scorecard.csv`, `parallel-analog-screen.csv` (track `wf-1777536608713-14`, branch `plan/senea-claim-test-final-synthesis`).
- `research/senea/claims-source-pack.md`, `claims-source-pack.json`, `source-register.csv` (foundation source pack on master).

**Coverage assertion.** Every conclusion above is anchored to one or more source IDs, upstream artifact references, primary-filing URLs, or PACER docket pointers. Conclusions tagged `unresolved`, `partial`, `partial-anchor-only`, or `unresolved-closing-discount-risk` are not assertions of fact.

## Unresolved Diligence Items

This section preserves the union of unresolved items across all three upstream tracks, organized by upstream artifact. Items inherited from the linear track carry their original `Q-`, `F-`, `P-`, `R-`, or `U-` IDs; items inherited from the parallel track carry their original `U-G1-`, `U-G2-`, `U-G3-`, `U-G4-`, or `U-X-` IDs. Items new to this master report are prefixed `M-`.

### From `claims-source-pack.json` (upstream `Q-` items, both tracks)

- **Q-001** — Identify the specific competitor named alongside Lakeside in the ≈90% private-label statement (S-004). Blocks: C-005, IC-001, IC-002, B-004.
- **Q-002** — Determine whether the FY2025 10-K discloses a maintenance-capex figure or proxy (S-001). Blocks: C-003, C-011, IC-008.
- **Q-003** — Confirm the precise effective date of the July 2023 S&P SmallCap 600 deletion and identify rebalancing index ETFs (S-002, S-020). Blocks: C-007, E-001.
- **Q-004** — Confirm the filing entity (Del Monte Foods Inc. vs. Del Monte Foods Holdings) for the 2025 Chapter 11 case and posture (S-008, S-014). Blocks: C-006, IC-007, B-003, E-005.
- **Q-005** — Determine whether management's FIFO-adjusted earnings / EBITDA are reconciled in the FY2025 10-K itself or only in supplemental investor materials (S-001). Blocks: C-003.
- **Q-006** — Quantify combined Class A + Class B voting power held by the founding family / insiders per the FY2025 DEF 14A (S-005). Blocks: C-010, B-007, E-008.

### From `financial-rebuild.json` (linear track) and the latest-financial track (`F-` items)

- **F-001** — Retrieve the FY2024 LIFO reserve to compute the FY2025 LIFO charge (S-001). Status: **anchored** by latest-financial track (FY2025 LIFO charge = $34.474m).
- **F-002** — Retrieve the FY2025 effective tax rate from the Income Taxes note (S-001, S-010). Status: **anchored** by latest-financial track (24.9% statutory).
- **F-003** — Retrieve the FY2025 consolidated balance sheet (S-001). Status: **anchored** by latest-financial track via SEC company facts API.
- **F-004** — Retrieve FY2025 Item 5 monthly repurchase table and FY2025 DEF 14A buyback authorization disclosures (S-001, S-005). Blocks: C-008, E-003. Partially anchored by parallel track via the March 2021 Dutch tender press release.
- **F-005** — Retrieve FY2005-FY2024 10-K filings for the 20-year per-share compounding rebuild (S-007). Blocks: C-004.
- **F-006** — Capture an archived SENEA Class A closing price at or near 2026-04-30 (S-009). Blocks: C-001, C-002.
- **F-007** — Confirm cover-page share counts on the FY2025 10-K and most recent 10-Q (S-011). Blocks: C-001, C-002, C-003, C-004, C-008.
- **F-008** — Confirm whether maintenance-capex disclosure exists or must be PP&E-roll-forward-derived (S-001). Blocks: C-003, C-011.

### From `industry-bear-case.json` (linear track, `P-` items)

- **P-001** — Quote Item 1 of Seneca FY2025 10-K on competitive position (S-001). Blocks: IC-001.
- **P-002** — Archive Lakeside ≈90% statement verbatim with date and venue; triangulate against S-016 and S-012 (S-004, S-012, S-016). Blocks: IC-001, IC-002, IC-005, Q-001.
- **P-003** — Catalog Hanover, Faribault, Furmano's, Truitt, Allens / Sager Creek (S-013, S-014). Blocks: IC-004.
- **P-004** — Pull the Del Monte US Chapter 11 PACER docket (S-008, S-014). Blocks: IC-006, IC-007, B-003, Q-004.
- **P-005** — Quote Del Monte Pacific FY2025 annual report deconsolidation paragraphs (S-003). Blocks: IC-006.
- **P-006** — FY2018-FY2025 revenue / gross-margin bridge vs. tinplate / freight indices (S-001, S-007, S-017). Blocks: IC-008, B-005, C-011.
- **P-007** — USDA ERS + Census ASM + Circana / NielsenIQ canned-vegetable trend (S-012, S-016). Blocks: IC-010, B-001, B-009.
- **P-008** — Quote FY2025 10-K Item 1 / Item 1A on customer concentration (S-001, S-015). Blocks: IC-009, IC-005, B-002.
- **P-009** — Confirm combined Class A / Class B voting power per FY2025 DEF 14A (S-005). Blocks: B-007, Q-006.

### From `attribution-report.json` (linear track, `R-` items)

- **R-001** through **R-011** — Carry-forward of Q- and F- items into the attribution context, plus the master S-018 dependency (R-009), the joint Fama-French regression requirement (R-010), and the 13F-aggregate ownership concentration check (R-011). See `research/senea/final-investment-report.json unresolvedDiligenceItems` for full text.

### From `parallel-claim-synthesis.json` (parallel track, `U-G*-` and `U-X-` items)

- **U-G1-1** — Retrieve the SENEA FY2025 10-K HTML / iXBRL into the repo (S-001). Resolves: QV-001, QV-002, QV-003, QV-007, QV-008, OQ-G1, OQ-G4 (partial), OQ-G6 (partial), OQ-G7, IS-1, IS-3, IS-4. Status: numerically anchored by latest-financial track but textual retrieval (Item 1, Item 1A, Item 5 monthly issuer-purchase table) still pending.
- **U-G1-2** — Retrieve the SENEA FY2025 DEF 14A and any 13D/13G filings (S-005). Resolves: OQ-G2, Q-006, OQ-G6, QV-008.
- **U-G1-3** — Retrieve the Del Monte Pacific Limited FY2025 annual report and SGX/PSE disclosure filings (S-003). Resolves: DMC-07, DMC-06 (partial), Q-DMC-04, Q-DMC-08.
- **U-G1-4** — Retrieve the U.S. Del Monte Foods Chapter 11 docket from PACER and the corresponding press release (S-008). Resolves: DMC-08, Q-004, Q-DMC-07, Q-IS-D, Q-DMC-08.
- **U-G1-5** — Retrieve the Lakeside Foods primary material in full (S-004). Resolves: Q-001, Q-IS-A, Q-IS-C.
- **U-G1-6** — Snapshot the Seneca IR site (S-006) and run a consensus-estimate vendor query. Resolves: OQ-G3, SC-G3, SC-G4.
- **U-G2-1** through **U-G2-6** — Goodwill/intangibles, share-count reconciliation, FIFO-adjusted earnings reconciliation, maintenance-capex proxy, deferred-LIFO-tax recognition, FY2005-FY2025 BVPS series. Items U-G2-1, U-G2-3, and U-G2-5 are partially anchored by the latest-financial track (goodwill = $0, intangibles = $0, deferred LIFO tax = $89.5m disclosed); U-G2-2 (share-count reconciliation), U-G2-4 (maintenance capex), and U-G2-6 (FY2005-FY2025 series) remain pending.
- **U-G3-1** through **U-G3-5** — Plant-by-category-by-region matrix; which entity filed Chapter 11; capacity exit vs. transfer; DMC-06 primary-source replacement; Q-DMC-01 through Q-DMC-04 source-ID gap.
- **U-G4-1** through **U-G4-6** — S&P DJI announcement; ETF holdings vendor; market-data vendor; Fama-French + sector controls; SEC-filing catalog inside event window; Russell membership and reconstitution dates.
- **U-X-1** — Cross-competitor capacity dynamic: if Del Monte exits private-label, does Lakeside or another supplier absorb the volume on aggressive terms?
- **U-X-2** — Class A / Class B share-class differences requiring exclusion of restricted or preferred equity from the tangible-book denominator.
- **U-X-3** — Add C-011 (price-cost recovery) to the next round of parallel claim tests.

### From the linear final-report track (`U-` items)

- **U-001** — Per-ticker primary-source verification of every analog candidate in `analog-screen.csv` and `parallel-analog-screen.csv`. Mirror the SENEA workflow per ticker.
- **U-002** — A SENEA price target is intentionally not produced. Compute downstream once F-002 and F-003 close. (F-002 and F-003 are now anchored by the latest-financial track; the remaining blocker is F-006 / S-009 — a price snapshot.)
- **U-003** — A formal Fama-French / liquidity-factor variance decomposition of the SENEA discount is intentionally not produced because S-018, S-019, S-021 have not been retrieved.

### New (this master report, `M-` items)

- **M-001** — **Closing-discount risk on C-001 / C-002.** Retrieve a primary SENEA Class A closing price snapshot at or near 2026-04-30 (S-009 / F-006) **and** primary cover-page share counts for Class A and Class B (S-011 / F-007 / U-G2-2), and reconcile against the latest-financial track's anchored FIFO-adjusted equity ($902.8m after-tax) and FIFO-adjusted NCAV ($477.0m after-tax). This is the single highest-leverage open item on the master report because it determines whether the deep-discount frame is still active.
- **M-002** — **Disagreement preservation on tax rate basis.** The linear final-report sized the after-tax LIFO add-back at the 21% federal floor; the latest-financial track and the parallel claim-test track use 24.9% statutory. Confirm the FY2025 effective tax rate from the Income Taxes note (S-001, S-010); document any state-inclusive rate above 24.9%; carry both the federal-floor and disclosed-statutory sensitivities into any downstream price-target derivation.
- **M-003** — **Reconcile aggregator vs. primary share counts.** The parallel track's bear-case section flags that aggregator share counts conflict with each other and cannot be treated as authoritative. Retrieve SENEA Class A and SENEB Class B cover-page share counts from the FY2025 10-K and the most recent 10-Q (S-011). Reconcile against StockTitan / GuruFocus / CompaniesMarketCap and document the divergence.
- **M-004** — **Cycle-test C-003b.** Multi-year FIFO earnings-power bridge. The latest-financial track anchors FY2025 LIFO charge at $34.474m. Build the FY2018-FY2024 LIFO-charge series from S-007 to test whether FIFO earnings power is structurally above reported earnings across cycles or only in single tinplate-cost-compression years.

**Until each item above is addressed against primary documents committed to `research/senea/`, the master synthesis verdict remains `unresolved-with-positive-mechanism-bias-and-closing-discount-risk` and downstream memo work should not proceed past Decision Gate 1.**

---

**Reproducibility note.** All synthesis above is derived from the four upstream JSON / Markdown artifact stacks and is reproducible by replaying their contents from the cited branches. The companion JSON artifact (`master-diligence-report.json`) carries the same content in structured form; the per-row source attribution is in `master-source-attribution.csv`; the per-claim scorecard is in `master-claim-scorecard.csv`. No external data was retrieved in producing this master report beyond what the upstream tracks already retrieved.

**Disclaimer (restated).** This is research output, not investment advice. It is not a recommendation, solicitation, or offer to buy or sell SENEA, SENEB, or any other security listed in the analog screen. Conclusions tagged `unresolved`, `partial`, or `partial-anchor-only` are not assertions of fact and should be reviewed against the primary sources enumerated above before any decision-relevant use.
