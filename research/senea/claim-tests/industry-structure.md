# SENEA Industry-Structure Claim Test

- Claim family ID: `industry-structure`
- Parent ledger claims: `C-005`, `C-006`
- Plan reference: `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md` task 6 ("Validate industry structure") and Gate 3
- Source pack: `research/senea/claims-source-pack.json`
- Source register: `research/senea/source-register.csv`
- Generated: 2026-04-30

## Claim Family

This test covers the SENEA industry-structure claim family — the assertion that the U.S. private-label vegetable canning market is a rational oligopoly in which Seneca Foods (`SENEA`) and Lakeside Foods together account for approximately 90% of supply, and that the May 2025 deconsolidation of Del Monte Pacific's U.S. Del Monte Foods business followed by Del Monte Foods' U.S. Chapter 11 filing has removed a source of destructive private-label capacity. The family decomposes into seven testable sub-claims spanning Seneca's market position, Lakeside's role, the magnitude of private-label concentration, the U.S. facility footprint, the identity of smaller players, the question of rational capacity behavior, and whether the cited concentration figure is national or regional.

The sub-claims are derived from `C-005` (private-label oligopoly) and `C-006` (Del Monte deconsolidation/Chapter 11) in the claim ledger, with additional decomposition prompted by plan task 6 ("Map plants, categories, retail/private-label exposure, capacity closures, acquisitions, Del Monte capacity reductions/Chapter 11, Lakeside footprint, and any smaller players") and the Gate 3 pass/fail rule ("evidence of rational pricing and reduced destructive private-label competition").

## Verdict

| Sub-claim ID | Sub-claim | Verdict | Confidence |
| --- | --- | --- | --- |
| `IS-1` | Seneca is one of the two top suppliers of U.S. private-label canned vegetables. | `unresolved` | low |
| `IS-2` | Lakeside Foods is the second top supplier of U.S. private-label canned vegetables. | `unresolved` | low |
| `IS-3` | Seneca and Lakeside together account for approximately 90% of U.S. private-label canned-vegetable supply. | `unresolved` | low |
| `IS-4` | The Seneca / Lakeside / Del Monte facility footprint is consistent with a two-or-three-firm private-label structure. | `unresolved` | low |
| `IS-5` | Residual ~10% of U.S. private-label canned-vegetable supply is fragmented among smaller players, with no third firm above ~5%. | `unresolved` | low |
| `IS-6` | Del Monte Pacific deconsolidated U.S. Del Monte Foods effective May 2025 and the U.S. business filed Chapter 11, removing destructive private-label capacity. | `unresolved` | low |
| `IS-7` | The ~90% concentration figure is a U.S.-national private-label vegetable-canning measure, not a regional or category-narrow measure. | `unresolved` | low |

**Family verdict: `unresolved`.** The claim family cannot pass or fail at this stage because primary-source retrieval is explicitly deferred per the claims source pack scope statement (`research/senea/claims-source-pack.json` field `scope`). Every sub-claim is conditional on retrieving and inspecting filings that are referenced by the source register but have not yet been archived in the repository. The rebuilt judgement should be re-run after the `industry-attack` and `source-pack` Invoker tasks land their artifacts.

## Market Map

The market map below is the structural hypothesis derived from the source pack and plan; cell entries that are not directly supported by an archived primary source are flagged with `unresolved` so they can be filled in by the downstream `industry-attack` task.

| Tier | Firm | Public/Private | Asserted role in U.S. private-label canned vegetables | Supporting source IDs |
| --- | --- | --- | --- | --- |
| 1 | Seneca Foods Corporation (`SENEA`) | Public (NASDAQ) | Co-leading supplier of U.S. private-label canned vegetables; ~half of the asserted ~90% combined share with Lakeside (per `C-005`). | `S-001`, `S-004` |
| 1 | Lakeside Foods, Inc. | Private | Co-leading supplier of U.S. private-label canned vegetables; source of the ~90% combined-share statement. | `S-004` |
| 2 (transitioning) | Del Monte Foods (U.S.) | Was indirectly held by Del Monte Pacific Limited; deconsolidated effective May 2025 per `C-006`; subsequently filed Chapter 11 per `C-006` / `S-008`. | Historically a destructive private-label competitor; capacity status post-Chapter 11 is `unresolved` pending docket review. | `S-003`, `S-008` |
| 3 (residual) | Smaller / unnamed players | Mixed | Residual ~10% of asserted private-label vegetable-canning supply; specific firms are `unresolved` — the source pack does not enumerate them. | `unresolved` |

| Geography | Asserted scope | Supporting source IDs |
| --- | --- | --- |
| United States, national | The ~90% figure as quoted in `S-004` is described in the source register as "U.S. private-label vegetable canning"; the source pack does not currently distinguish a regional cut. National vs. regional disambiguation is `unresolved` pending Lakeside primary material retrieval. | `S-004` |

