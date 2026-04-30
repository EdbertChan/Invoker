# SENEA Claims & Source Pack

- Task ID: `source-pack`
- Plan: `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- Ticker: `SENEA` (Seneca Foods Corporation)
- Artifact status: `draft`
- Generated: 2026-04-30

This pack converts the SENEA Diligence plan's Quick Source Anchors and thesis claims into a machine-checkable claim ledger and a primary-source register. It is the upstream artifact for the `financial-rebuild`, `industry-attack`, and `attribution` tasks; pass/fail verification of each claim happens in those downstream tasks against retrieved primary sources.

## Claim Ledger

| Claim ID | Claim | Verification Method | Source IDs | Status | Next Artifact |
| --- | --- | --- | --- | --- | --- |
| C-001 | Seneca trades below tangible book value on a FIFO-adjusted basis. | Reconstruct tangible book value from the FY2025 10-K balance sheet, add the LIFO reserve to inventory, subtract goodwill/intangibles, and compare per-share equity to market price. | S-001, S-007 | pending | `artifacts/senea_metrics.csv` (`tangible_book_per_share`, `fifo_adjusted_book_per_share`) |
| C-002 | Seneca trades at or below NCAV when inventory is restated to FIFO. | Compute NCAV (current assets minus total liabilities) from the FY2025 10-K with and without the LIFO reserve restatement and compare to market cap. | S-001, S-007 | pending | `artifacts/senea_metrics.csv` (`ncav`, `ncav_fifo_adjusted`) |
| C-003 | Reported earnings materially understate FIFO earnings power because of a $359.3m LIFO reserve. | Pull the LIFO reserve and FIFO-adjusted earnings/EBITDA disclosures from the FY2025 10-K, reconcile to management's non-GAAP bridge, and recompute FIFO net income across cycles. | S-001 | pending | `artifacts/senea_metrics.csv` (`lifo_reserve`, `fifo_net_income`, `fifo_ebitda`) |
| C-004 | Seneca has compounded book value per share over a 20-year window despite minimal sell-side coverage. | Rebuild diluted share count and book value per share from 10-Ks across FY2005-FY2025 and compute CAGR. | S-001, S-002, S-007 | pending | `artifacts/senea_metrics.csv` (`book_value_per_share_history`) |
| C-005 | U.S. private-label vegetable canning is an oligopoly in which Seneca and Lakeside Foods together account for ~90% of supply. | Cross-check the Lakeside public statement against Seneca 10-K segment disclosures and any third-party industry data; confirm the cited 90% figure and identify the second named competitor. | S-004, S-001 | pending | `artifacts/industry_structure.json` (`private_label_share_table`) |
| C-006 | Del Monte Pacific deconsolidated its U.S. Del Monte Foods business effective May 2025 and that subsidiary subsequently filed for Chapter 11, removing destructive private-label competition. | Verify the deconsolidation and discontinued-operations classification in Del Monte Pacific's FY2025 annual report and confirm the U.S. Chapter 11 filing via court docket or company press release. | S-003, S-008 | pending | `artifacts/industry_structure.json` (`delmonte_event_timeline`) |
| C-007 | SENEA was deleted from the S&P SmallCap 600 in July 2023, producing forced selling pressure independent of fundamentals. | Confirm the deletion via the S&P Dow Jones Indices announcement and reconcile the effective date with index ETF rebalance flows; tie to event-study windows. | S-002 | pending | `artifacts/event_study.csv` (`sp600_deletion_window`) |
| C-008 | Seneca has executed material share repurchases relative to float, supporting per-share compounding. | Tabulate buyback authorizations and executions from 10-K Item 5/Item 7 disclosures and proxy statements; compute net repurchase as a percentage of beginning shares outstanding. | S-001, S-005 | pending | `artifacts/senea_metrics.csv` (`buyback_history`) |
| C-009 | Seneca has minimal sell-side analyst coverage, contributing to the discount. | Pull active-coverage analyst counts from Seneca IR disclosures and consensus-estimate vendors; document the absence of formal sell-side reports. | S-006 | pending | `artifacts/coverage_register.json` |
| C-010 | Seneca operates a dual-class share structure with concentrated insider/family voting control. | Read the FY2025 DEF 14A and 10-K share-class disclosures; document Class A vs Class B voting rights and beneficial ownership of insiders. | S-005, S-001 | pending | `artifacts/governance_register.json` |
| C-011 | Seneca has demonstrated pricing-cost recovery across crop, steel/tinplate, freight, and labor cycles. | Decompose revenue and gross profit across FY2018-FY2025 into price, volume, mix, and input-cost components using 10-K MD&A commentary; confirm directional consistency with industry indices. | S-001 | pending | `artifacts/senea_metrics.csv` (`price_cost_bridge`) |

## Source Register

| Source ID | Title | Publisher | URL or Citation | Source Type | Used For | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| S-001 | Seneca Foods FY2025 Form 10-K (LIFO accounting, $359.3m LIFO reserve, FIFO-adjusted earnings, FIFO EBITDA disclosures) | Seneca Foods Corporation / U.S. SEC | SEC EDGAR filing index for SENEA, Form 10-K covering fiscal year ended March 2025 (to be retrieved from `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K`) | primary-filing | C-001, C-002, C-003, C-004, C-005, C-008, C-010, C-011 | high |
| S-002 | S&P Dow Jones Indices announcement of the July 2023 deletion of SENEA from the S&P SmallCap 600 | S&P Dow Jones Indices | S&P Dow Jones Indices index-action press release archive, July 2023 SmallCap 600 rebalance (to be retrieved from `https://www.spglobal.com/spdji/en/index-announcements/`) | index-notice | C-004, C-007 | high |
| S-003 | Del Monte Pacific FY2025 annual report and results materials describing the U.S. Del Monte Foods business as discontinued operations, deconsolidated effective May 2025 | Del Monte Pacific Limited (SGX/PSE listed) | Del Monte Pacific FY2025 annual report and SGX/PSE disclosure filings (to be retrieved from `https://www.delmontepacific.com/investors`) | primary-filing | C-006 | high |
| S-004 | Lakeside Foods public materials referencing the quote that Lakeside and one other competitor account for ~90% of U.S. private-label vegetable canning | Lakeside Foods, Inc. (corporate communications / interview transcript) | Lakeside Foods website and quoted industry interview material (to be archived as cited in the plan's Quick Source Anchors section) | industry-statement | C-005 | medium |
| S-005 | Seneca Foods FY2025 proxy statement (DEF 14A) with dual-class share, voting, and beneficial-ownership disclosures | Seneca Foods Corporation / U.S. SEC | SEC EDGAR DEF 14A for SENEA covering FY2025 (to be retrieved from `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=DEF+14A`) | primary-filing | C-008, C-010 | high |
| S-006 | Seneca Foods Investor Relations coverage page and consensus-estimate vendor coverage records | Seneca Foods IR / consensus-estimate vendor | Seneca Foods IR coverage page (`https://investor.senecafoods.com`) cross-referenced against a consensus-estimate vendor | issuer-disclosure | C-009 | medium |
| S-007 | Seneca Foods historical 10-K and 10-Q filings (FY2005-FY2025) for balance-sheet and inventory reconstruction | Seneca Foods Corporation / U.S. SEC | SEC EDGAR filing index for SENEA historical 10-K and 10-Q filings (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10`) | primary-filing | C-001, C-002, C-004 | high |
| S-008 | Del Monte Foods (U.S.) Chapter 11 bankruptcy filing and supporting docket records | U.S. Bankruptcy Court (PACER docket) / Del Monte Foods press release | PACER bankruptcy docket for the Del Monte Foods (U.S.) Chapter 11 case and corresponding press release (to be retrieved from PACER and the Del Monte Foods newsroom) | court-record | C-006 | high |

## Attribution Notes

- The Quick Source Anchors block in the plan is the source of truth for which anchors must appear in this pack: Seneca FY2025 10-K with the $359.3m LIFO reserve (S-001), the July 2023 S&P SmallCap 600 deletion (S-002), Del Monte Pacific's FY2025 deconsolidation of the U.S. business and the subsequent Chapter 11 (S-003, S-008), and the Lakeside ~90% private-label vegetable canning quote (S-004). All four anchors are represented and mapped to at least one claim.
- Confidence ratings are based on the documentary character of each source. Primary filings (10-K, DEF 14A, foreign-issuer annual report, court docket) are rated `high`. The Lakeside private-label market-share quote (S-004) and the analyst-coverage signal (S-006) are rated `medium` because they rely on corporate communications or third-party aggregation rather than audited filings; downstream tasks must triangulate them.
- This pack does not retrieve or quote the underlying source text. URLs and citation paths are pointers for the `fetch_sec_filings.py` and equivalent retrieval scripts referenced in the plan's Verification Commands section. Pass/fail verification of each claim is intentionally deferred to those downstream scripts so that the memo gate (Gate 1) can refuse any claim lacking a retrieved artifact.
- Where a single claim depends on more than one source (for example C-006 requires both Del Monte Pacific's annual report and the U.S. Chapter 11 docket), both source IDs are listed and both must resolve before the claim can move from `pending` to `passed`.
- The `usedFor` field on each source mirrors the `sourceIds` field on each claim. The two are intended to be cross-checked programmatically; a CI step in the downstream task should fail if any claim cites a source that is not in the register or vice versa.

## Open Diligence Gaps

- Q-001: Which specific competitor does Lakeside name alongside itself in the ~90% private-label vegetable canning quote, and is that competitor Seneca or a third party? (Blocks C-005.)
- Q-002: Does the Seneca FY2025 10-K disclose a maintenance-capex figure or a useful proxy, or does the financial rebuild need to derive it from PP&E roll-forwards? (Blocks C-003, C-011.)
- Q-003: What is the precise effective date of the S&P SmallCap 600 deletion in July 2023, and which constituent index ETFs rebalanced on that date? (Blocks C-007.)
- Q-004: Which entity (Del Monte Foods Inc. or Del Monte Foods Holdings) filed Chapter 11, and how does that map to Del Monte Pacific's deconsolidated U.S. business? (Blocks C-006.)
- Q-005: Are management's FIFO-adjusted earnings and FIFO EBITDA reconciled in the FY2025 10-K itself, or only in supplemental investor materials? (Blocks C-003.)
- Q-006: Does the FY2025 proxy quantify combined Class A/Class B voting power held by the founding family/insiders sufficiently to support the dual-class control claim without further estimation? (Blocks C-010.)
- General gap: This pack treats every claim as `pending` because no primary source has been retrieved yet. The financial-rebuild and industry-attack tasks must update both this Markdown report and the JSON sibling once retrieval and verification produce pass/fail outcomes.
