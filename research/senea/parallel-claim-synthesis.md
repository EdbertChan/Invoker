# SENEA Parallel Claim Synthesis

- Task: `synthesize-parallel-claim-tests`
- Ticker: `SENEA` / `SENEB` (Seneca Foods Corporation, SEC CIK 0000088948)
- Plan: `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- Upstream pack: `research/senea/claims-source-pack.json` (`artifactStatus: draft`)
- Source register: `research/senea/source-register.csv`
- Synthesis date: 2026-04-30
- Synthesizer: Claude (Opus 4.7)
- Inputs (read non-destructively from feature branches via `git show`):
  - `origin/plan/senea-claim-test-valuation` -> `research/senea/claim-tests/valuation.{md,json,evidence.csv}`
  - `origin/plan/senea-claim-test-industry-structure` -> `research/senea/claim-tests/industry-structure.{md,json,evidence.csv}`
  - `origin/plan/senea-claim-test-del-monte-change` -> `research/senea/claim-tests/delmonte-change.{md,json,evidence.csv}`
  - `origin/plan/senea-claim-test-index-forced-selling` -> `research/senea/claim-tests/index-selling.{md,json,evidence.csv}`
  - `origin/plan/senea-claim-test-governance-buybacks` -> `research/senea/claim-tests/governance-buybacks.{md,json,evidence.csv}`

> **Research caveat.** This document is a synthesis of in-progress diligence claim tests. It is research, not investment advice. Verdicts that the upstream tests recorded as `unresolved` or `partially_supported` are preserved as such; nothing here silently upgrades a claim. The analog stock screen at the end of this report enumerates mechanism-fit candidates for further research and is explicitly **not** a buy/sell recommendation.

## Executive Verdict

**Synthesis verdict: `unresolved` (mixed support).**

**Synthesis confidence: medium-low (in the *verdict*; high in the assertion that the thesis is not yet ready for a memo).**

The five parallel claim families produced a consistent picture: the SENEA thesis has a small number of well-anchored facts and a much larger number of structural assertions that depend on primary-source retrieval that has not yet happened in the repository. Nothing in the parallel tests refutes the thesis; equally, nothing in the parallel tests is sufficient under the plan's Decision Gates to pass a final memo.

| Anchor that is well-supported today | Source IDs |
| --- | --- |
| Seneca's FY2025 10-K discloses a $359.3m LIFO reserve. | `S-001` |
| The $359.3m LIFO reserve at the 24.9% statutory rate represents approximately $89.5m of deferred income tax (LIFO recapture exposure). | `S-001` |
| Seneca completed a March 2021 modified Dutch auction tender, repurchasing 1,449,339 Class A shares at $51.62 (~$74.81m, ~17.07% of the relevant float). | `S-001`, `S-005`, plus issuer press releases |
| FY2025 reported balance-sheet aggregates (~$633m equity, ~$755.7m current assets, ~$548.4m total liabilities, ~$604m inventory) are corroborated via aggregator data summarizing the same filing. | `S-001` (via aggregator) |

| Pillar that is structurally asserted but unresolved today | Status |
| --- | --- |
| Discount to tangible book and to NCAV (FIFO-adjusted), measured against current market cap. | `unresolved` (valuation family). Aggregator market caps suggest current trading is *above* both reported and FIFO-adjusted book, but the aggregator share counts conflict and have not been reconciled to primary share-count disclosure. |
| 20-year per-share book compounding and a clean year-by-year buyback ledger. | `unresolved`. Single buyback event corroborated; full 2005-2025 series not rebuilt. |
| Seneca + Lakeside ~90% U.S. private-label canned-vegetable concentration; whether that share is national, regional, or category-narrow. | `unresolved` (industry-structure family). Lakeside primary material not retrieved. |
| Del Monte Pacific May 2025 deconsolidation and U.S. Del Monte Foods Chapter 11. | `supported_by_anchor` (delmonte-change family) — confirmed in the plan's Quick Source Anchors and assigned source IDs (`S-003`, `S-008`), but the underlying filings/dockets have not been quoted into the repo. Pre-2025 conduct sub-claims (2014 ownership change, price aggression, Sager Creek, restructurings, plant closures) have **no source ID** in the pack and are `unresolved`. |
| July 2023 S&P SmallCap 600 deletion and forced-selling event study. | `unresolved` (index-selling family). No price/volume series, ETF holdings file, or factor-return data is in the repo; the plan's Decision Gate 4 is unmet. |
| Dual-class control, family voting concentration, IR posture, sell-side coverage absence, and counter-cyclical buyback pattern. | `unresolved` (governance-buybacks family). FY2025 10-K, FY2025 DEF 14A, IR coverage page, and the SC TO-I tender filings are all "to be retrieved" in the source register. |

**Net read.** Two of the strongest individual data points in the SENEA thesis (the LIFO reserve magnitude and the 2021 Dutch tender) are independently corroborated. The thesis as a whole — discount to FIFO-adjusted book, oligopoly with a structural conduct change, identifiable forced-selling shock, and counter-cyclical owner-operator capital allocation — cannot be admitted to a final memo from the materials currently in the repo. Decision Gate 1 ("no claim enters the memo without a source artifact and deterministic verification result") and Decision Gates 2-4 are unmet across the families, and the synthesis verdict therefore stays `unresolved`.

## Claim Scorecard

The scorecard preserves each claim family's original verdict and confidence as recorded in its parallel test artifact, then adds a final synthesis judgment. No claim that was recorded as `unresolved` upstream is upgraded here. The synthesis judgment is conservative by design: where a family carries a mix of `supported_by_anchor` and `unresolved` sub-claims (Del Monte change), the synthesis judgment reflects only what is admissible under Decision Gate 1.

| Family | Parent ledger claims | Original verdict | Original confidence | Synthesis judgment | Synthesis confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Valuation & accounting | C-001, C-002, C-003, C-004, C-008, plus tax-recapture sub-claim | `unresolved` | medium | `unresolved-mixed` | medium | LIFO reserve and LIFO recapture sub-claims are `supported`; spot price-to-book / NCAV comparisons remain `unresolved` because contemporaneous share-count and per-class market price are not reconciled to filings. Decision Gate 2 unmet. |
| Industry structure | C-005, C-006 (concentration side) | `unresolved` | low | `unresolved` | low | Every sub-claim is conditional on retrieving filings (`S-001`, `S-003`, `S-004`, `S-008`) that are still listed as not-yet-retrieved in the source register. Q-001 (which competitor Lakeside names) and Q-IS-A (national vs. regional measurement basis) are blocking. |
| Del Monte conduct change | C-006 (event side) | `partially_supported` (with sub-claim mix) | medium | `partially_supported-anchor-only` | medium | DMC-07 (May 2025 deconsolidation) and DMC-08 (Chapter 11 filing) are `supported_by_anchor` against `S-003` and `S-008`. DMC-01 through DMC-06 (2014 ownership change, price aggression, Sager Creek, restructuring, plant closures, private-label retreat) are `unresolved` and have **no source ID** in the pack. Plan Gate 1 is therefore unmet for the full conduct-change narrative. |
| Index deletion / forced selling | C-007 | `unresolved` | high (in the verdict itself) | `unresolved` | high (in the assertion that data is missing) | All five sub-claims (deletion fact, forced ETF selling, liquidity impact, event-window CARs, separation from fundamentals/factors) require data series (`S-002`, OHLCV, ETF holdings, factor returns) that are not in the repo. Plan Decision Gate 4 explicitly unmet. |
| Governance & buybacks | C-008, C-009, C-010 | `unresolved` | low | `unresolved` | low | All eight sub-claims (dual-class structure, family voting concentration, IR posture, sell-side absence, tender history, open-market repurchases, governance risk, counter-cyclical buyback pattern) await `S-001`, `S-005`, `S-006`, `S-007` retrieval. SC-G6 (open-market repurchases under authorized programs) and SC-G5 (tender history) are partially anchored by the corroborated 2021 Dutch tender event from the valuation family but not yet by a retrieved 10-K Item 5 monthly purchase table. |

**Combined synthesis judgment table.** This is a per-claim view that joins each ledger claim ID to the relevant family verdict and to the synthesis judgment.

| Ledger claim | Statement | Family | Synthesis judgment | Synthesis confidence |
| --- | --- | --- | --- | --- |
| C-001 | Discount to tangible book on FIFO-adjusted basis. | Valuation | `unresolved` | low |
| C-002 | Discount to NCAV on FIFO-adjusted basis. | Valuation | `unresolved` | low |
| C-003 | LIFO reserve / FIFO earnings power. | Valuation | `partially_supported` (LIFO reserve magnitude `supported`; FIFO earnings power `unresolved`) | medium |
| C-004 | 20-year book value per share compounding. | Valuation | `unresolved` | low |
| C-005 | Seneca + Lakeside ~90% U.S. private-label vegetable canning. | Industry structure | `unresolved` | low |
| C-006 | Del Monte Pacific deconsolidation effective May 2025 and Chapter 11 of U.S. Del Monte Foods. | Industry structure / Del Monte change | `supported_by_anchor` (the two terminal events); `unresolved` for the conduct sequence that precedes them. | medium |
| C-007 | July 2023 S&P SmallCap 600 deletion produced forced selling independent of fundamentals. | Index forced selling | `unresolved` | high (in the unresolved verdict; data is simply not collected) |
| C-008 | Material share repurchases relative to float. | Governance / valuation cross | `partially_supported` (March 2021 Dutch tender corroborated; full ledger missing) | medium |
| C-009 | Minimal sell-side coverage. | Governance | `unresolved` | low |
| C-010 | Dual-class structure with concentrated insider/family voting control. | Governance | `unresolved` | low |
| C-011 | Pricing-cost recovery across crop, steel/tinplate, freight, labor cycles. | (not tested in this round) | `not-tested` | n/a |

Note on C-011: the parallel claim tests for this round did **not** include a price-cost-recovery family. C-011 is preserved here as `not-tested` rather than rolled into a synthesis judgment.

## Attribution Summary

The synthesis relies only on (i) source IDs from `research/senea/source-register.csv`, (ii) the upstream `claims-source-pack.json`, (iii) the five parallel claim-test artifacts read from their feature branches, (iv) the SENEA Diligence plan, and (v) clearly flagged tertiary references that the valuation test admitted as supporting context only.

| Source ID | Title | Used in this synthesis for | Register confidence | Retrieval status |
| --- | --- | --- | --- | --- |
| `S-001` | Seneca Foods FY2025 Annual Report on Form 10-K. | LIFO reserve, LIFO recapture, FY2025 balance-sheet aggregates, buyback context, governance / dual-class structure, 10-K Item 5 issuer purchases, share-count and per-class price reconciliation requirement. | high | not retrieved into this repo (HTTP 403 from EDGAR in the valuation test environment; corroborated for the LIFO reserve / recapture language via WebSearch quoting the filing). |
| `S-002` | S&P Dow Jones Indices announcement of the July 2023 SENEA deletion from the S&P SmallCap 600. | Anchor for the deletion event and downstream event-study. | high | not retrieved. |
| `S-003` | Del Monte Pacific Limited FY2025 annual report and FY2025 results materials describing classification of the U.S. Del Monte Foods business as discontinued operations and deconsolidation effective May 2025. | DMC-07 anchor; basis for the Del Monte-side facility footprint and conduct narrative. | high | not retrieved. |
| `S-004` | Lakeside Foods public materials referencing the ~90% U.S. private-label vegetable-canning statement. | IS-1 through IS-7 anchor; basis for the duopoly framing and for Q-001 ambiguity (which competitor Lakeside names). | medium | not retrieved. |
| `S-005` | Seneca Foods FY2025 DEF 14A proxy statement. | Dual-class voting structure, family ownership concentration, related-party transactions, board independence, change-of-control provisions, buyback authorizations cross-reference. | high | not retrieved. |
| `S-006` | Seneca Foods Investor Relations coverage page and consensus-estimate vendor records. | Sell-side coverage absence (C-009), IR posture (SC-G3, SC-G4). | medium | not retrieved. |
| `S-007` | Seneca historical 10-K and 10-Q filings (FY2005-FY2025). | Time-series rebuild for book value per share, buyback ledger, fundamentals control inside the index-deletion event window. | high | not retrieved. |
| `S-008` | Del Monte Foods (U.S.) Chapter 11 bankruptcy filing and supporting docket records. | DMC-08 anchor; basis for capacity-exit vs. capacity-transfer determination (Q-IS-D, Q-DMC-07). | high | not retrieved. |

Tertiary references (admitted only as supporting context, never as primary citations; carried over from the valuation test's tertiary list):

- StockTitan SENEA financials page (`https://www.stocktitan.net/financials/SENEA/`) — aggregator summary of the FY2025 10-K balance sheet.
- StockTitan SENEB overview (`https://www.stocktitan.net/overview/SENEB/`).
- GuruFocus Seneca Foods Book Value per Share page (`https://www.gurufocus.com/term/Book+Value+Per+Share/SENEB/Book-Value-per-Share/Seneca-Foods`).
- Investing.com SENEA quote page (`https://www.investing.com/equities/seneca-foods-corp-(a)`).
- CompaniesMarketCap Seneca Foods shares outstanding (`https://companiesmarketcap.com/seneca-foods/shares-outstanding/`).
- Overlooked Alpha Seneca write-up (`https://www.overlookedalpha.com/p/seneca-foods-stock`).
- Seneca Foods press releases (expanded share-repurchase program; results of the modified Dutch auction tender) plus GlobeNewswire and MarketScreener mirrors covering the March 2021 tender.

