# SENEA Final Investment Report

- **Task:** screen-analogs-and-final-report
- **Ticker:** SENEA (Seneca Foods Corporation, Class A common stock)
- **Plan reference:** `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- **Reference date:** 2026-04-30
- **Fiscal year anchored:** FY2025 (year ended 2025-03-31)
- **Artifact status:** draft
- **Upstream artifacts synthesized:**
  - `research/senea/claims-source-pack.json`
  - `research/senea/financial-rebuild.json`
  - `research/senea/industry-bear-case.json`
  - `research/senea/attribution-report.json`
- **Companion artifacts:** `research/senea/final-investment-report.json`, `research/senea/analog-screen.csv`

> **Disclaimer.** This is a research report synthesizing prior diligence artifacts. It is **not investment advice**, not a recommendation to buy or sell any security, and not a solicitation. It is reproducible analytical work-product produced for an internal diligence workflow. Conclusions that are not yet anchored to retrieved primary sources are explicitly classified as `unresolved` rather than asserted as fact.

## Executive Verdict

**Bottom line.** The SENEA opportunity is best characterized as a *mechanism-rich, evidence-incomplete* deep-value setup. The bull thesis is **structurally coherent** but **quantitatively unproven** in this diligence pass: the only numerically anchored data point is the FY2025 LIFO reserve of $359.3m (`S-001`, claim `C-003`). Every other claim — price-to-FIFO-tangible-book, NCAV-on-FIFO-basis, 20-year per-share compounding, oligopoly share, Del Monte exit, index-deletion alpha — is either `pending`, `partially-verified`, or `unverified` in the upstream pack. The bear case binds at multiple points (`B-001`, `B-002`, `B-003`, `B-005`, `B-007`, `B-010`) regardless of how the bull narrative resolves.

**Verdict classification: `unresolved-with-positive-mechanism-bias`.**

| Dimension | Status | Anchor |
|---|---|---|
| FIFO earnings power exists at >$0 | `partially-verified` | $359.3m LIFO reserve `S-001` |
| Trades below FIFO tangible book | `unresolved` | Requires balance-sheet pull `S-001`, price `S-009` |
| Trades at/below FIFO NCAV | `unresolved` | Requires balance-sheet pull `S-001`, price `S-009` |
| Private-label oligopoly (Seneca + Lakeside ≈90%) | `unresolved` | Self-reported `S-004`; needs `S-001` Item 1 + `S-016` triangulation |
| Del Monte competitor exit | `partially-verified` | Pointer-anchored `S-003`, `S-008`; needs `P-004`, `P-005` |
| S&P SmallCap 600 deletion produced forced selling | `partially-verified` | Pointer `S-002`; magnitude pending `S-018`, `S-020` |
| Insider/family control via dual class | `partially-verified` | Pointer `S-005`; voting share pending `P-009` |
| Buyback support | `unresolved` | Authorization data pending `F-004` |
| 20-year per-share compounding | `unresolved` | History pull pending `F-005` |

**What would change the verdict.** The single largest unblocking dependency is `S-001` (the FY2025 10-K balance sheet, LIFO note, Income Taxes note, Item 5 buybacks). Retrieving it resolves `F-001` through `F-004` and `F-007` simultaneously, which collapses six of the nine `unresolved` rows above into testable computations. Adding `S-009` (a SENEA Class A price snapshot) and `S-018` (daily OHLCV) closes the price-comparison and event-window arms. None of these inputs are unobtainable; they are simply not retrieved in this pass.

**Why we do not assign a price target.** Two of the three bridges that would produce a price target — `tangibleBookBridge` and `ncavBridge` in `financial-rebuild.json` — are blocked on retrievable data. Inventing a number here would violate the "if evidence is missing, classify as `unresolved`" acceptance criterion. A price target should be produced in a downstream artifact once `F-002` (effective tax rate) and `F-003` (balance-sheet line items) close.

## Claim-By-Claim Scorecard

The eleven upstream claims from `claims-source-pack.json` are scored below. Each row carries the upstream `claimId`, the supporting `sourceIds`, the strongest piece of synthesized evidence, the bear-case items that bind regardless of resolution, and the final classification.

| Claim | Text (abbreviated) | Bull Sources | Strongest Synthesized Evidence | Binding Bear Items | Classification |
|---|---|---|---|---|---|
| `C-001` | SENEA below tangible book on FIFO basis | `S-001`, `S-007`, `S-009`, `S-010`, `S-011` | Bridge methodology defined in `financial-rebuild.json valuationBridge.tangibleBookBridge`; `$359.3m` LIFO add-back anchored | `B-010` (after-tax add-back is `$284m` at 21% federal floor, less at state-inclusive rates) | `unresolved` |
| `C-002` | SENEA at/below NCAV on FIFO basis | `S-001`, `S-007`, `S-009`, `S-010`, `S-011` | `ncavBridge` methodology defined; LIFO add-back anchored | `B-010` | `unresolved` |
| `C-003` | Reported earnings understate FIFO earnings power | `S-001` | LIFO reserve `$359.3m` anchored verbatim from FY2025 10-K | `B-005` (tinplate cost compression of margin), `B-010` (after-tax dilution of add-back) | `partial` |
| `C-004` | 20-year book value per share compounding | `S-001`, `S-002`, `S-007` | Methodology defined in `financial-rebuild.json perShareCompoundingBridge` | `B-008` (private-label margin ceiling) | `unresolved` |
| `C-005` | Seneca + Lakeside ≈ 90% of US private-label vegetable canning | `S-001`, `S-004` | `IC-001` cross-checked against syndicated panel `S-016` | `B-004` (self-reported figure), `B-008` | `unresolved` |
| `C-006` | Del Monte Pacific deconsolidated US business; US Del Monte filed Chapter 11 | `S-003`, `S-008` | `IC-006` and `IC-007` both `partially-verified` at pointer level | `B-003` (Chapter 11 may produce leaner competitor) | `partial` |
| `C-007` | SENEA deleted from S&P SmallCap 600 in July 2023 | `S-002` | Event identified `E-001`; magnitude blocked on `S-018`, `S-020` | `R-011` (attribution leakage with structural liquidity `E-011`) | `partial` |
| `C-008` | Material share repurchases relative to float | `S-001`, `S-005` | `E-003` directional sign positive; magnitude blocked on `F-004` | `B-007` (dual-class caps activist crystallization) | `unresolved` |
| `C-009` | Minimal sell-side coverage | `S-006` | `E-009` anchored at pointer level; sign negative-structural | `B-002` (customer concentration) reinforces neglected status | `partial` |
| `C-010` | Dual-class share structure with insider/family control | `S-001`, `S-005` | `E-008` graded `negative-structural`; voting share pending `P-009` | `B-007` (caps crystallization); `B-003` could compound | `partial` |
| `C-011` | Pricing-cost recovery across crop / steel / freight / labor cycles | `S-001` | `IC-008` graded `unverified`; bridge methodology defined `P-006` | `B-005` (incomplete tinplate pass-through), `B-006` (climate variance) | `unresolved` |

**Scorecard summary.** Of eleven claims, **0 are `verified`**, **5 are `partial`** (`C-003`, `C-006`, `C-007`, `C-009`, `C-010`), and **6 are `unresolved`** (`C-001`, `C-002`, `C-004`, `C-005`, `C-008`, `C-011`). No claim has been refuted; the evidence required to convert any partial to verified is enumerated and recoverable.

## Financial Rebuild Summary

(Synthesized from `research/senea/financial-rebuild.json`.)

**Single anchored datum.** FY2025 LIFO reserve = **$359.3m** (`S-001`). This is the only numerical input the financial-rebuild pass anchored from primary materials.

**Bridge architecture (defined, not yet computed).**

- *Tangible book bridge.* `tangible_book_reported = stockholders_equity − goodwill − intangibles`; FIFO upper bound adds the gross LIFO reserve (`+$359.3m`); FIFO conservative case adds the after-tax reserve (`$359.3m × (1 − effective_tax_rate)`). Per-share denominator is Class A + Class B (`S-011`). Market price comparison uses `S-009`.
- *NCAV bridge.* `ncav_reported = total_current_assets − total_liabilities`; FIFO add-backs identical to tangible-book bridge because the LIFO reserve sits in inventory inside current assets.
- *Earnings-power bridge.* `fifo_pretax_income = reported_pretax_income + lifo_charge` where `lifo_charge = lifo_reserve_FY2025 − lifo_reserve_FY2024`. After-tax conversion uses the FY2025 effective rate from the Income Taxes note (`F-002`). FIFO EBITDA = reported EBITDA + LIFO charge (pre-tax by definition).
- *Per-share compounding bridge.* FY2005 → FY2025 reconstruction from `S-007`; both LIFO-basis and FIFO-adjusted CAGRs computed against Class A + Class B share base.

**Quantitative gating.** All nine non-anchored line items in `reportedMetrics` are blocked on `S-001` retrieval. The after-tax LIFO add-back to equity at the 21% federal statutory floor is roughly **$284m**; state-inclusive rates compress it further (bear case `B-010`).

**What is `pending` vs `partial` vs `deferred`.**

- `partial` (one claim): `C-003` — LIFO reserve anchored; FIFO bridge needs only the LIFO charge and effective tax rate.
- `pending` (four claims): `C-001`, `C-002`, `C-004`, `C-008` — methodology defined, balance-sheet / proxy / history retrieval required.
- `deferred` (one claim): `C-011` — multi-year MD&A bridge, not blocking the FY2025 valuation bridges.

**Source citations for the FIFO bridge.** `S-001` (10-K), `S-005` (proxy), `S-007` (historical 10-Ks), `S-009` (price), `S-010` (tax rate), `S-011` (share count).

## Industry And Bear Case Summary

(Synthesized from `research/senea/industry-bear-case.json`.)

**Industry-structure verdict (`mixed`).** No major industry claim moves from `pending` to `passed` in this diligence pass. The bull narrative — Seneca + Lakeside private-label oligopoly with Del Monte exiting — is directionally credible at the source-pointer level but is graded `unverified` or `partially-verified` until industry primary checks `P-001` through `P-009` close.

**Industry claim status:**

| `IC-id` | Claim | Status | Blocking Checks |
|---|---|---|---|
| `IC-001` | Seneca + Lakeside ≈ 90% of US private-label canning | `unverified` | `P-001`, `P-002` |
| `IC-002` | Lakeside is the second scale private-label producer | `partially-verified` | `P-002` |
| `IC-003` | Del Monte Foods (US) is significant branded participant | `partially-verified` | `P-004`, `P-005` |
| `IC-004` | Long tail of smaller US producers (Hanover, Faribault, Furmano's, Truitt, Allens) | `unverified` | `P-003` |
| `IC-005` | Private-label dollar share is high in mass / club | `unverified` | `P-002`, `P-008` |
| `IC-006` | Del Monte Pacific deconsolidated US business May 2025 | `partially-verified` | `P-004`, `P-005` |
| `IC-007` | Del Monte Foods (US) Chapter 11 in 2025 | `partially-verified` | `P-004` |
| `IC-008` | Pricing rational; cost moves passed through | `unverified` | `P-006` |
| `IC-009` | Customer concentration in large grocers / mass / club | `unverified` | `P-008` |
| `IC-010` | Per-capita US canned-vegetable consumption in secular decline | `unverified` | `P-007` |

**Bear case.** Ten bear items were constructed; eight bind even under the strongest verified version of the bull narrative:

- `B-001` Secular per-capita decline caps long-run volume growth (`S-012`, `S-016`).
- `B-002` Customer concentration (Walmart / Kroger / Costco / Albertsons / Ahold Delhaize) caps pricing power (`S-001`, `S-015`).
- `B-003` Del Monte Chapter 11 may produce a leaner, recapitalized competitor — not an exit (`S-003`, `S-008`, `S-014`).
- `B-005` Tinplate / Section 232 tariff cost pressure with incomplete pass-through compresses gross margin (`S-001`, `S-014`, `S-017`).
- `B-006` Climate / crop-yield variability is structural in PNW / Wisconsin / Minnesota / NY pack regions (`S-001`).
- `B-007` Dual-class structure prevents activist crystallization; only buyback-pace realization (`S-005`).
- `B-008` Private-label EBITDA margins are structurally below branded packaged-food (`S-014`, `S-015`).
- `B-010` After-tax LIFO add-back to equity is `~$284m` at federal statutory floor vs `$359.3m` gross (`S-001`, `S-010`).

`B-004` (the `~90%` figure may overstate concentration) and `B-009` (substitution to fresh / frozen) are *non-binding* in the sense that even verifying the bull figures does not erase them — but they are also `unverified` themselves.

## Attribution Summary

(Synthesized from `research/senea/attribution-report.json`.)

**Seven attribution buckets, eleven events.** The SENEA discount decomposes into the following buckets (full event records and per-bucket evidence are in the upstream attribution artifact):

| Bucket | Events | Sign | Status |
|---|---|---|---|
| `non-fundamental-supply-shock` | `E-001` (S&P SmallCap 600 deletion July 2023) | negative one-time | `evidence-pending` |
| `fundamental-repricing` | `E-002` (earnings releases), `E-003` (buyback announcements) | ambiguous (positive on buybacks) | `evidence-pending` |
| `competitor-restructuring` | `E-004` (Del Monte Pacific deconsolidation May 2025), `E-005` (Del Monte US Chapter 11 2025) | positive | `evidence-pending` |
| `commodity-input-cost-pressure` | `E-006` (FY2018-FY2025 input-cost cycle) | ambiguous (sign depends on pass-through) | `evidence-pending` |
| `liquidity-and-coverage` | `E-009` (sell-side coverage absence), `E-011` (turnover / spread / float) | negative-structural | `evidence-pending` |
| `liquidity-and-factor` | `E-007` (Fed QT / SVB liquidity windows), `E-010` (small-cap / value factor context) | negative in tightening windows | `evidence-pending` |
| `governance-discount` | `E-008` (FY2025 DEF 14A dual-class voting) | negative-structural | `evidence-pending` |

**The single largest data dependency** is `S-018` (SENEA Class A daily OHLCV). It blocks every quantitative event-window or factor-regression magnitude — eleven of eleven events carry `magnitudeStatus = evidence-pending` because of it. Inventing returns in its absence would violate the upstream acceptance criterion.

**Key residual risks for downstream attribution work** (from `attribution-report.json residualRisks`):

- `R-009` `S-018` is the master dependency; no event produces a numerical excess return without it.
- `R-010` Risk of double-counting between `E-007` and `E-010` — must use a joint Fama-French regression rather than additive single-factor regressions.
- `R-011` Risk of attribution leakage between the one-time `E-001` index-deletion shock and the persistent `E-011` structural liquidity discount — pre-/post-July-2023 13F ownership concentration required to separate them.

**Synthesis.** The discount, qualitatively, is a sum of: a one-time forced-selling shock that is partially mean-reverting, a structural liquidity / coverage / governance discount that is persistent, a beta-driven factor drag through 2022–2024 with partial 2025 recovery, and two competitor-restructuring positives that have not yet repriced. The `fundamental-repricing` bucket is ambiguous because it depends on whether the market has already capitalized the FIFO earnings-power bridge — the precise question `E-002` is designed to test.

## Analog Stock Screen

The screen below identifies **mechanism-fit analogs** — companies whose discount mechanism resembles SENEA's, not just companies that look cheap on a multiple. Mechanism criteria are derived from the SENEA setup and the upstream artifacts; each analog is scored against the seven criteria and carries an explicit verification status. The full row-per-candidate dataset is in `research/senea/analog-screen.csv`.

**Mechanism criteria (for each criterion, the upstream linkage is shown).**

| Code | Criterion | SENEA linkage |
|---|---|---|
| `M1` | Asset-backed (real estate, plants, inventory) | `C-001`, `C-002` (tangible book / NCAV bridges) |
| `M2` | Accounting-hidden value (LIFO reserves, mark-to-market gaps, conservative depreciation) | `C-003` ($359.3m LIFO reserve `S-001`) |
| `M3` | Undercovered small-cap (low or no formal sell-side coverage) | `C-009` (`S-006`) |
| `M4` | Possible forced selling / index-deletion exposure (small-cap-index movement, low float, illiquidity) | `C-007` (`S-002`, `E-001`) |
| `M5` | Insider / family control or dual-class structure | `C-010` (`S-001`, `S-005`); bear `B-007` |
| `M6` | Buyback support (active authorization or executions material to float) | `C-008` (`S-001`, `S-005`); event `E-003` |
| `M7` | Boring but durable niche structure (oligopoly, asset-intensive, high entry barriers) | `C-005`, `IC-001` (`S-004`, `S-016`) |

**Selection process.** Candidates were drawn from three buckets:

1. **Direct industry peers** in private-label / canned / packaged-food where the LIFO + family-control + low-coverage profile recurs.
2. **LIFO + family-control composites** outside the food industry where the *mechanism* is the same even though the end-market differs.
3. **Asset-backed deep-value undercovered names** that match `M1` + `M3` + `M4` even if `M2` is weaker.

**Scoring convention.** `Y` = mechanism present at the descriptive level. `~` = partial / mechanism-applicable but smaller in magnitude. `N` = mechanism not present. **All scores are descriptive priors that require primary-source verification per ticker** (10-K, proxy, ETF holdings, IR coverage page) before being treated as anchored. Each candidate carries `verificationStatus = unresolved-needs-primary-source-verification` until those pulls are completed.

| Ticker | Company | M1 | M2 | M3 | M4 | M5 | M6 | M7 | Mechanism Notes |
|---|---|---|---|---|---|---|---|---|---|
| `HNFSA` | Hanover Foods Corporation | Y | Y | Y | Y | Y | ~ | Y | Closest industry analog: private-label canned vegetables / sauces, family-controlled dual-class, very thin float, LIFO accounting. Confirms the SENEA mechanism rather than diversifies it. |
| `IMKTA` | Ingles Markets | Y | Y | Y | ~ | Y | Y | Y | Dual-class family-controlled grocer with LIFO, owned-real-estate book, low coverage, multi-decade buyback. Same mechanism class as SENEA. |
| `DDS` | Dillard's | Y | Y | ~ | N | Y | Y | Y | Family-controlled dual-class department store with LIFO, owned-real-estate base, structural buybacks of historic magnitude. Coverage exists but mechanism extreme. |
| `WMK` | Weis Markets | Y | Y | Y | ~ | Y | ~ | Y | Family-controlled grocer, LIFO, owned-real-estate book, undercovered. Buyback program smaller than `DDS` / `IMKTA`. |
| `JBSS` | John B. Sanfilippo & Son | Y | Y | Y | N | Y | ~ | Y | Family-controlled (Class A super-voting) snack / nut processor; LIFO inventories; modest sell-side coverage; durable private-label-heavy customer base. |
| `LAS.A` | Lassonde Industries (TSX) | Y | ~ | Y | N | Y | ~ | Y | Canadian family-controlled dual-class fruit-juice / private-label processor; asset-backed; under-covered ex-Canada. Mechanism analog without LIFO US tax effect. |
| `BRID` | Bridgford Foods | Y | Y | Y | Y | Y | N | Y | Family-controlled snack / frozen-dough manufacturer; LIFO; very thinly traded; small-cap-index-vulnerable. |
| `TR` | Tootsie Roll Industries | Y | ~ | Y | N | Y | Y | Y | Founding-family dual-class (super-voting) confectionery; durable niche; conservative balance sheet; persistent buybacks. Tends to trade at a premium not a discount — included as a mechanism reference, not a value comparable. |
| `CALM` | Cal-Maine Foods | Y | N | ~ | N | Y | N | Y | Founding-family dual-class egg producer; asset-backed agricultural niche; mechanism partial (no LIFO inventory cushion of canning scale; dividend > buyback). |
| `MUEL` | Paul Mueller Co | Y | Y | Y | Y | Y | ~ | Y | Family-controlled stainless-steel processing-equipment manufacturer; LIFO; very thin float; SEC-reporting but dark-stock-like. Strong `M1`/`M2`/`M3`/`M4`/`M5` overlap. |
| `FRD` | Friedman Industries | Y | Y | Y | Y | ~ | Y | Y | Steel-coil processor; LIFO; small-cap index-vulnerable; asset-backed. Insider ownership material but not strict family-control. |
| `ZEUS` | Olympic Steel | Y | Y | Y | N | ~ | Y | Y | Steel service center with LIFO; insider ownership material; durable mid-stream niche; periodic buyback. |

**How to read the screen.** This is a *priors* table, not a statement of fact about any of these companies. Each candidate maps onto a subset of SENEA's discount mechanism. The natural next step is a per-ticker primary-source pull mirroring the SENEA workflow: 10-K balance sheet for `M1`/`M2`, proxy for `M5`, IR coverage page for `M3`, ETF / index membership for `M4`, Item 5 buyback table for `M6`, Item 1 'Business' for `M7`. Until those pulls happen, every candidate is `unresolved-needs-primary-source-verification`.

**Bear-case overlay.** Even on a mechanism-fit analog, the SENEA-side bear items can travel: `B-002` (customer concentration) applies to any private-label-heavy food name; `B-007` (dual-class blocks activism) applies to every `M5 = Y` candidate; `B-010` (after-tax LIFO add-back is smaller than gross) applies to every `M2 = Y` candidate carrying a US LIFO reserve. The screen's job is to surface candidates that share the *positive* mechanism, not to certify that any of them is mispriced.

## Source Attribution

Every conclusion above is tied to one or more upstream sources from the consolidated source register (`S-001` through `S-021`, defined across the four upstream JSON artifacts). The complete set used in this synthesis is:

- **Primary filings:** `S-001` (Seneca FY2025 10-K), `S-003` (Del Monte Pacific FY2025 annual report), `S-005` (Seneca FY2025 DEF 14A), `S-007` (Seneca FY2005-FY2025 historical filings), `S-011` (Seneca cover-page share counts), `S-015` (retailer 10-K / 20-F private-label disclosures).
- **Index / corporate action:** `S-002` (S&P DJI deletion announcement), `S-008` (Del Monte US Chapter 11 PACER docket), `S-020` (IJR / SLY rebalance disclosures).
- **Industry / market data:** `S-004` (Lakeside `~90%` corporate statement), `S-012` (USDA ERS + Census ASM), `S-013` (smaller-player trade press), `S-014` (Del Monte trade-press wire copy), `S-016` (Circana / NielsenIQ aggregates), `S-017` (CRU Tinplate / S&P Platts / FRED canned-vegetable production index).
- **Market data series:** `S-009` (SENEA Class A reference price), `S-018` (SENEA Class A daily OHLCV), `S-019` (Russell 2000 / Fama-French factor returns), `S-021` (FRED rates / liquidity windows).
- **Corporate / coverage:** `S-006` (Seneca IR coverage page), `S-010` (US federal statutory rate / SENEA effective rate cross-reference).

**Coverage by claim:** every `claimId` (`C-001`–`C-011`), every `industryClaim` (`IC-001`–`IC-010`), every `bearCaseId` (`B-001`–`B-010`), and every `eventId` (`E-001`–`E-011`) cited above is anchored to a `sourceIds` list in the corresponding upstream JSON artifact. Conclusions in this report inherit those source IDs by reference.

**Conclusions that lack anchored evidence are tagged `unresolved`** in the scorecard and verdict tables and are restated in the `Unresolved Diligence Items` section below.

## Unresolved Diligence Items

Items below are blocking the `unresolved` and `partial` claim classifications. They are organized by upstream artifact and carry the source IDs required to close them.

**From `claims-source-pack.json` (upstream `Q-` items):**

- `Q-001` — Identify the specific competitor named alongside Lakeside in the `~90%` private-label statement (`S-004`). Blocks `C-005`, `IC-001`, `IC-002`, `B-004`.
- `Q-002` — Determine whether the FY2025 10-K discloses a maintenance-capex figure or proxy, vs deriving it from the PP&E roll-forward (`S-001`). Blocks `C-003`, `C-011`, `IC-008`.
- `Q-003` — Confirm the precise effective date of the July 2023 S&P SmallCap 600 deletion and identify rebalancing index ETFs (`S-002`, `S-020`). Blocks `C-007`, `E-001`.
- `Q-004` — Confirm the filing entity (Del Monte Foods Inc. vs Del Monte Foods Holdings) for the 2025 Chapter 11 case and posture (reorganization vs Section 363 sale vs liquidation) (`S-008`, `S-014`). Blocks `C-006`, `IC-007`, `B-003`, `E-005`.
- `Q-005` — Determine whether management's FIFO-adjusted earnings / EBITDA are reconciled in the FY2025 10-K itself or only in supplemental investor materials (`S-001`). Blocks `C-003`.
- `Q-006` — Quantify combined Class A + Class B voting power held by the founding family / insiders per the FY2025 DEF 14A (`S-005`). Blocks `C-010`, `B-007`, `E-008`.

**From `financial-rebuild.json` (`F-` items):**

- `F-001` — Retrieve the FY2024 LIFO reserve to compute the FY2025 LIFO charge (`S-001`).
- `F-002` — Retrieve the FY2025 effective tax rate from the Income Taxes note (`S-001`, `S-010`).
- `F-003` — Retrieve the FY2025 consolidated balance sheet for equity, goodwill, intangibles, current assets, total liabilities, debt, cash / marketable securities (`S-001`).
- `F-004` — Retrieve FY2025 Item 5 monthly repurchase table and FY2025 DEF 14A buyback authorization disclosures (`S-001`, `S-005`).
- `F-005` — Retrieve FY2005-FY2024 10-K filings for the 20-year per-share compounding rebuild (`S-007`).
- `F-006` — Capture an archived SENEA Class A closing price at or near 2026-04-30 (`S-009`).
- `F-007` — Confirm cover-page share counts on the FY2025 10-K and most recent 10-Q (`S-011`).
- `F-008` — Confirm whether maintenance-capex disclosure exists or must be PP&E-roll-forward-derived (carry-forward of `Q-002`) (`S-001`).

**From `industry-bear-case.json` (`P-` items):**

- `P-001` — Quote Item 1 of Seneca FY2025 10-K on competitive position (`S-001`).
- `P-002` — Archive Lakeside `~90%` statement verbatim with date and venue; triangulate against `S-016` and `S-012` (`S-004`, `S-012`, `S-016`).
- `P-003` — Catalog Hanover, Faribault, Furmano's, Truitt, Allens / Sager Creek (`S-013`, `S-014`).
- `P-004` — Pull the Del Monte US Chapter 11 PACER docket (`S-008`, `S-014`).
- `P-005` — Quote Del Monte Pacific FY2025 annual report deconsolidation paragraphs (`S-003`).
- `P-006` — FY2018-FY2025 revenue / gross-margin bridge vs tinplate / freight indices (`S-001`, `S-007`, `S-017`).
- `P-007` — USDA ERS + Census ASM + Circana / NielsenIQ canned-vegetable trend (`S-012`, `S-016`).
- `P-008` — Quote FY2025 10-K Item 1 / 1A on customer concentration (`S-001`, `S-015`).
- `P-009` — Confirm combined Class A / Class B voting power per FY2025 DEF 14A (`S-005`).

**From `attribution-report.json` (`R-` residual risks):**

- `R-001` — Effective deletion date for `E-001` (carry-forward of `Q-003`) (`S-002`, `S-020`).
- `R-002` — FY2024 LIFO reserve and per-release reported financials (carry-forward of `F-001`, `F-003`) (`S-001`, `S-007`).
- `R-003` — FY2025 effective tax rate (carry-forward of `F-002`) (`S-001`, `S-010`).
- `R-004` — Buyback authorization and execution dates (carry-forward of `F-004`) (`S-001`, `S-005`).
- `R-005` — Del Monte US Chapter 11 entity and posture (carry-forward of `Q-004`) (`S-008`, `S-014`).
- `R-006` — Quoted Del Monte Pacific deconsolidation paragraphs (carry-forward of `P-005`) (`S-003`).
- `R-007` — Combined family / insider voting power (carry-forward of `Q-006`, `P-009`) (`S-005`).
- `R-008` — FY2018-FY2025 revenue / gross-margin bridge (carry-forward of `P-006`) (`S-001`, `S-007`, `S-017`).
- `R-009` — `S-018` (SENEA Class A daily OHLCV) is the master event-window dependency.
- `R-010` — Joint factor regression required to avoid double-counting between `E-007` and `E-010` (`S-018`, `S-019`, `S-021`).
- `R-011` — 13F-aggregate ownership concentration pre-/post-July-2023 to separate `E-001` from `E-011` (`S-018`, `S-020`).

**New (this report):**

- `U-001` — Per-ticker primary-source verification of every analog candidate in `analog-screen.csv` (each row is `unresolved-needs-primary-source-verification`). Mirror the SENEA workflow: 10-K balance sheet, proxy, IR coverage page, ETF / index membership, Item 5 buyback table, Item 1 'Business'.
- `U-002` — A price target is intentionally not produced. It should be computed in a downstream artifact once `F-002` and `F-003` close, using `valuationBridge.tangibleBookBridge` and `valuationBridge.ncavBridge` from `financial-rebuild.json`.
- `U-003` — A formal Fama-French / liquidity-factor variance decomposition of the SENEA discount is intentionally not produced because `S-018`, `S-019`, and `S-021` have not been retrieved (`R-009`, `R-010`).

---

**Reproducibility note.** All synthesis above is derived from the four upstream JSON artifacts and is reproducible by replaying their contents. The `final-investment-report.json` companion artifact carries the same content in structured form; the analog screen carries the same per-row evidence in `analog-screen.csv`. No external data was retrieved in producing this report.

**Disclaimer (restated).** This report is research output, not investment advice. It does not constitute a recommendation, solicitation, or offer to buy or sell SENEA or any other security listed in `analog-screen.csv`. Conclusions tagged `unresolved` or `partial` are not assertions of fact and should be reviewed against the primary sources enumerated above before any decision-relevant use.
