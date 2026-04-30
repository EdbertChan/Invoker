# Del Monte Conduct-Change Claim Test

- Task: `test-delmonte-change-claims`
- Ticker: `SENEA` (Seneca Foods Corporation)
- Claim family: Del Monte conduct change (price aggression -> retrenchment -> deconsolidation -> Chapter 11)
- Plan: `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- Inputs: `research/senea/claims-source-pack.json`, `research/senea/source-register.csv`
- Generated: 2026-04-30
- Test status: `partial` (deconsolidation and Chapter 11 supported by anchors in the source pack; pre-2025 sub-claims are `unresolved` because no retrieved primary source backs them in the pack)

## Claim Family

The "Del Monte conduct change" family describes the multi-year sequence in which Del Monte Foods (the U.S. canned-fruit, vegetable, and tomato business that competes with Seneca in private-label and branded canned vegetables) is alleged to have moved from aggressive price competition under a 2014 ownership change through restructuring, plant rationalization, and a private-label retreat into May 2025 deconsolidation by Del Monte Pacific Limited and a subsequent Chapter 11 filing. The economic significance for SENEA is that this sequence is the mechanism behind the plan's Gate 3: "the oligopoly thesis only passes if competitor behavior/capacity evidence supports improved market structure after Del Monte's change in conduct" (`senea_diligence_05efbabd.plan.md`, Decision Gates).

The parent ledger claim in the source pack is `C-006`, sourced to `S-003` (Del Monte Pacific FY2025 annual report) and `S-008` (Del Monte Foods (U.S.) Chapter 11 docket). The other sub-claims tested below (2014 ownership change, price aggression, Sager Creek, restructuring, plant closures/sales, private-label retreat) are not assigned source IDs in the existing pack, so this report flags them as evidence gaps rather than treating them as verified.

## Verdict

- Family-level verdict: `partially_supported` with `unresolved` sub-claims.
- Confidence: `medium` (the two terminal events are anchored to primary-filing and court-record sources, but neither source has been retrieved into a verified artifact, and the pre-2025 conduct sub-claims have no source IDs in the existing pack).
- Decision-gate impact: Gate 3 (improved market structure after Del Monte's change in conduct) cannot be cleared from this artifact alone. Gate 1 (no claim enters the memo without a source artifact and deterministic verification result) is also not yet satisfied because the underlying primary sources are still listed as `pending` retrieval in `claims-source-pack.json`.

| Sub-claim ID | Sub-claim | Verdict | Confidence | Sources cited |
| --- | --- | --- | --- | --- |
| DMC-01 | Del Monte Foods (U.S.) underwent a 2014 ownership change in which it was acquired from a U.S. parent by Del Monte Pacific Limited. | `unresolved` | `low` | None in pack |
| DMC-02 | Following the ownership change Del Monte Foods pursued aggressive private-label and branded price competition in canned vegetables. | `unresolved` | `low` | None in pack |
| DMC-03 | Del Monte's acquisition of Sager Creek Vegetable Company produced operating, integration, or write-down issues. | `unresolved` | `low` | None in pack |
| DMC-04 | Del Monte Foods executed multi-year restructuring programs (cost reduction, write-downs, refinancings) prior to deconsolidation. | `unresolved` | `low` | None in pack |
| DMC-05 | Del Monte closed or sold canned-vegetable and related plants as part of capacity rationalization. | `unresolved` | `low` | None in pack |
| DMC-06 | Del Monte retreated from destructive private-label vegetable canning competition. | `unresolved` | `low` | None in pack (general direction implied by S-003/S-008 but not explicit in the source pack as currently scoped) |
| DMC-07 | Del Monte Pacific deconsolidated its U.S. Del Monte Foods business effective May 2025 and classified it as discontinued operations. | `supported_by_anchor` | `medium` | S-003 (parent claim C-006) |
| DMC-08 | The deconsolidated U.S. Del Monte Foods entity filed for Chapter 11 in U.S. Bankruptcy Court. | `supported_by_anchor` | `medium` | S-008 (parent claim C-006) |

`supported_by_anchor` means the claims-source-pack lists a primary source for the assertion and the plan's Quick Source Anchors block restates the assertion, but the underlying filing/docket has not yet been retrieved or quoted in this repo. Per the plan's Gate 1, that retrieval is required before the claim can move from `pending` to `passed`.

## Del Monte Timeline

The timeline below is the Del Monte conduct-change narrative under test. Only rows with a non-empty Source IDs cell can be cited from the existing pack; other rows are scaffolding for downstream retrieval tasks and are explicitly flagged `unresolved`.

| Date / window | Event under test | Status in this test | Source IDs |
| --- | --- | --- | --- |
| 2014 (calendar) | Del Monte Pacific Limited acquires the U.S. Del Monte Foods consumer-products business from a prior U.S. parent. | `unresolved` (no source ID in pack) | (none) |
| 2014-2017 | Post-acquisition pricing strategy in U.S. canned vegetables (alleged price aggression / private-label share grab). | `unresolved` (no source ID in pack) | (none) |
| 2015 | Del Monte Foods acquires Sager Creek Vegetable Company (Allens canned-vegetable assets). | `unresolved` (no source ID in pack) | (none) |
| 2017-2024 | Multi-year restructuring, refinancings, asset write-downs, and capacity rationalization at Del Monte Foods. | `unresolved` (no source ID in pack) | (none) |
| 2017-2024 | Plant closures or sales tied to canned-vegetable rationalization. | `unresolved` (no source ID in pack) | (none) |
| 2024-2025 | Strategic retreat from destructive private-label vegetable canning competition. | `unresolved` (no source ID in pack) | (none) |
| May 2025 | Del Monte Pacific Limited classifies the U.S. Del Monte Foods business as discontinued operations and deconsolidates effective May 2025. | `supported_by_anchor` | S-003 |
| 2025 (post-deconsolidation) | The deconsolidated U.S. Del Monte Foods entity files for Chapter 11. | `supported_by_anchor` | S-008 |

## Evidence Table

| Sub-claim ID | Source ID | Source title | Source type | Citation pointer | Confidence | Evidence treatment |
| --- | --- | --- | --- | --- | --- | --- |
| DMC-07 | S-003 | Del Monte Pacific Limited FY2025 annual report and FY2025 results materials describing classification of the U.S. Del Monte Foods business as discontinued operations and deconsolidation effective May 2025. | primary-filing | Del Monte Pacific FY2025 annual report and SGX/PSE disclosure filings (`https://www.delmontepacific.com/investors`). | high | Anchor cited in the plan's Quick Source Anchors block; primary filing not yet retrieved into the repo, so verdict is `supported_by_anchor` rather than `passed`. |
| DMC-08 | S-008 | Del Monte Foods (U.S.) Chapter 11 bankruptcy filing and supporting docket records. | court-record | PACER bankruptcy docket for Del Monte Foods (U.S.) Chapter 11 case and corresponding press release (PACER + Del Monte Foods newsroom). | high | Anchor cited in the plan's Quick Source Anchors block; docket not yet retrieved into the repo, so verdict is `supported_by_anchor` rather than `passed`. |
| DMC-06 (indirect) | S-003 + S-008 | (see above) | primary-filing + court-record | (see above) | medium | Deconsolidation and Chapter 11 are consistent with a private-label retreat hypothesis but neither source in the pack has been retrieved or quoted on private-label exit specifically; treat as indirect inference, not direct citation. |
| DMC-01..DMC-05 | (none) | (none in pack) | n/a | n/a | low | No source ID is assigned in `claims-source-pack.json` for the 2014 ownership change, price aggression, Sager Creek, restructuring, or plant closures/sales sub-claims. Verdicts are `unresolved` per the acceptance rule that missing evidence forces `unresolved`. |