## Evidence Table

| Sub-claim ID | Evidence statement | Source IDs | Source URL or citation (per source register) | Evidence type | Status |
| --- | --- | --- | --- | --- | --- |
| `IS-1` | Seneca Foods Corporation FY2025 10-K segment / business description is the primary disclosure that would corroborate Seneca's position as a top-two U.S. private-label canned-vegetable supplier. The filing has not yet been retrieved in this repo. | `S-001` | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K` | primary-filing | not-yet-retrieved |
| `IS-2` | Lakeside Foods public materials (corporate communications / interview transcript) referenced in the source register name Lakeside as one of two competitors covering ~90% of private-label vegetable canning. The underlying material has not been archived to this repo. | `S-004` | "Lakeside Foods website and quoted industry interview material (to be archived as cited in the plan's Quick Source Anchors section)" | industry-statement | not-yet-retrieved |
| `IS-3` | The ~90% combined private-label share figure is asserted in the Lakeside source per the source register entry for `S-004`; cross-check is intended against `S-001` segment commentary. Neither source has been retrieved. | `S-004`, `S-001` | See above. | industry-statement + primary-filing | not-yet-retrieved |
| `IS-4` | Seneca, Lakeside, and Del Monte plant lists and capacity disclosures are required to confirm the asserted footprint. Seneca facilities are disclosed in the FY2025 10-K (`S-001`); Del Monte U.S. plant disposition is referenced in Del Monte Pacific FY2025 disclosure materials (`S-003`) and the Chapter 11 docket (`S-008`); Lakeside facilities are referenced in `S-004`. None of these have been archived in this repo. | `S-001`, `S-003`, `S-004`, `S-008` | See source register for each ID. | mixed | not-yet-retrieved |
| `IS-5` | The source register does not currently identify a third or fourth U.S. private-label canned-vegetable supplier above the ~10% residual threshold. Open question `Q-001` in the source pack flags that the second name in Lakeside's quote may itself be ambiguous. | `S-004` (and any third-party industry data not yet sourced) | See source register. | industry-statement | not-yet-retrieved |
| `IS-6` | Del Monte Pacific's FY2025 annual report is the primary source for the May 2025 deconsolidation and discontinued-operations classification; the U.S. Chapter 11 filing is documented in the PACER docket and Del Monte Foods' own press release. Neither has been retrieved into the repo. Open question `Q-004` notes that the precise filing entity (Del Monte Foods Inc. vs. Del Monte Foods Holdings) is unresolved. | `S-003`, `S-008` | `https://www.delmontepacific.com/investors`; PACER docket / Del Monte Foods newsroom (citation form per source register). | primary-filing + court-record | not-yet-retrieved |
| `IS-7` | The geographic scope of the ~90% figure (U.S.-national vs. regional, vegetable-canning vs. narrower category) is `unresolved` until the Lakeside primary material is archived and read against any third-party industry data. | `S-004` | "Lakeside Foods website and quoted industry interview material (to be archived as cited in the plan's Quick Source Anchors section)" | industry-statement | not-yet-retrieved |

## Contrary Evidence

The downstream `industry-attack` task should specifically attempt to falsify each sub-claim. Candidate contrary lines to test, none of which can be resolved at this stage because the supporting primary sources are not yet archived:

| Sub-claim ID | Contrary line of attack | What would need to be retrieved |
| --- | --- | --- |
| `IS-1` / `IS-3` | Lakeside's ~90% statement is a self-interested marketing claim, not an audited or third-party-measured figure; an independent industry-data provider could materially disagree. | Third-party industry data on U.S. private-label vegetable canning that is not currently cited in the source register. |
| `IS-2` | Lakeside's quoted "one other competitor" may not be Seneca; it may refer to Del Monte, Bonduelle USA, or another firm — `Q-001` in the source pack flags this ambiguity. | The primary Lakeside source text (`S-004`) so the named counterpart can be read directly. |
| `IS-4` | Even if combined private-label share is high, individual category lines (corn vs. green beans vs. peas) or geographies may be served by different plants such that the "oligopoly" effect does not hold at the SKU or regional level. | Plant-level capacity by category from `S-001`, `S-003`, `S-004`. |
| `IS-5` | A non-trivial third firm (e.g., a regional canner or a co-pack arrangement supporting a retailer) may push the residual above ~10% and weaken the duopoly framing. | A primary or third-party enumeration of residual U.S. private-label vegetable canners. |
| `IS-6` | Chapter 11 is a reorganization, not a liquidation. Del Monte U.S. capacity may emerge from bankruptcy under new ownership at similar or greater output, making the "destructive capacity removed" framing premature. | The Chapter 11 plan / disclosure statement and any asset-sale orders from `S-008`. |
| `IS-7` | The ~90% figure may apply to a narrower category (e.g., canned corn or canned peas in private label) rather than the full U.S. private-label vegetable-canning market, materially weakening the "national oligopoly" framing. | The full Lakeside statement in context, including the question or topic that elicited it. |