A WebFetch attempt against SEC EDGAR returned HTTP 403 from the valuation-test environment, so direct line-item retrieval from the FY2025 10-K could not be performed. WebSearch quotes that cite the filing were used as the closest available substitute for the LIFO reserve and tax-rate language.

## Bear Case Integration

A clean bear case is required by plan task 9 ("Stress-test the bear thesis"). The five parallel tests already surface the lines an honest bear memo would lead with; this section consolidates them.

1. **Is the discount-to-FIFO-book frame still active?**
   - Aggregator market data (April 2026): SENEA Class A ~$134.71 (class market cap ~$911.6m), SENEB Class B ~$164.79 (class market cap ~$931.8m). Combined ~$1.8-1.9b is *above* both reported book (~$633m) and FIFO-adjusted equity (~$903m). If those aggregator figures hold up against primary share counts, the deep-discount frame has materially closed, and the residual case is FIFO-adjusted earnings power and ongoing buybacks rather than NCAV.
   - The aggregator share counts conflict with each other and cannot be treated as authoritative without primary share-count disclosure (FY2025 10-K cover page or DEF 14A). This is open question QV-002.
   - Contrary historical reference: an earlier third-party write-up characterized Seneca as a "$276m company...trading below liquidation value." The market-cap delta between that frame and current aggregator figures is roughly an order of magnitude, consistent with substantial re-rating that may have already happened.