## Contrary Evidence

This test deliberately surfaces contrary signals so the bear memo (plan task 9) can be written cleanly later.

- The deconsolidation and Chapter 11 events at the U.S. Del Monte Foods entity do not by themselves prove that destructive private-label competition has stopped: a Chapter 11 reorganization frequently preserves operating capacity and customer contracts under new ownership. The pack does not contain a source for post-petition operating-plan disclosures, asset-purchase agreements, or stalking-horse bids that would resolve whether the vegetable-canning capacity is being shut down or transferred.
- Improved market structure for SENEA also requires that other private-label competitors (notably Lakeside Foods, addressed under `C-005` and source `S-004`) do not absorb Del Monte's prior volume on aggressive terms. That cross-competitor dynamic is out of scope for this test but is a contrary risk to flag.
- The 2014 ownership-change sub-claim, even if confirmed externally, does not by itself imply price aggression. Prior literature also frames Del Monte Pacific's strategy as branded-share defense rather than private-label expansion. Without `S-003` or comparable filings retrieved into the repo, this test cannot adjudicate which framing applies and therefore leaves DMC-01 and DMC-02 `unresolved`.
- The plan's Gate 1 explicitly requires a retrieved source artifact before any claim is admitted to the final memo. Two of the eight sub-claims here rely on anchors only (DMC-07 and DMC-08), and the rest rely on no source at all. The contrary-evidence position is therefore that the family should not yet be admitted to the verdict memo.

