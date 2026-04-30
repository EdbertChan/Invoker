# SENEA Financial Rebuild with Attribution

- Task ID: `rebuild-financials-with-attribution`
- Plan: `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- Upstream artifacts: `research/senea/claims-source-pack.md`, `research/senea/claims-source-pack.json`, `research/senea/source-register.csv`
- Ticker: `SENEA` (Seneca Foods Corporation, fiscal year ended March 2025 = "FY2025")
- Artifact status: `draft`
- Generated: 2026-04-30

This artifact rebuilds Seneca's FY2025 reported, FIFO-adjusted pre-tax, and FIFO-adjusted after-tax financial picture from the source pack produced in the upstream `build-claims-source-pack` task. Each material metric is mapped to one or more source IDs from the upstream register (`S-001` … `S-008`) plus the new IDs registered below (`S-009`, `S-010`, `S-011`). Numeric values that are anchored verbatim in the source plan (notably the **$359.3m FY2025 LIFO reserve** disclosed in the Seneca FY2025 10-K, `S-001`) are reported as `anchored`. Values that require retrieval from a primary source not yet quoted in the upstream pack are reported as `pending` with the exact source path and rebuild method specified, so that downstream verification can resolve each line without re-deriving the methodology.

## Executive Summary

Seneca's FY2025 LIFO reserve of **$359.3m** (anchor `S-001`, claim `C-003`) is the central distortion in the company's reported financials. Restating year-end inventory from LIFO to FIFO mechanically increases inventory by $359.3m on the balance sheet (claim `C-001`), which lifts both stockholders' equity (net of deferred tax) and net current assets used in the NCAV computation (claim `C-002`). On the income statement, the year-on-year change in the LIFO reserve is the LIFO charge that gets added back to compute FIFO-adjusted EBITDA and FIFO-adjusted net earnings (claim `C-003`). Together with material share repurchases (claim `C-008`) and a multi-decade history of book-value compounding (claim `C-004`), these adjustments are the mechanical drivers of the value-vs-price gap that the SENEA Diligence plan asks us to test.

This artifact is `draft` because the only numeric value quoted verbatim in the upstream source plan is the $359.3m LIFO reserve. The reported income, balance-sheet, capital-allocation, and per-share compounding figures cannot be verified without retrieving the FY2025 10-K (`S-001`), the historical 10-K series (`S-007`), the FY2025 proxy (`S-005`), and a market-price reference for SENEA Class A common stock as of the rebuild date (`S-009`). Each unresolved line below documents the exact filing, item/section, and computation that will resolve it once retrieval succeeds.

## Source Attribution

This rebuild relies on the upstream source register (`research/senea/source-register.csv`) plus three new sources introduced specifically for the rebuild:

| Source ID | Title | Publisher | URL or Citation | Source Type | Used For | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| S-001 | Seneca Foods FY2025 Form 10-K (LIFO accounting, $359.3m LIFO reserve, FIFO-adjusted earnings, FIFO EBITDA disclosures) | Seneca Foods Corporation / U.S. SEC | SEC EDGAR filing index for SENEA, Form 10-K for fiscal year ended March 2025 (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K`) | primary-filing | LIFO reserve, LIFO charge, reported income statement, balance sheet, segment data, buyback disclosures (Item 5 / Item 7), debt footnote | high |
| S-005 | Seneca Foods FY2025 proxy statement (DEF 14A) | Seneca Foods Corporation / U.S. SEC | SEC EDGAR DEF 14A for SENEA covering FY2025 (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=DEF+14A`) | primary-filing | Beneficial ownership, dual-class voting, equity compensation disclosures used to confirm net buyback against issuance | high |
| S-007 | Seneca Foods historical 10-K and 10-Q filings (FY2005–FY2025) | Seneca Foods Corporation / U.S. SEC | SEC EDGAR filing index for SENEA historical 10-K and 10-Q filings (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10`) | primary-filing | 20-year book-value-per-share rebuild and per-share compounding CAGR | high |
| S-009 | SENEA Class A common stock closing price as of the rebuild reference date | NYSE / consolidated market data vendor | SENEA Class A closing price on or near 2026-04-30 (to be retrieved from a consolidated market data feed; archive snapshot required) | market-data | Per-share comparisons (price vs. tangible book, price vs. NCAV, price vs. FIFO-adjusted equity) | medium |
| S-010 | U.S. federal corporate statutory income tax rate (21%) and SENEA's most recent effective tax rate per FY2025 10-K | Internal Revenue Code § 11 / Seneca Foods FY2025 10-K (cross-reference to S-001) | IRC § 11 (`https://www.law.cornell.edu/uscode/text/26/11`) and SENEA FY2025 10-K Note "Income Taxes" effective-rate reconciliation | statute / primary-filing | After-tax LIFO adjustment (used to convert FIFO pre-tax bridges into FIFO after-tax bridges and to compute the deferred-tax offset on the LIFO reserve add-back to equity) | high |
| S-011 | SENEA Class A and Class B shares outstanding as of the FY2025 10-K cover page and most recent quarterly filing | Seneca Foods Corporation / U.S. SEC (subset of S-001 and S-007) | FY2025 10-K cover page share counts and most recent 10-Q cover page (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948`) | primary-filing | Per-share denominators for tangible book per share, FIFO-adjusted book per share, NCAV per share, and 20-year compounding history | high |

`S-002`, `S-003`, `S-004`, `S-006`, and `S-008` from the upstream pack are not directly used by this financial rebuild but remain referenced in the upstream claim ledger; they are tested by the parallel `industry-attack` and `attribution` tasks rather than here.

## LIFO/FIFO Reconciliation

Seneca reports inventory on a LIFO basis. Under U.S. GAAP, companies that use LIFO must disclose a "LIFO reserve" — the cumulative excess of FIFO inventory cost over LIFO inventory cost. The SENEA Diligence plan's Quick Source Anchors record this reserve at **$359.3m** for FY2025 (`S-001`, claim `C-003`).

Three reconciling steps convert reported LIFO figures to FIFO-equivalent figures:

1. **Inventory restatement (balance sheet).** Add the year-end LIFO reserve back to inventory:
   - `FIFO inventory = LIFO inventory (reported) + LIFO reserve`
   - For FY2025, the FIFO inventory adjustment equals **$359.3m** (anchored, `S-001`).
2. **LIFO charge add-back (income statement, pre-tax).** Cost of goods sold under LIFO includes the period-over-period change in the LIFO reserve. To convert reported pre-tax income to a FIFO basis, add back this charge:
   - `LIFO charge_FY2025 = LIFO reserve_FY2025 − LIFO reserve_FY2024`
   - `Pre-tax income_FIFO = Pre-tax income_LIFO + LIFO charge`
   - The FY2025 LIFO reserve is anchored at $359.3m (`S-001`); the FY2024 reserve required to compute the charge is `pending` retrieval from the same 10-K (the comparative year on the LIFO note will sit alongside the FY2025 figure; alternatively a five-year reserve series is typically disclosed in MD&A).
3. **Tax effect (income statement, after-tax).** The LIFO charge add-back is pre-tax. The after-tax FIFO bridge multiplies by `(1 − effective tax rate)`:
   - `Net income_FIFO = Net income_LIFO + LIFO charge × (1 − t)`
   - `t` is taken from the FY2025 effective-tax-rate reconciliation in the 10-K's "Income Taxes" note (`S-001`, anchor reinforced by `S-010`). The 21% U.S. federal statutory rate (`S-010`) is the floor; the blended effective rate including state taxes is the rebuild value used.

The same `(1 − t)` factor governs the deferred-tax offset on the equity add-back used in the Asset Value Bridge below: the gross LIFO reserve is added back to equity net of the deferred tax liability that would crystallize on a FIFO restatement, i.e. `Equity adjustment = LIFO reserve × (1 − t)`.

| Reconciliation line | FY2025 value | Status | Source |
| --- | --- | --- | --- |
| LIFO reserve (year-end) | $359.3m | anchored | S-001 (verbatim in plan Quick Source Anchors) |
| LIFO reserve (prior year-end, FY2024) | pending | pending | S-001 (LIFO note / MD&A 5-year reserve series) |
| LIFO charge (FY2025 ΔLIFO reserve) | pending | pending | S-001 (computed: FY2025 − FY2024) |
| Effective tax rate `t` | pending | pending | S-001 ("Income Taxes" note); floor 21% per S-010 |
| FIFO inventory adjustment (gross) | $359.3m | anchored | S-001 |
| FIFO inventory adjustment (after-tax for equity) | pending | pending | S-001 × (1 − t), `t` per S-001 / S-010 |

## Asset Value Bridge

The Asset Value Bridge restates the GAAP balance sheet to a FIFO basis and isolates two value benchmarks: tangible book and net current asset value (NCAV).

**Tangible book bridge (per claim `C-001`).**

```
Reported stockholders' equity                                    [pending — S-001 balance sheet]
  − Goodwill                                                     [pending — S-001 balance sheet]
  − Other intangible assets                                      [pending — S-001 balance sheet]
= Tangible book value (reported)                                 [pending]
  + LIFO reserve × (1 − t)        [FIFO add-back, after deferred tax offset]
= FIFO-adjusted tangible book value                              [pending; LIFO reserve = $359.3m anchored, S-001]
÷ Diluted Class A + Class B shares outstanding (S-011)
= FIFO-adjusted tangible book per share                          [pending]
```

The pre-tax variant of the same bridge (used as an upper bound) substitutes `+ LIFO reserve` (gross $359.3m) for the after-tax line. Both are reported in the metrics CSV.

**NCAV bridge (per claim `C-002`).**

```
Total current assets                                             [pending — S-001 balance sheet]
  − Total liabilities                                            [pending — S-001 balance sheet, all current + long-term]
= NCAV (reported, LIFO basis)                                    [pending]
  + LIFO reserve × (1 − t)        [FIFO restatement of inventory inside current assets]
= NCAV (FIFO-adjusted, after-tax)                                [pending]
÷ Class A + Class B shares outstanding (S-011)
= NCAV per share (FIFO-adjusted)                                 [pending]
```

The pre-tax NCAV variant adds the gross $359.3m LIFO reserve (anchored, `S-001`); the after-tax variant nets out the deferred tax. Both are reported in the metrics CSV under `fifo_adjusted_pretax` and `fifo_adjusted_aftertax` columns.

**Market-price comparison.** Per-share book and NCAV figures are compared to the SENEA Class A market price retrieved as `S-009` (rebuild reference date 2026-04-30). The price-to-FIFO-adjusted-tangible-book ratio and the price-to-FIFO-adjusted-NCAV ratio are the two primary outputs that test claims `C-001` and `C-002`.

## Earnings Power Bridge

The Earnings Power Bridge restates reported earnings to FIFO and reports the bridge separately on a pre-tax and after-tax basis (per claim `C-003`).

**Reported EBITDA → FIFO EBITDA (pre-tax).**

```
Reported operating income                                        [pending — S-001 consolidated income statement]
  + Depreciation and amortization                                [pending — S-001 cash-flow statement]
= Reported EBITDA                                                [pending]
  + LIFO charge (FY2025 ΔLIFO reserve)                          [pending — S-001 LIFO note]
= FIFO-adjusted EBITDA (pre-tax)                                 [pending]
```

**Reported net earnings → FIFO net earnings (after-tax).**

```
Reported net earnings (LIFO basis)                               [pending — S-001 income statement]
  + LIFO charge × (1 − effective tax rate)                       [pending — S-001 income tax note + S-010]
= FIFO-adjusted net earnings (after-tax)                         [pending]
÷ Diluted Class A + Class B shares outstanding (S-011)
= FIFO-adjusted EPS (after-tax)                                  [pending]
```

The metrics CSV records `reported`, `fifo_adjusted_pretax`, and `fifo_adjusted_aftertax` for each line so the three vintages of the same number stay separated. Where the FY2025 10-K itself contains a management-disclosed FIFO bridge (open question `Q-005` in the upstream pack), the rebuild numbers are reconciled to that bridge inside the 10-K and any residual is flagged as a reconciling item rather than absorbed.

**Cycle-aware earnings.** Because the LIFO charge is volatile across crop, steel/tinplate, and freight cycles (claim `C-011`), the rebuild also computes a multi-year FIFO-adjusted EBITDA series. That historical series is `pending` retrieval of the FY2018–FY2024 LIFO reserve disclosures via `S-007`; the FY2025 figure is the only year where the LIFO reserve is anchored from the plan.

## Capital Allocation

Capital allocation is the third pillar of the value rebuild because per-share compounding (claim `C-004`) and the ability to absorb LIFO-driven earnings volatility both depend on the buyback / debt-paydown balance.

**Share repurchases (claim `C-008`).** The rebuild tabulates:
- Cumulative authorized buyback program size (10-K Item 5 and proxy disclosures, `S-001` / `S-005`).
- Shares repurchased and average price paid by fiscal year FY2018–FY2025 (10-K Item 5, `S-001`; historical years via `S-007`).
- Net buyback as a percentage of beginning Class A + Class B shares outstanding (computed from `S-011`).
- Net buyback after netting equity-compensation issuance (proxy and Item 12 of 10-K, `S-005` / `S-001`).

All buyback line items are `pending` until the FY2025 10-K Item 5 table and the FY2025 proxy are retrieved.

**Net debt (claim `C-001` interaction).** Net debt is computed at fiscal year-end as:
```
Net debt = (Short-term debt + Current portion of long-term debt + Long-term debt + Finance leases) − (Cash + Marketable securities)
```
Each component is taken from the FY2025 consolidated balance sheet and the long-term debt footnote in the 10-K (`S-001`). This number feeds the enterprise-value-based comparison against FIFO-adjusted EBITDA (Earnings Power Bridge) and is `pending` retrieval.

**Per-share compounding (claim `C-004`).** The rebuild constructs a FY2005 → FY2025 series for:
- Reported book value per share (LIFO basis).
- FIFO-adjusted book value per share (LIFO reserve add-back, after-tax).
- Tangible book value per share (FIFO basis).
- Diluted Class A + Class B shares outstanding.

CAGR is computed end-to-end across the 20-year window. The series is `pending` retrieval of the historical 10-K filings via `S-007`; the FY2025 endpoint depends on the same `S-001` retrieval driving the rest of the rebuild. The plan claims a positive 20-year CAGR despite the July 2023 S&P SmallCap 600 deletion (`C-004`, `C-007`); confirming that hinges entirely on the historical retrieval.

## Open Financial Diligence Gaps

The following gaps must be closed by retrieving the cited filings and refreshing this artifact from `draft` to `verified`:

- **F-001:** Retrieve the FY2025 10-K (`S-001`) and extract the prior-year LIFO reserve from the LIFO note so the FY2025 LIFO charge can be computed. Blocks claim `C-003`. Carries forward upstream open question `Q-005` (whether management's own FIFO bridge appears in the 10-K or only in supplemental investor materials).
- **F-002:** Retrieve the FY2025 10-K's "Income Taxes" note (`S-001`) for the effective tax rate used in after-tax conversions. Blocks all `fifo_adjusted_aftertax` columns; floor is the 21% statutory rate (`S-010`).
- **F-003:** Retrieve the FY2025 consolidated balance sheet from the 10-K (`S-001`) for reported equity, goodwill, intangibles, total current assets, total liabilities, debt components, and cash/marketable securities. Blocks all of `tangible_book`, `ncav`, and `net_debt` lines; blocks claims `C-001` and `C-002`.
- **F-004:** Retrieve FY2025 Item 5 of the 10-K (`S-001`) and the FY2025 DEF 14A (`S-005`) for the buyback / equity-issuance reconciliation. Blocks claim `C-008`.
- **F-005:** Retrieve FY2005–FY2024 10-K filings (`S-007`) for the 20-year per-share compounding rebuild. Blocks claim `C-004`.
- **F-006:** Capture an archived SENEA Class A closing-price datapoint (`S-009`) on or near the rebuild reference date (2026-04-30) for per-share market comparisons. Blocks the price-to-book and price-to-NCAV outputs.
- **F-007:** Confirm the cover-page share counts on the FY2025 10-K and the most recent 10-Q (`S-011`) so the Class A and Class B share denominators reconcile across the asset-value, earnings-power, and per-share-compounding bridges. Blocks every per-share metric.
- **F-008:** Carry-forward upstream open question `Q-002` — does the FY2025 10-K disclose a maintenance-capex figure or proxy, or must the rebuild derive it from the PP&E roll-forward? Blocks the FIFO-adjusted free-cash-flow extension of the Earnings Power Bridge (claims `C-003`, `C-011`).

Until these gaps close, the rebuild stands as a methodologically complete scaffold anchored on the single quoted figure ($359.3m FY2025 LIFO reserve, `S-001`) and the source-plan attributions described above. Downstream tasks must update both this Markdown report and its JSON sibling (`research/senea/financial-rebuild.json`) once retrieval converts each `pending` line to `verified`.