## Source Attribution

The following source IDs from `research/senea/source-register.csv` are referenced in this test. Each citation below is by source ID and the URL or citation form recorded in the source register; the primary documents themselves are not yet archived in this repo and are listed by the source register as "to be retrieved".

- `S-001` — Seneca Foods Corporation FY2025 Annual Report on Form 10-K. Publisher: Seneca Foods Corporation / U.S. Securities and Exchange Commission. Citation: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K`. Used here for `IS-1`, `IS-3`, `IS-4`. Source register confidence: high. Retrieval status: not-yet-retrieved.
- `S-003` — Del Monte Pacific Limited FY2025 annual report and FY2025 results materials. Publisher: Del Monte Pacific Limited (SGX/PSE listed). Citation: `https://www.delmontepacific.com/investors`. Used here for `IS-4`, `IS-6`. Source register confidence: high. Retrieval status: not-yet-retrieved.
- `S-004` — Lakeside Foods public materials referencing the ~90% private-label vegetable-canning statement. Publisher: Lakeside Foods, Inc. (corporate communications / interview transcript). Citation: per source register, "Lakeside Foods website and quoted industry interview material (to be archived as cited in the plan's Quick Source Anchors section)". Used here for `IS-1`, `IS-2`, `IS-3`, `IS-4`, `IS-5`, `IS-7`. Source register confidence: medium. Retrieval status: not-yet-retrieved.
- `S-008` — Del Monte Foods (U.S.) Chapter 11 bankruptcy filing and supporting docket records. Publisher: U.S. Bankruptcy Court (PACER docket) / Del Monte Foods press release. Citation: per source register, "PACER bankruptcy docket for Del Monte Foods (U.S.) Chapter 11 case and corresponding press release (to be retrieved from PACER and the Del Monte Foods newsroom)". Used here for `IS-4`, `IS-6`. Source register confidence: high. Retrieval status: not-yet-retrieved.

No source outside the source register was relied on for any material conclusion in this report. Where a sub-claim would require evidence beyond the source register (for example a third-party industry-data provider for `IS-3` or a docket-level reading for `IS-6`), the conclusion is set to `unresolved` rather than asserted from background knowledge.

## Open Questions

These open questions are inherited from the source pack and re-listed here because they directly block one or more industry-structure sub-claims. They must be resolved by the `industry-attack` task before the family verdict can move from `unresolved`.

- `Q-001` (blocks `IS-2`, `IS-3`, `IS-5`, `IS-7`) — Which specific competitor does Lakeside name alongside itself in the ~90% private-label vegetable-canning quote, and is that competitor Seneca or a third party? Resolution requires retrieving and reading the primary Lakeside material under `S-004`.
- `Q-004` (blocks `IS-6`) — Which entity (Del Monte Foods Inc. or Del Monte Foods Holdings) filed Chapter 11, and how does that map to Del Monte Pacific's deconsolidated U.S. business? Resolution requires retrieving the PACER docket under `S-008` and the Del Monte Pacific FY2025 disclosure under `S-003`.
- `Q-IS-A` (new; blocks `IS-3`, `IS-7`) — Is the "approximately 90%" figure measured against the full U.S. private-label canned-vegetable category or a narrower sub-category (e.g., canned corn, canned green beans, canned peas), and against what time period and data source? Resolution requires `S-004` plus, ideally, a third-party industry-data cross-check that is not currently in the source register.
- `Q-IS-B` (new; blocks `IS-4`) — What is the plant-level facility list (location, categories, capacity) for Seneca, Lakeside, and the post-deconsolidation Del Monte U.S. business, and where do those footprints overlap by retailer or region? Resolution requires `S-001`, `S-003`, `S-004`, and `S-008`.
- `Q-IS-C` (new; blocks `IS-5`) — Does any third U.S. private-label canned-vegetable supplier (named or unnamed in `S-004`) exceed ~5% share, and if so, does its presence weaken the duopoly framing? Resolution requires `S-004` plus third-party industry data not currently archived.
- `Q-IS-D` (new; blocks `IS-6`) — Does the Chapter 11 process result in capacity exit (plant closures, asset abandonment) or capacity transfer (going-concern sale, reorganized emergence)? Resolution requires the Chapter 11 plan / disclosure statement and any §363 sale orders under `S-008`.