2. **Is the 90% concentration figure real and current?**
   - The Lakeside ~90% private-label statement is a self-interested marketing claim. Without third-party industry data and without the full Lakeside primary text in context (Q-IS-A), the figure cannot be tied to a measurement basis (units vs. dollars, full vegetable canning vs. canned corn / canned green beans / canned peas, U.S. national vs. retailer-region) and cannot be tied to a time period.
   - Lakeside's quoted "one other competitor" may not be Seneca; Q-001 explicitly flags this ambiguity.

3. **Is Del Monte capacity actually being removed?**
   - Chapter 11 is reorganization, not liquidation. Operating capacity and customer contracts frequently survive a reorganization under new ownership. Q-IS-D (capacity exit vs. transfer) and Q-DMC-07 (which Del Monte entity filed) are unresolved.
   - Even if Del Monte exits private-label, Lakeside or other private-label competitors may absorb the volume on aggressive terms (X-002 in the Del Monte change test). Cross-competitor dynamics are out of scope for the current parallel tests.
   - DMC-01 through DMC-05 (2014 ownership change, price aggression, Sager Creek, multi-year restructurings, plant closures/sales) have no source ID in the pack and cannot be admitted under Plan Gate 1.

4. **Was the index-deletion shock a real, isolable event or a co-moving one?**
   - The Russell 2000 / Russell 2000 Value annual reconstitution typically lands in late June; if SENEA's Russell membership changed in the same window as the July 2023 S&P SmallCap 600 deletion, some forced-selling volume belongs to Russell flows rather than S&P flows (CE-003, Q-IS-6).
   - S&P SmallCap 600 deletions are pre-announced; arbitrageurs frequently front-run, so cumulative abnormal returns over the [announcement, effective] window can be near zero by the effective date even when the flow story is real (CE-004).
   - Mid-2023 small-cap value factor weakness can absorb part of the negative drift; without an HML / R2000V control the index-deletion signal is overstated (CE-002).
   - Concurrent FY2024-cycle Seneca fundamentals (10-K and 10-Q disclosures, LIFO-driven margin compression, commodity moves) may explain part of the cumulative weakness independent of index flows (CE-001).

