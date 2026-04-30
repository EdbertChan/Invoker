# SENEA Valuation & Accounting Claim Tests

- Task ID: `test-valuation-claims`
- Plan: `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- Upstream pack: `research/senea/claims-source-pack.json` (artifactStatus: `draft`)
- Source register: `research/senea/source-register.csv`
- Ticker: `SENEA` / `SENEB` (Seneca Foods Corporation, CIK 0000088948)
- Tested by: Claude (Opus 4.7), 2026-04-30
- Scope: Only the valuation/accounting claim family (C-001, C-002, C-003, C-004, C-008, plus the tax-recapture sub-claim implied by Plan section 4 "Attack asset value"). Industry, attribution, and governance claims (C-005, C-006, C-007, C-009, C-010, C-011) are out of scope for this artifact.

## Claim Family

This report tests the valuation and accounting claim family for Seneca Foods. Each member maps to a claim ID in the upstream source pack.

| Sub-claim | Claim ID | Plan anchor | Tested |
| --- | --- | --- | --- |
| Discount to tangible book (FIFO-adjusted) | C-001 | "valuation below tangible book" (Plan §1, §3) | yes |
| Discount to NCAV (FIFO-adjusted) | C-002 | "below NCAV" (Plan §1, §4) | yes |
| LIFO reserve magnitude | C-003 | "LIFO reserve, $359.3m" (Plan Quick Source Anchors) | yes |
| FIFO earnings power | C-003 | "FIFO vs LIFO earnings" (Plan §1, §5) | yes |
| Adjusted book value | C-001 / C-004 | "adjusted equity, tangible book" (Plan §3) | yes |
| Buyback-adjusted per-share compounding | C-004 / C-008 | "20-year book compounding", "buyback behavior" (Plan §1, §3) | yes |
| Tax recapture (LIFO deferred tax) | (sub-claim) | "deferred tax/LIFO recapture" (Plan §4) | yes |

## Verdict

**Family verdict:** `unresolved`.

**Confidence:** medium.

**Why this verdict:** The upstream source pack (`research/senea/claims-source-pack.json`) explicitly defers primary-source retrieval to downstream `financial-rebuild` and `industry-attack` tasks and notes that "this pack does not retrieve or quote the underlying source text." Two anchor data points from the FY2025 10-K (S-001) — the $359.3m LIFO reserve and the implied ~$89.5m LIFO deferred tax at a 24.9% statutory rate — are independently corroborated by web search results that cite the filing directly, and basic FY2025 balance-sheet aggregates are corroborated by a financial aggregator that summarizes the same filing. However, the comparison-to-market computations that this claim family depends on (price/tangible book, price/NCAV, 20-year per-share book CAGR, year-by-year buyback execution against beginning shares) require precise share-count, market-price, and time-series data that have not been retrieved from primary filings into this repository. Because Decision Gate 2 in the plan ("Seneca valuation only passes if both reported and FIFO-adjusted calculations reconcile to filings") is unmet, no spot-valuation claim is marked `passed`.

**Per-claim verdicts:**

| Sub-claim | Verdict | Reason |
| --- | --- | --- |
| Discount to tangible book (FIFO-adjusted) | `unresolved` | Goodwill / intangible split and contemporaneous market cap not retrieved from primary filings; aggregator data conflict on share count. |
| Discount to NCAV (FIFO-adjusted) | `unresolved` | Reported NCAV computable from aggregator data ($755.7m current assets minus $548.4m total liabilities ≈ $207m; FIFO-adjusted ≈ $566m), but precise market cap to compare against is not retrieved from primary filings. |
| LIFO reserve magnitude | `supported` | Plan anchor and 10-K text agree on $359.3m as of March 31, 2025 (S-001). |
| FIFO earnings power | `unresolved` | Existence of FIFO-adjusted earnings/EBITDA disclosure is asserted by the plan and source pack; the actual reconciliation table has not been retrieved (Q-005 explicitly open). |
| Adjusted book value | `unresolved` | Adjusted-equity formula is well-defined (book equity + LIFO reserve net of deferred tax − goodwill − intangibles), and aggregator data give a back-of-envelope figure (~$903m at March 31, 2025), but goodwill/intangible deduction is not pinned to filing text. |
| Buyback-adjusted per-share compounding | `unresolved` | At least one large buyback (March 2021 modified Dutch auction, ~1.45m Class A shares for ~$74.8m, ~17% of the relevant float) is publicly confirmed, and aggregator data show book value per share growing through FY2022; the full FY2005-FY2025 per-share series and the buyback ledger by year have not been rebuilt from filings. |
| Tax recapture (LIFO deferred tax) | `supported` | FY2025 10-K text states the LIFO reserve at the 24.9% statutory rate represents approximately $89.5m of income taxes "payment of which is delayed to future dates" — confirmed via web search citing the filing (S-001). |

## Evidence Table

| # | Sub-claim | Evidence | Source IDs | Source register row | Citation / URL | Direction |
| --- | --- | --- | --- | --- | --- | --- |
| E-01 | LIFO reserve magnitude | Plan Quick Source Anchors state Seneca FY2025 10-K discloses a $359.3m LIFO reserve. | S-001 | `research/senea/source-register.csv` row S-001 | SEC EDGAR SENEA Form 10-K FY2025 (CIK 0000088948), filing index `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K`; specific filing `https://www.sec.gov/Archives/edgar/data/88948/000143774925020197/senea20250331_10k.htm` | supports |
| E-02 | LIFO reserve magnitude | Web search (Claude WebSearch, 2026-04-30) cites the 10-K text: "As of March 31, 2025, Seneca Foods had a LIFO reserve of $359.3 million which, at the statutory tax rate of 24.9%, represents approximately $89.5 million of income taxes, payment of which is delayed to future dates based upon changes in inventory costs." | S-001 | row S-001 | Same filing as E-01 (`senea20250331_10k.htm`) | supports |
| E-03 | Tax recapture (LIFO deferred tax) | Same filing text quoted in E-02 implies $89.5m of deferred tax tied to LIFO at the 24.9% statutory rate; this is the "LIFO recapture" exposure if Seneca were to switch to FIFO or liquidate the inventory layer. | S-001 | row S-001 | Same filing as E-01 | supports |
| E-04 | Discount to NCAV (reported) | Stocktitan financials page (aggregator that summarizes the FY2025 10-K) reports total current assets $755.7m, total current liabilities $214.6m, total liabilities $548.4m, total stockholders' equity $633.0m, inventory $604.0m, cash $42.7m, accounts receivable $96.3m, long-term debt $369.9m, FY2025 net income $41.2m, FY2025 revenue ~$1.6b. Implied reported NCAV = $755.7m − $548.4m ≈ $207.3m. | S-001 (via aggregator) | row S-001 | `https://www.stocktitan.net/financials/SENEA/` (aggregator citing 10-K) | partial-support (computed metric, not market-comparison) |
| E-05 | Discount to NCAV (FIFO-adjusted) | Adding the $359.3m LIFO reserve gross to NCAV yields ~$566.6m; netting it for the 24.9% deferred tax in E-03 yields ~$477m FIFO-adjusted NCAV. | S-001 | row S-001 | Same as E-02 + E-04 | partial-support |
| E-06 | Discount to tangible book (FIFO-adjusted) | Reported stockholders' equity is ~$633.0m (E-04). Aggregator does not separately list goodwill or intangibles, consistent with Seneca historically carrying minimal goodwill, but this needs filing confirmation. Adding LIFO reserve net of deferred tax (≈$269.8m) gives an adjusted equity of ~$902.8m before goodwill/intangible deductions. | S-001 (via aggregator) | row S-001 | `https://www.stocktitan.net/financials/SENEA/` | partial-support |
| E-07 | FIFO earnings power | Plan and source pack assert that the FY2025 10-K discloses FIFO-adjusted earnings and FIFO EBITDA (Quick Source Anchors). Whether the reconciliation appears in the 10-K itself or only in supplemental investor materials is logged as open question Q-005. | S-001 | row S-001 | `senea20250331_10k.htm` (filing not yet quoted in repo) | indirect-support |
| E-08 | Buyback-adjusted per-share compounding (event level) | Seneca completed a Modified Dutch Auction tender in March 2021, repurchasing 1,449,339 shares of Class A common stock for approximately $74.81m at a clearing price of $51.62 per share, representing roughly 17.07% of the relevant float (per Seneca press releases and a tranche update on the June 11, 2021 plan). | S-001, S-005 | rows S-001, S-005 | Seneca press releases `https://www.senecafoods.com/press-release/seneca-foods-announces-expanded-share-repurchase-program`, `https://www.senecafoods.com/press-release/results-modified-dutch-auction-tender-offer`, GlobeNewswire `https://www.globenewswire.com/en/news-release/2021/03/10/2190435/32471/en/Seneca-Foods-Announces-Final-Results-of-Modified-Dutch-Auction-Tender-Offer.html`, MarketScreener tranche update `https://www.marketscreener.com/quote/stock/SENECA-FOODS-CORPORATION-10795/news/Tranche-Update-on-Seneca-Foods-Corporation-NasdaqGS-SENE-A-s-Equity-Buyback-Plan-announced-on-June-44148125/` | supports (single year, not 20-year series) |
| E-09 | Buyback-adjusted per-share compounding (book-value side) | Third-party (GuruFocus) tabulation of Seneca book value per share shows BVPS of $77.16 as of December 2022, with a stated 10-year average BVPS growth rate of 7.40% per year and a 5-year rate of 10.90%. This is consistent with positive per-share book compounding even before buyback adjustment, but does not span the full FY2005-FY2025 window. | S-001, S-007 | rows S-001, S-007 | `https://www.gurufocus.com/term/Book+Value+Per+Share/SENEB/Book-Value-per-Share/Seneca-Foods` (aggregator citing filings) | indirect-support |
| E-10 | Adjusted book value | The arithmetic in E-04, E-05, and E-06 is internally consistent with the source pack inputs but is not yet reconciled to the 10-K's own tangible-book or FIFO-adjusted equity disclosures (no such disclosure has been retrieved into the repo). | S-001 | row S-001 | Same as E-06 | indirect-support |