## Source Attribution

Each material conclusion in this report cites at least one source ID from `research/senea/source-register.csv` or is explicitly marked `unresolved` because no source ID is available.

| Material conclusion | Source IDs / citations |
| --- | --- |
| Del Monte Pacific deconsolidated the U.S. Del Monte Foods business effective May 2025 and classified it as discontinued operations. | S-003 (`https://www.delmontepacific.com/investors`, Del Monte Pacific FY2025 annual report). Anchor restated in `senea_diligence_05efbabd.plan.md`, Quick Source Anchors. |
| The U.S. Del Monte Foods entity filed for Chapter 11 in U.S. Bankruptcy Court. | S-008 (PACER docket for Del Monte Foods (U.S.) Chapter 11 case + Del Monte Foods newsroom press release). Anchor restated in `senea_diligence_05efbabd.plan.md`, Quick Source Anchors. |
| Sub-claims DMC-01 through DMC-05 (2014 ownership change, price aggression, Sager Creek, restructuring, plant closures/sales) lack a primary-source ID in the existing pack. | None. Treated as `unresolved` per the acceptance criterion that missing evidence forces `unresolved`. |
| Sub-claim DMC-06 (private-label retreat) is indirectly consistent with S-003 and S-008 but is not directly supported by retrieved primary-source quotations in this repo. | S-003, S-008 (indirect); marked `unresolved` for direct support. |
| The parent ledger claim under test is `C-006` from `claims-source-pack.json`, which itself is in `pending` status awaiting retrieval. | `research/senea/claims-source-pack.json` (claim `C-006`); `research/senea/source-register.csv` rows S-003 and S-008. |
| The plan's Decision Gates explicitly tie the oligopoly thesis to Del Monte's change in conduct (Gate 3) and require retrieved-source artifacts (Gate 1). | `senea_diligence_05efbabd.plan.md`, Decision Gates. |

## Open Questions

These open questions extend (and partially overlap with) the open-questions block in `claims-source-pack.json` so that downstream retrieval tasks can target them directly.

- Q-DMC-01: Confirm the exact 2014 transaction by which Del Monte Pacific Limited acquired the U.S. Del Monte Foods consumer-products business and assign a primary source ID for the acquisition (8-K, foreign-issuer announcement, or court filing). Currently no source ID exists for DMC-01.
- Q-DMC-02: Identify primary or near-primary evidence for post-2014 price aggression by Del Monte Foods in U.S. canned vegetables (retailer testimony, antitrust filings, trade-press interviews) and add it to the source register before DMC-02 can move off `unresolved`.
- Q-DMC-03: Locate Del Monte Foods disclosures on the Sager Creek (Allens canned-vegetable) acquisition and any subsequent impairments, restructuring charges, or divestitures. Without a Del Monte Foods filing or Del Monte Pacific note, DMC-03 stays `unresolved`.
- Q-DMC-04: Compile Del Monte Foods restructuring announcements (refinancings, distressed-debt exchanges, cost programs) between 2017 and 2024 and decide whether they are folded under S-003 or require new source IDs.
- Q-DMC-05: Map specific plant closures, sales, or co-packing transitions to either S-003 or to new sources (county records, USDA inspection-list changes, local press) so that capacity-reduction claims can be tested rather than asserted.
- Q-DMC-06: Replace the indirect inference for DMC-06 (private-label retreat) with a direct citation -- e.g., a Del Monte Pacific MD&A passage, a U.S. retailer disclosure, or a bankruptcy-court declaration describing the U.S. private-label posture.
- Q-DMC-07: Per `Q-004` in the source pack, resolve which entity (Del Monte Foods Inc. vs. Del Monte Foods Holdings vs. an intermediate) actually filed Chapter 11 and how that maps to the deconsolidated perimeter in S-003.
- Q-DMC-08: Retrieve the S-003 (Del Monte Pacific FY2025) and S-008 (Chapter 11 docket) artifacts into the repo so that DMC-07 and DMC-08 can move from `supported_by_anchor` to `passed` under Gate 1.
- Q-DMC-09: After retrieval, run the plan's Verification Commands (`fetch_sec_filings.py`, `verify_claims.py`) against the new artifacts and update both this Markdown report and the JSON sibling.