5. **Is the buyback story counter-cyclical?**
   - The 2021 Dutch tender clearing price ($51.62) is well below current trading (~$134.71 / ~$164.79), supportive of accretive capital allocation but a single event does not substantiate a 20-year per-share compounding claim (CE-04 in valuation, CE-2 in governance).
   - If 10-K Item 5 monthly issuer-purchase tables show repurchases concentrated near 52-week highs rather than near tangible-book / FIFO-book lows, SC-G8 fails (CE-2 in governance).
   - Working-capital release that reduces inventory dollars without liquidating a LIFO layer in tax terms does not necessarily trigger the $89.5m LIFO recapture (CE-05 in valuation). The deferred-tax exposure should be read as maximum exposure, not as imminent obligation.

6. **Governance dual-class risk.**
   - DEF 14A Item 13 (related-party transactions, family-owned suppliers, related leases) is unread (SC-G7, CE-5 in governance). Without that read, a "controlled but aligned" interpretation cannot be distinguished from a "controlled with risk" interpretation.
   - If founding-family combined Class A + Class B voting power is materially below a control threshold (e.g., < 35%), the dual-class control narrative weakens (CE-1 in governance, Q-006).

The bear case position therefore aligns with the synthesis verdict: the SENEA thesis is admissible only after primary-source retrieval lands DMC-07/DMC-08 quotations, the 10-K Item 5 buyback table, the DEF 14A ownership and related-party tables, the Lakeside primary text, and a price/volume/factor dataset around the July 2023 deletion window.