## Contrary Evidence

| # | Sub-claim | Contrary evidence | Source IDs | Citation / URL | Direction |
| --- | --- | --- | --- | --- | --- |
| CE-01 | Discount to tangible book / NCAV | Aggregator indications of recent (April 2026) market data show SENEA Class A price ~$134.71 with class-level market cap ~$911.6m, and SENEB Class B price ~$164.79 with class-level market cap ~$931.8m. Summed across classes, equity market value (~$1.8-1.9b) would be materially above both reported book equity (~$633m) and FIFO-adjusted equity (~$903m), which would falsify a current "below tangible book / below NCAV" claim. However, these aggregator figures conflict with each other (an earlier figure of 5,330,247 total shares appears in a separate search and is incompatible with two ~6.8m share classes), so they cannot be treated as authoritative without primary 10-K share-count and proxy ownership data. Net effect: the aggregator market-cap evidence pushes against a current discount, but the share-count contradiction means the contradiction itself is unresolved. | (none in register; tertiary market data) | `https://www.investing.com/equities/seneca-foods-corp-(a)`, `https://www.stocktitan.net/overview/SENEB/`, `https://companiesmarketcap.com/seneca-foods/shares-outstanding/` | weakens (but data quality unresolved) |
| CE-02 | Discount to tangible book / NCAV (historical context) | A prior third-party write-up ("Seneca Foods Stock Analysis" on Overlooked Alpha) characterizes Seneca as a "$276m company...trading below liquidation value." The $276m market cap referenced there is roughly an order of magnitude smaller than the current SENEA-only aggregator figure, which is consistent with a substantial re-rating between the write-up date and April 2026 and weakens the assumption that the discount-to-book frame is still active. | (tertiary research) | `https://www.overlookedalpha.com/p/seneca-foods-stock` | weakens (timing-dependent) |
| CE-03 | FIFO earnings power | FY2025 reported net income (~$41.2m, down ~35% YoY per aggregator) is consistent with management commentary in independent summaries that "a working-capital reversal, not a profit surge, powered cash generation" in FY2025, with inventory declining ~$268.7m. Net working-capital release can lift cash flow without lifting earnings power, which is the opposite of the claim that LIFO is the dominant understatement mechanic in FY2025. | (none in register; aggregator commentary) | `https://www.stocktitan.net/financials/SENEA/` | weakens FY2025 specifically; does not affect cycle-level claim |
| CE-04 | Buyback-adjusted per-share compounding | The 2021 Dutch tender was funded at $51.62/share. SENEA's recent (April 2026) trading price (~$134.71 Class A, ~$164.79 Class B) is materially above the tender clearing price, so the buyback-adjusted per-share compounding has happened in part by retiring shares at substantially below current market — which is supportive — but it also means a backward-looking IRR calculation depends on the holding window chosen, and a single-event buyback is not sufficient to substantiate a 20-year per-share compounding claim. | S-001, S-005, tertiary | E-08 sources | weakens generality of claim |
| CE-05 | Tax recapture | Whether the deferred-tax / LIFO-recapture liability would actually be triggered depends on a switch in inventory method or a true layer liquidation. Working-capital release (CE-03) reduces inventory dollars without necessarily liquidating a LIFO layer in tax terms, so the $89.5m figure should be treated as a maximum exposure rather than an imminent cash payment. | S-001 | E-02 source | qualifies (does not falsify) |

## Source Attribution

All source IDs below are taken from `research/senea/source-register.csv`. Where this artifact relies on a tertiary source (an aggregator or third-party write-up), it is flagged inline and is not treated as a primary citation.

| Source ID | Title | Used in this report for | Confidence (per register) |
| --- | --- | --- | --- |
| S-001 | Seneca Foods FY2025 10-K (LIFO accounting, $359.3m LIFO reserve, FIFO-adjusted earnings, FIFO EBITDA disclosures) | E-01, E-02, E-03, E-04, E-05, E-06, E-07, E-08, E-10 | high |
| S-005 | Seneca Foods FY2025 DEF 14A (dual-class share, voting, beneficial-ownership disclosures; buyback authorizations cross-referenced) | E-08 | high |
| S-007 | Seneca Foods historical 10-K and 10-Q filings (FY2005-FY2025) for balance-sheet and inventory reconstruction | E-09 (indirect via aggregator) | high |

Sources S-002, S-003, S-004, S-006, and S-008 are not used in this artifact because they cover index, industry, and coverage claims outside this family.

Tertiary references used (not in the source register, treated as supporting context only):

- StockTitan SENEA financials page (`https://www.stocktitan.net/financials/SENEA/`) and SENEB financials page (`https://www.stocktitan.net/financials/SENEB/`) — aggregator summary of the 10-K balance sheet.
- GuruFocus Seneca Foods Book Value per Share page (`https://www.gurufocus.com/term/Book+Value+Per+Share/SENEB/Book-Value-per-Share/Seneca-Foods`) — third-party time series.
- Investing.com (`https://www.investing.com/equities/seneca-foods-corp-(a)`) and CompaniesMarketCap (`https://companiesmarketcap.com/seneca-foods/shares-outstanding/`) — market-data aggregators used only for CE-01.
- Overlooked Alpha Seneca write-up (`https://www.overlookedalpha.com/p/seneca-foods-stock`) — third-party research note used only for CE-02.
- Seneca Foods press releases for the 2014 expanded repurchase program, the 2021 tender offer commencement, and the 2021 tender results, plus the GlobeNewswire and MarketScreener mirrors — these are issuer-published primary documents and would map to S-001/S-005 in a future register update.