## Analog Stock Screen

The analog screen is mechanism-driven, not investment advice. It enumerates publicly traded U.S. equities that share at least three of the seven Seneca mechanism features below. The intent is to give downstream research a comparable cohort against which to read SENEA's setup; nothing in this section should be read as a buy/sell recommendation, and inclusion here is **not** an endorsement.

Mechanism features (S = Seneca anchor):

- **(a) Asset-backed.** Significant tangible-asset base relative to equity (PP&E + inventory + cash heavy).
- **(b) Accounting-hidden / LIFO-like adjustment.** Reported book and earnings understate FIFO/economic book and earnings (LIFO accounting, deeply depreciated PP&E, unconsolidated assets, real-estate at cost).
- **(c) Undercovered small-cap.** Limited or zero active sell-side coverage and limited float.
- **(d) Possible forced selling / index deletion.** Past or current S&P SmallCap 600 / Russell 2000 deletion or borderline membership; or persistent sub-$1b market cap that exposes the name to mechanical flow.
- **(e) Insider / family control.** Dual-class structure or 13D/G filer family or founding-family voting concentration.
- **(f) Buyback support.** Documented open-market or tender-offer repurchase activity, with a preference for issuers that have done at least one Dutch auction or large-block tender.
- **(g) Boring durable niche structure.** Operates in a mature, low-glamour niche with rational competition, low product-substitution risk, and steady end-customer demand.

| Candidate | Ticker | Niche | (a) Asset-backed | (b) Accounting-hidden | (c) Undercovered small-cap | (d) Forced-selling exposure | (e) Insider / family control | (f) Buyback support | (g) Boring durable niche | Mechanism-fit count | Notes (must be confirmed before relying on) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Tootsie Roll Industries | TR | Confectionery | yes | partial (long-cycle real estate, low depreciation base) | yes | yes (small float, low ADV) | yes (Gordon family control via dual class) | yes | yes | 6-7 | Family-controlled, dual-class, mature U.S. confectionery niche; long buyback record. |
| John B. Sanfilippo & Son | JBSS | Tree-nut packaged foods | yes | partial (LIFO inventory in some periods; depreciated PP&E) | yes | partial (small-cap, has cycled in and out of small-cap indices) | yes (founding-family dual-class) | partial (special dividends more than buybacks) | yes | 5-6 | Owner-operator with concentrated family voting; tree-nut private-label / branded mix similar in tone to Seneca's vegetable-canning posture. |
| Bridgford Foods | BRID | Frozen / refrigerated foods | yes | partial (long-held real estate, depreciated PP&E) | yes (very low coverage) | yes (micro-cap, very low ADV) | yes (Bridgford family control) | partial | yes | 5-6 | Family-controlled micro-cap; structurally similar in float / coverage profile, narrower category. |
| Lifeway Foods | LWAY | Cultured-dairy / kefir | partial | partial | yes | partial | yes (Smolyansky family) | partial | partial | 4 | Family-controlled small-cap food name; less LIFO-exposed than Seneca, more growth-oriented. |
| Hooker Furnishings | HOFT | Furniture (LIFO accounting) | yes | yes (LIFO inventory disclosure) | yes | partial | no | yes | partial | 4-5 | Direct LIFO-mechanism analog; family control absent. |
| Olympic Steel | ZEUS | Steel service center | yes | yes (LIFO inventory; large LIFO reserve in steel cycles) | yes | partial | partial (Siegal family historically large holder) | yes | partial | 4-5 | Strong LIFO-reserve accounting analog; cyclicality higher than Seneca. |
| Friedman Industries | FRD | Steel processor / distributor | yes | yes (LIFO inventory; depreciated PP&E) | yes (micro-cap, low coverage) | yes (micro-cap, S&P SmallCap 600 not a member) | partial | partial | partial | 4-5 | Micro-cap LIFO steel processor; useful for the LIFO + undercovered combination. |
| Insteel Industries | IIIN | Steel wire products | yes | partial (LIFO in some periods) | yes | partial | no | yes | yes | 4 | Steady-niche steel-wire supplier; useful for the durable-niche + buyback feature combination. |
| Ethan Allen Interiors | ETD | Furniture | yes | partial (depreciated real estate, LIFO inventory) | yes | partial | partial (insider ownership) | yes | partial | 4 | LIFO furniture with vertically integrated assets; coverage thin. |
| Greif, Inc. | GEF / GEF.B | Industrial packaging | yes | partial | partial | partial | yes (dual-class A/B) | yes | yes | 5 | Dual-class industrial packaging with concentrated voting in B class; thicker coverage than Seneca but mechanism-fit for control / asset / buyback features. |
| Hamilton Beach Brands Holding | HBB / HBBA | Small-appliance distribution | partial | partial | yes | partial | yes (Vorys family / founding-family dual-class) | partial | partial | 4 | Dual-class controlled small-cap; undercovered. |
| Crawford & Company | CRD.A / CRD.B | Insurance claims management | partial | partial | yes | partial | yes (dual-class controlled) | yes | partial | 4 | Dual-class controlled small-cap; mechanism overlap on (c)/(e)/(f). |

**How to read this screen.** Mechanism-fit count is a simple unweighted tally of features marked `yes` (counting `partial` as 0.5). It is a triage tool for downstream research and should not be treated as a relative ranking. Confirming each cell against primary disclosures is required before any of these names are used as comparables in a SENEA memo. Names with weaker cross-mechanism fit (4 features) are still listed because they capture at least two of the three highest-signal Seneca features (LIFO accounting, family/dual-class control, and tender / open-market buyback history).

**Names deliberately not screened in.** Cal-Maine Foods (CALM, eggs) is excluded because it lacks LIFO mechanism. Boise Cascade (BCC) is excluded because it lacks family control and is institutionally over-covered. Tootsie Roll's industry is much more brand-driven than Seneca's, but the family-control / dual-class / buyback / long-cycle-asset combination makes it the closest non-LIFO analog to the governance and capital-allocation side of the Seneca thesis; it is included with that caveat. Hooker, Olympic, Friedman, Insteel, and Ethan Allen are included to give the LIFO-mechanism side of the thesis a multi-name comparable cohort even where family control is absent.

## Source Attribution

Final source attribution table, restricted to source IDs that the parallel tests actually relied on, with their role in this synthesis and their retrieval status. This table mirrors the **Attribution Summary** above and is preserved as a separate section per the acceptance criteria.