A WebFetch attempt against SEC EDGAR (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K`) and the FY2025 10-K HTML (`senea20250331_10k.htm`) returned HTTP 403 from this environment, so direct line-item retrieval from the 10-K could not be performed inside this task. WebSearch returns that quote the filing were used as the closest available substitute for primary text on the LIFO reserve and tax-rate language.

## Open Questions

These build on Q-002 and Q-005 from the upstream source pack and add new gaps identified during this test.

| ID | Question | Blocks |
| --- | --- | --- |
| QV-001 | What are the goodwill and intangible-asset balances on the FY2025 10-K balance sheet (or are they zero)? Required to harden the tangible-book figure beyond aggregator inference. | C-001, adjusted book value |
| QV-002 | What is the precise FY2025 share count by class (Class A common, Class B common, any treasury) at the 10-K reporting date, and what is the contemporaneous market price for each class on the date used in the comparison? Required to compute price-to-tangible-book and price-to-NCAV. | C-001, C-002 |
| QV-003 | Does the FY2025 10-K (or the FY2025 proxy / supplemental investor materials) contain a management-prepared FIFO-adjusted earnings or FIFO EBITDA reconciliation table, and what are the line items? (Inherits open question Q-005 from the upstream pack.) | C-003 |
| QV-004 | What is the year-by-year buyback ledger from FY2005 through FY2025 (shares repurchased, dollar amount, average price), to evaluate "buyback-adjusted per-share compounding" beyond the single 2021 Dutch tender? | C-004, C-008 |
| QV-005 | What is Seneca's 20-year time series of book value per share (FY2005-FY2025), to compute a clean CAGR rather than relying on third-party 5- and 10-year figures? | C-004 |
| QV-006 | Is any portion of the $89.5m deferred LIFO tax already recognized as a deferred tax liability on the balance sheet, versus an unrecognized contingent obligation that would only crystallize on a method change or layer liquidation? | tax recapture |
| QV-007 | What is the maintenance-capex figure or proxy in the FY2025 10-K? Without it, the FIFO earnings power claim cannot be converted into a free-cash-flow base. (Inherits open question Q-002 from the upstream pack.) | C-003 |
| QV-008 | What is the dual-class voting structure's effect on the per-share book and earnings calculations, and does the FY2025 proxy quantify any preferred or restricted shares that should be excluded from the tangible-book denominator? (Cross-cuts open question Q-006.) | C-001, C-004 |