| Source ID | Used for | Retrieval status |
| --- | --- | --- |
| `S-001` | LIFO reserve, FIFO recapture, FY2025 balance sheet, governance / dual-class, 10-K Item 5 issuer purchases. | not retrieved in this repo; corroborated via WebSearch for LIFO language. |
| `S-002` | July 2023 S&P SmallCap 600 deletion event anchor. | not retrieved. |
| `S-003` | Del Monte Pacific FY2025 deconsolidation; basis for Del Monte plant footprint context. | not retrieved. |
| `S-004` | Lakeside Foods ~90% U.S. private-label vegetable-canning statement. | not retrieved. |
| `S-005` | DEF 14A: dual-class voting, family ownership, related-party transactions, board independence, buyback authorization cross-reference. | not retrieved. |
| `S-006` | IR coverage page and consensus-estimate vendor records (for sell-side coverage absence and IR posture). | not retrieved. |
| `S-007` | Historical 10-K / 10-Q (FY2005-FY2025) for time-series rebuild and fundamentals control inside the deletion event window. | not retrieved. |
| `S-008` | Del Monte Foods (U.S.) Chapter 11 docket and press release. | not retrieved. |

Tertiary context references and issuer press releases used only as supporting context are listed in the **Attribution Summary**.

## Unresolved Diligence Items

This is the consolidated open-questions list across the five parallel tests, deduplicated and re-ordered by which Decision Gate they block. Each item is sized to map to a discrete retrieval task. Resolving these items is the prerequisite for moving any of the synthesis judgments above off `unresolved` or `partially_supported`.

### Gate 1 — primary-source artifacts must be in the repo

- **U-G1-1.** Retrieve the SENEA FY2025 10-K HTML / iXBRL into the repo (S-001). Quote the LIFO reserve language, the Item 5 issuer-purchase table, the Item 1A risk factors, the cover page share-class disclosure, and the segment / business description. Resolves: `QV-001`, `QV-002`, `QV-003`, `QV-007`, `QV-008`, `OQ-G1`, `OQ-G4` (partial), `OQ-G6` (partial), `OQ-G7`, and indirectly the IS-1 / IS-3 / IS-4 segment-disclosure sub-claims.
- **U-G1-2.** Retrieve the SENEA FY2025 DEF 14A and any 13D/13G filings (S-005). Quote the Security Ownership of Certain Beneficial Owners and Management table, Item 13 related-party transactions, board independence disclosures, and any change-of-control / supermajority / golden-parachute provisions. Resolves: `OQ-G2` (= source-pack `Q-006`), `OQ-G6`, `QV-008`.
- **U-G1-3.** Retrieve the Del Monte Pacific Limited FY2025 annual report and SGX/PSE disclosure filings (S-003). Quote the discontinued-operations classification, the May 2025 deconsolidation accounting, and any U.S. private-label posture or pricing commentary. Resolves: `DMC-07`, `DMC-06` (partial), `Q-DMC-04`, `Q-DMC-08`.
- **U-G1-4.** Retrieve the U.S. Del Monte Foods Chapter 11 docket from PACER and the corresponding press release (S-008). Identify the filing entity (Del Monte Foods Inc. vs. Del Monte Foods Holdings vs. an intermediate), the §363 sale orders, the stalking-horse bids, and the disclosure-statement narrative on capacity. Resolves: `DMC-08`, `Q-004` (= `Q-DMC-07`), `Q-IS-D`, `Q-DMC-08`.
- **U-G1-5.** Retrieve the Lakeside Foods primary material in full (S-004) — corporate communications page, the source interview transcript, and any filings or trade-press archive. Identify which competitor Lakeside names alongside itself; identify the measurement basis (units vs. dollars), the time period, and the geographic / category scope. Resolves: `Q-001`, `Q-IS-A`, `Q-IS-C`.
- **U-G1-6.** Snapshot the Seneca IR site (S-006) and run a consensus-estimate vendor query (Refinitiv, Bloomberg, Visible Alpha). Document earnings-call cadence, the presence (or absence) of an Analyst Coverage page, FY2024-FY2025 press-release cadence, and the count of contributing sell-side analysts. Resolves: `OQ-G3`, `SC-G3`, `SC-G4`.

### Gate 2 — valuation and accounting reconciliation

- **U-G2-1.** Pull goodwill and intangible-asset balances from the FY2025 10-K balance sheet and net them out of FIFO-adjusted equity (`QV-001`).
- **U-G2-2.** Pin precise FY2025 share count by class (Class A common, Class B common, treasury) and the contemporaneous market price for each class on the comparison date; reconcile against aggregator signals that currently conflict (`QV-002`).
- **U-G2-3.** Confirm whether the FY2025 10-K (or supplemental investor materials / DEF 14A) contains a management-prepared FIFO-adjusted earnings or FIFO EBITDA reconciliation table (`QV-003`, inherits source-pack `Q-005`).
- **U-G2-4.** Identify or proxy maintenance capex from the FY2025 10-K (`QV-007`, inherits source-pack `Q-002`). Required so SC-G8 can distinguish FCF-funded from working-capital-funded buybacks.
- **U-G2-5.** Confirm whether the $89.5m deferred LIFO tax is already recognized as a deferred tax liability on the FY2025 balance sheet versus an unrecognized contingent obligation (`QV-006`).
- **U-G2-6.** Build the FY2005-FY2025 time series of book value per share and the year-by-year buyback ledger from S-001 / S-007 (`QV-004`, `QV-005`).

### Gate 3 — industry / Del Monte conduct change

- **U-G3-1.** Build the plant-by-category-by-region matrix for Seneca (S-001), Lakeside (S-004), and the post-deconsolidation Del Monte U.S. business (S-003 + S-008). (`Q-IS-B`).
- **U-G3-2.** Resolve which entity actually filed Chapter 11 and how that maps to the deconsolidated perimeter in S-003 (`Q-004`, `Q-DMC-07`).
- **U-G3-3.** Determine whether Chapter 11 results in capacity exit (plant closures, asset abandonment) or capacity transfer (going-concern sale, reorganized emergence) using §363 sale orders and any plan / disclosure statements (`Q-IS-D`, `Q-DMC-05`).
- **U-G3-4.** Replace the indirect inference for DMC-06 (private-label retreat) with a direct Del Monte Pacific MD&A passage, U.S. retailer disclosure, or bankruptcy-court declaration on private-label posture (`Q-DMC-06`).
- **U-G3-5.** Add primary or near-primary evidence for the post-2014 Del Monte price aggression sub-claim and for Sager Creek integration / write-down history; both currently lack source IDs (`Q-DMC-01`, `Q-DMC-02`, `Q-DMC-03`, `Q-DMC-04`).

### Gate 4 — index-deletion attribution

- **U-G4-1.** Pull the S&P Dow Jones Indices announcement (S-002) and record announcement date, effective date, and stated reason (`Q-IS-1`, mirrors `Q-003`).
- **U-G4-2.** Add a fund-holdings source to the source register and pull SENEA share counts in IJR, SLY, VIOO, and any other S&P SmallCap 600 trackers as of the day before the effective date (`Q-IS-2`, missing source `MS-2`).
- **U-G4-3.** Add a market-data vendor and retrieve SENEA daily OHLCV plus quote spreads for `[T-1 - 250, T-2 + 250]` (`Q-IS-3`, missing source `MS-1`).
- **U-G4-4.** Run market-model and Fama-French-5 + momentum event studies over the windows specified in the index-selling test, with sector controls (`Q-IS-4`, missing sources `MS-3`, `MS-5`).
- **U-G4-5.** Catalog every Seneca SEC filing and press release inside `[T-1 - 30, T-2 + 30]` and re-estimate residuals excluding fundamental-news days (`Q-IS-5`).
- **U-G4-6.** Document SENEA's Russell 2000 / Russell 2000 Value membership and reconstitution dates around the same window (`Q-IS-6`, missing source `MS-4`).

### Cross-family items not yet bound to a single Gate

- **U-X-1.** Cross-competitor capacity dynamic: if Del Monte exits private-label, does Lakeside or another supplier absorb the volume on aggressive terms? Required to convert the Del Monte exit narrative into a real market-structure improvement.
- **U-X-2.** Confirm whether the FY2025 10-K, DEF 14A, or SC TO-I filings disclose any Class A / Class B share-class differences that would require excluding restricted or preferred equity from the tangible-book denominator (`QV-008`, cross-cutting `Q-006`).
- **U-X-3.** Add C-011 (price-cost recovery across crop, steel/tinplate, freight, labor cycles) to the next round of parallel claim tests so that the synthesis is no longer marked `not-tested` for that pillar.

Until each item above is addressed against primary documents committed to `research/senea/`, the synthesis verdict remains `unresolved` and downstream memo work should not proceed past Decision Gate 1.

---

*Reminder: this report is part of an internal research workflow. It is not investment advice and is not a recommendation to buy, sell, or hold any security. The analog screen above is a mechanism-fit triage tool for further research, not a portfolio.*
