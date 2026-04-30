# SENEA Industry Structure Validation and Bear Case Memo

- Task ID: `validate-industry-and-bear-case`
- Plan: `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`
- Upstream artifacts: `research/senea/claims-source-pack.json`, `research/senea/source-register.csv`, `research/senea/financial-rebuild.md`, `research/senea/financial-rebuild.json`
- Ticker: `SENEA` (Seneca Foods Corporation, fiscal year ended March 2025 = "FY2025")
- Artifact status: `draft`
- Generated: 2026-04-30

This artifact attacks the industry-structure half of the SENEA Diligence thesis. It validates or challenges every major claim about the U.S. canned-vegetable competitive set (Seneca, Lakeside, Del Monte, smaller players, private-label concentration), tests the Del Monte Pacific deconsolidation and the U.S. Del Monte Foods Chapter 11 narrative, and stress-tests the pricing-rationality, customer-concentration, and secular-decline assumptions. Each industry claim is graded against the upstream source register (`S-001` … `S-008`) plus the new industry-evidence sources introduced below (`S-012` … `S-017`). Where the upstream pack only supplies a pointer to a primary source ("to be retrieved from …") and no quoted text has been archived, the corresponding claim is graded `unverified` rather than `passed` or `failed`. The Bear Case Memo concentrates the strongest negative scenarios that survive after the verifications and is calibrated against the same evidence ledger.

## Industry Structure Verdict

Headline verdict: **mixed**. The two anchored industry claims (the Lakeside ~90% private-label-canning statement and the Del Monte Pacific deconsolidation / U.S. Del Monte Foods Chapter 11 sequence) are directionally credible based on the source pointers in the upstream pack, but neither has been verified against an archived primary source in this validation pass. Until retrieval converts the relevant pointers to quoted text, the strongest formulation of the bull narrative — that Seneca becomes a near-duopolist in private-label canned vegetables after Del Monte's restructuring — must be treated as `unverified`. The weaker formulation — that the U.S. canned-vegetable competitive set has consolidated and that the marginal price-setter has changed — is `partially-verified` from the same source pointers. The bear case memo below explains why even the strongest verified version of the structure does not by itself close the value gap that the financial rebuild leaves open.

| Theme | Strongest verified statement | Strongest unverified or contested statement | Verdict |
| --- | --- | --- | --- |
| Private-label concentration | The plan's Quick Source Anchors archive a Lakeside corporate statement that Lakeside and one other competitor account for ~90% of U.S. private-label vegetable canning (`S-004`). | The 90% figure is self-reported by Lakeside, lacks a third-party check, and the named competitor (Seneca vs a third party) is not yet quoted in this validation. | `unverified` (pointer-only) |
| Branded competitor exit | Del Monte Pacific's FY2025 reporting describes the U.S. Del Monte Foods business as discontinued / deconsolidated and the U.S. entity subsequently filed Chapter 11 (`S-003`, `S-008`). | Whether the Chapter 11 process is a liquidation, a reorganization with a strategic acquirer, or a recapitalization that returns the U.S. business to compete is not yet quoted from the docket. | `partially-verified` (pointer-only on key details) |
| Smaller players | Public trade press references regional players (Hanover Foods, Faribault, Furmano's, Truitt, Allens / Sager Creek under Del Monte) (`S-013`). | Their share of private-label vegetable canning, branded exposure, and capacity utilization are not quoted from primary filings. | `unverified` |
| Customer concentration | Seneca's 10-K Item 1 / Item 1A typically discloses customer-concentration risk thresholds (>10% customers) (`S-001` Item 1 / Item 1A). | The specific top-customer list and the concentration percentages have not been retrieved in this pass. | `unverified` (pointer-only) |
| Pricing rationality | Seneca's MD&A historically describes price-cost recovery across crop, steel/tinplate, freight, and labor cycles (`S-001` Item 7) and is the basis for plan claim `C-011`. | Gross margin drift across FY2018–FY2025 has not been reconstructed in this pass; cyclicality of pricing is asserted but not measured here. | `unverified` (pointer-only) |
| Secular decline | USDA / Census / Circana data series on per-capita canned vegetable consumption (`S-012`, `S-016`) typically show a multi-decade volume decline relative to fresh and frozen vegetables. | The exact volume trajectory and Seneca-specific volume share against the category trend are not quoted in this pass. | `unverified` (pointer-only) |

The Industry Structure Verdict therefore reads: the bull narrative on industry structure is plausible and directionally supported by the existing source pointers, but **no industry claim has been moved from `pending` to `passed` in this artifact**. Every major industry claim is graded `partially-verified` or `unverified` and is held open as a primary check in the Unresolved Primary Checks section. The Bear Case Memo below presents the cases that *do not require* the bull narrative on structure to fail in order to bind on returns.

## Competitor Evidence

This section lays out the per-competitor evidence ledger and grades each subclaim against the upstream and newly registered sources.

### Seneca Foods (SENEA) — incumbent private-label canner

- **What is asserted.** Seneca is the larger of the two private-label canners that together account for ~90% of U.S. private-label canned vegetable supply (claim `C-005` from the upstream pack, mirrored in industry claim `IC-001` below).
- **Direct evidence.** Seneca's FY2025 10-K (`S-001`) describes the company's competitive position, product portfolio (canned and frozen vegetables, fruit, snacks), and customer mix. Item 1 ("Business") of the 10-K is the canonical disclosure for whether Seneca self-identifies as a duopolist or a larger oligopolist; the upstream pack flags the retrieval but the text is not quoted in this validation.
- **Status.** `partially-verified`. The bull formulation that Seneca is *the* private-label vegetable canner of scale is consistent with the Lakeside statement (`S-004`) but is not yet quoted from Seneca's own disclosures. Held open under primary check `P-001`.

### Lakeside Foods — second private-label canner of scale

- **What is asserted.** Lakeside Foods (private, headquartered in Manitowoc, Wisconsin) is the second of the two firms that together command ~90% of U.S. private-label vegetable canning (claim `C-005`, `S-004`).
- **Direct evidence.** The Lakeside public statement (interview / corporate communication archived in the plan's Quick Source Anchors) is the only direct anchor (`S-004`). Independent third-party industry data (e.g., Circana / IRI / Nielsen private-label scanner data, Census Bureau Annual Survey of Manufactures) (`S-016`, `S-012`) is required to triangulate the figure.
- **Status.** `unverified`. The 90% figure is supplied by an interested party. Held open under primary check `P-002`. Triangulation against `S-016` is required before the figure can be cited as `verified`.

### Del Monte Foods (U.S.) — branded competitor in restructuring

- **What is asserted.** Del Monte Foods (U.S.) was the third significant participant in the U.S. canned-vegetable category, primarily on the branded side, and entered Chapter 11 in 2025 after Del Monte Pacific (its Asia-listed parent) classified the U.S. business as discontinued operations and deconsolidated effective May 2025 (claim `C-006`, `S-003`, `S-008`).
- **Direct evidence.** Del Monte Pacific's FY2025 annual report and SGX/PSE disclosure filings (`S-003`) are the primary source for the deconsolidation. The PACER docket (`S-008`) and contemporaneous trade press (`S-014`) carry the filing date, debtor entity, and reorganization-versus-liquidation posture.
- **Open question.** Upstream open question `Q-004` ("Which entity — Del Monte Foods Inc. or Del Monte Foods Holdings — filed Chapter 11, and how does that map to Del Monte Pacific's deconsolidated U.S. business?") is unresolved here and is carried forward as primary check `P-004`.
- **Status.** `partially-verified`. The deconsolidation and Chapter 11 are documented at the pointer level but not quoted in this pass. The post-restructuring competitive footprint of any successor or acquirer is `unverified`.

### Smaller players — Hanover, Faribault, Furmano's, Truitt, Allens / Sager Creek

- **What is asserted.** Beyond Seneca, Lakeside, and Del Monte, the U.S. canned-vegetable category is populated by smaller regional canners and co-packers — examples include Hanover Foods (private, Hanover, PA), Faribault Foods (private, Faribault, MN), Furmano Foods (private, Northumberland, PA; subsequently rolled up by Hanover Foods per public statements), Truitt Bros. (private, Salem, OR), and the Allens / Sager Creek line that was acquired into Del Monte Foods. Together they comprise the residual ~10% of private-label vegetable canning supply that the Lakeside statement excludes (`S-004`, `S-013`).
- **Direct evidence.** None of these companies file with the SEC; the evidence trail is corporate websites, trade press (`S-013`, `S-014`), and Census Bureau / USDA aggregate data (`S-012`).
- **Status.** `unverified`. The names and rough roles are public knowledge, but their share of U.S. canned-vegetable volume, capacity utilization, and ability to absorb a Del Monte Foods exit are not quoted from primary sources in this pass. Held open under primary check `P-003`.

### Substitute and adjacent competitors

- **Substitute pressure.** Frozen vegetables, fresh produce, and shelf-stable plant-based / pulse products compete for the same end-use occasions. Frozen vegetable production is dominated by Pinnacle Foods / Conagra (Birds Eye), Bonduelle, and General Mills (Cascadian Farm/Green Giant via licensing). Fresh produce is structurally separate but its long-term per-capita growth is the inverse of canned vegetable per-capita decline. (`S-012`, `S-016`)
- **Status.** `unverified` quantitatively. Substitution risk is real but is treated in the Bear Case Memo and primary check `P-007` rather than asserted as a verified fact here.

## Capacity And Pricing Evidence

This section grades the capacity-utilization and pricing-rationality claims that underpin the bull narrative on margin durability after the Del Monte exit.

### Capacity rationalization

- **What is asserted.** With Del Monte Foods (U.S.) in Chapter 11 and capacity potentially being shed or sold, the remaining private-label canners (Seneca, Lakeside) inherit volume from former Del Monte private-label and co-pack accounts at favorable pricing (component of claim `C-006`, mirrored in industry claim `IC-006`).
- **Direct evidence.** This claim depends on (a) what fraction of Del Monte Foods' U.S. capacity was supplying private-label rather than the Del Monte brand, (b) which Del Monte plants close vs sell, and (c) whether Seneca discloses any pickup of legacy Del Monte volume in its FY2025 or FY2026 segment commentary (`S-001` Item 7 MD&A; subsequent 10-Q / 10-K filings).
- **Status.** `unverified`. The PACER docket (`S-008`) and Del Monte Pacific FY2025 reporting (`S-003`) describe the fact pattern of the deconsolidation but do not directly answer (a)/(b)/(c). Held open under primary checks `P-004` and `P-005`.

### Pricing rationality

- **What is asserted.** Pricing in U.S. canned vegetable private-label is rational — i.e., the remaining canners pass through input-cost moves (raw produce, steel/tinplate cans, freight, labor) rather than absorbing them in a destructive price war (component of claim `C-011`, mirrored in industry claim `IC-008`).
- **Direct evidence.** Seneca's FY2018–FY2025 10-K MD&A historically attributes revenue change to "selling price and mix" versus "volume" and discusses input-cost pass-through (`S-001`, `S-007`). The financial-rebuild artifact's `price_cost_bridge` output operationalizes this for FY2018–FY2025 once the historical filings are retrieved.
- **Status.** `unverified` in this pass. The plan's claim `C-011` is graded `pending` in the financial rebuild and `unverified` here. Triangulation against tinplate steel price indices (`S-017`) and freight indices (e.g., Cass Truckload Linehaul Index) is part of the primary check `P-006` workplan.

### Input-cost exposure

- **What is asserted.** Seneca's input-cost stack is dominated by (a) raw produce contracted with Pacific Northwest, Midwest, and Wisconsin growers, (b) tinplate steel for cans, (c) freight, and (d) labor.
- **Direct evidence.** Item 1 ("Business") and Item 1A ("Risk Factors") of the FY2025 10-K (`S-001`) typically describe the grower-contract structure and tinplate / steel exposure. Tariffs on imported tinplate or steel (e.g., U.S. trade actions on Chinese / Korean / Japanese tinplate) feed directly into Seneca's gross margin and are referenced in trade press (`S-014`).
- **Status.** `unverified` quantitatively in this pass. The qualitative exposure is well documented in prior Seneca filings and is part of primary check `P-006`.

## Customer And Channel Risks

This section grades the customer-concentration and channel-mix claims that gate the bull narrative on pricing power.

### Customer concentration

- **What is asserted.** Seneca's customer base is concentrated in a small number of large grocery, mass, and club retailers (Walmart, Kroger, Costco, Albertsons, Ahold Delhaize, etc.), and disclosure of any 10%+ customer in Item 1 / Item 1A of the 10-K is the canonical test (industry claim `IC-009`).
- **Direct evidence.** Seneca's FY2025 10-K (`S-001`) Item 1 / Item 1A is the primary source. Walmart's, Kroger's, Costco's, and Ahold Delhaize's own 10-K / 20-F private-label commentary (`S-015`) is a secondary triangulation source for whether private-label dollar share is rising in their assortments (a tail-wind that supports Seneca volumes, but at compressed dollar margins).
- **Status.** `unverified`. The plan does not anchor a specific concentration number, and Seneca's exact 10%+ customer disclosures are not retrieved in this pass. Held open under primary check `P-008`.

### Channel-mix shift

- **What is asserted.** The retail channel is shifting toward private label (mass, club, hard discount, dollar) and toward DTC and meal-kit / foodservice for branded SKUs. Within Seneca's mix, the private-label share is `unverified` and the foodservice share is `unverified`.
- **Direct evidence.** Seneca's segment / customer-mix disclosure (`S-001` Item 1 and segment footnote). Industry data on private-label dollar share by category (`S-016`).
- **Status.** `unverified` in this pass. Held open under primary check `P-008`.

### Negotiating leverage and category resets

- **What is asserted.** Large retailers run annual or biennial category resets in canned vegetables; private-label suppliers face periodic re-bid risk. Loss of a key program at Walmart or Kroger could materially affect a single-year's volume.
- **Direct evidence.** This dynamic is not anchored in the upstream source pack and would require trade-press references (`S-014`) plus retailer disclosures (`S-015`) to verify.
- **Status.** `unverified`. Held open under primary check `P-008`.

## Bear Case Memo

The bear case is constructed so that **each item binds even under the bull industry-structure assumption**. In other words, even if every "Industry Structure Verdict" row above resolves to `verified` in favor of Seneca, the items below could still produce a multi-year flat or compressed total return. Items are graded by the strongest available evidence today; items relying on `unverified` industry claims are flagged.

### B-001. Secular per-capita decline in canned vegetable consumption

- **Mechanism.** USDA Economic Research Service and Census-tracked canned vegetable per-capita consumption has trended down for decades versus fresh and frozen alternatives (`S-012`, `S-016`). A more rational competitive structure on a shrinking base is still a shrinking base.
- **What it would take to bind.** Volume CAGR in U.S. canned vegetables of −1% to −3% per annum over the next five years, partly offset by mix and pricing.
- **Evidence quality.** `unverified` quantitatively in this pass. The directional trend is widely reported but the exact slope must be quoted from `S-012` / `S-016` before this becomes `partially-verified` or `verified`.
- **Implication for value.** Caps Seneca's volume growth and therefore its ability to compound book value beyond what buybacks contribute.

### B-002. Customer concentration caps pricing power

- **Mechanism.** Walmart, Kroger, Costco, Albertsons, and Ahold Delhaize collectively control a large fraction of U.S. shelf for private-label canned vegetables. Even a duopoly supplier base faces monopsonistic buyers who can re-bid programs and negotiate cost-down clauses (industry claim `IC-009`).
- **Evidence quality.** `unverified` in this pass — the specific 10%+ customer disclosures from Seneca's 10-K (`S-001` Item 1 / Item 1A) and the retailer side disclosures (`S-015`) have not been quoted. Bull and bear cases share the same fact base; what matters is the magnitude.
- **Implication for value.** Compresses the gross-margin uplift that the duopoly narrative implies.

### B-003. Del Monte restructuring may produce a stronger, not weaker, branded competitor

- **Mechanism.** Chapter 11 frequently produces a leaner emergent competitor with reduced debt service and a recapitalized cost structure. The bull narrative assumes Del Monte capacity exits or is mothballed; the bear case assumes a strategic acquirer (e.g., a private-equity buyer or a category-adjacent strategic) re-energizes the brand and the private-label co-pack lines (`S-003`, `S-008`, `S-014`).
- **Evidence quality.** `unverified` in this pass — neither the PACER docket nor the trade-press reorganization plan has been quoted. Held open under primary check `P-004`.
- **Implication for value.** Erodes the duopoly thesis by the magnitude of the post-emergence competitive footprint.

### B-004. The "~90% private-label" figure is self-reported and may overstate concentration

- **Mechanism.** The Lakeside statement (`S-004`) is corporate communication from one of the two named participants. Standard disclosure-quality concerns apply: definitional scope (canned vegetables only? canned + jarred? include canned beans?), geography (U.S. only? North America?), and time period.
- **Evidence quality.** `unverified` until triangulated against Census / Circana data (`S-016`, `S-012`). Upstream open question `Q-001` ("Which specific competitor does Lakeside name alongside itself…?") remains open.
- **Implication for value.** If actual private-label concentration is materially less than 90% (say 60%–70%), the duopoly pricing implication is weaker.

### B-005. Tinplate and steel cost inflation outruns price recovery

- **Mechanism.** Steel tinplate is the largest non-produce input cost in canning. U.S. trade actions on imported tinplate (Section 232 steel tariffs, AD/CVD duties on Chinese / Korean / Japanese tinplate) raise the per-can cost (`S-014`, `S-017`). If the canners cannot fully pass through tariff-driven cost moves, gross margin compresses.
- **Evidence quality.** `unverified` quantitatively in this pass; tinplate price indices and Seneca's cost-of-sales bridge must be quoted from `S-001` Item 7 MD&A and `S-017` before this is `partially-verified`.
- **Implication for value.** Direct hit to the FIFO-adjusted EBITDA series in the financial rebuild.

### B-006. Climate / crop-yield variability is structural

- **Mechanism.** Seneca's pack is concentrated in Pacific Northwest, Wisconsin / Minnesota, and New York growers. Regional drought, heat, or pest events can compress pack yield and force higher LIFO charges in subsequent years.
- **Evidence quality.** `unverified` quantitatively. The qualitative exposure is consistently described in Seneca's Item 1A risk factors (`S-001`) and is uncontroversial.
- **Implication for value.** Adds variance, not necessarily mean, to the FIFO-adjusted EBITDA series; biases LIFO charges higher in volatile years.

### B-007. Dual-class structure prevents activist intervention

- **Mechanism.** Seneca operates a dual-class share structure with concentrated Class B voting power (claim `C-010` from the upstream pack). Even if the price-to-FIFO-tangible-book gap persists, activist investors cannot force a sale, dividend, or recap. The discount can persist indefinitely.
- **Evidence quality.** `partially-verified` at the pointer level via the FY2025 DEF 14A (`S-005`); upstream open question `Q-006` is unresolved here.
- **Implication for value.** Caps the realization mechanism on the bull case; buybacks at the corporate level are the only crystallization vehicle.

### B-008. Private-label margins are structurally lower than branded

- **Mechanism.** Even at duopoly share, private-label vegetable canning generates lower gross margin per can than branded packaged food. The FIFO-adjusted EBITDA margin profile that the financial rebuild is targeting is bounded by category economics, not by relative supplier share.
- **Evidence quality.** `unverified` in this pass. Triangulation against Conagra, General Mills (Green Giant), and Bonduelle disclosures (`S-014`, `S-015`) is part of primary check `P-006`.
- **Implication for value.** Caps the EBITDA margin trajectory used in the bull discounted-cash-flow or earnings-power framing.

### B-009. Substitution to frozen and fresh persists

- **Mechanism.** Even if the canned-vegetable category is rationalized on the supply side, end-consumer substitution to frozen and fresh continues to compress total category dollar growth (`S-012`, `S-016`).
- **Evidence quality.** `unverified` quantitatively in this pass.
- **Implication for value.** Reinforces B-001; double-counts the secular-decline mechanism only if applied additively.

### B-010. The realized FIFO add-back to equity is smaller than gross

- **Mechanism.** The financial-rebuild artifact's after-tax LIFO add-back to equity is `LIFO reserve × (1 − t)`. Even at the 21% federal floor (`S-010`), the after-tax add-back is ~$284m versus $359.3m gross. State income tax pushes the figure lower. The bear case carries this forward: the realized FIFO equity adjustment is materially smaller than the headline LIFO reserve.
- **Evidence quality.** `partially-verified` mechanically via the financial-rebuild bridge. The exact effective-tax-rate retrieval (`S-001` Income Taxes note) is held open as financial-rebuild gap `F-002`.
- **Implication for value.** Quantitatively narrows the bull tangible-book and NCAV bridges.

### Bear case scenario synthesis

Combining B-001 through B-010 produces a scenario in which: (i) volume runs off at −2% per annum, (ii) pricing recovers ~80% of input-cost moves rather than the full 100%, (iii) the Del Monte reorganization produces a re-energized branded competitor that recaptures ~30% of its pre-Chapter-11 share, (iv) the after-tax FIFO equity bridge is roughly $260m–$285m rather than the gross $359.3m, and (v) the dual-class structure prevents any catalytic crystallization. In that scenario the FIFO-adjusted earnings power that supports the bull case is reduced by 25%–40% from the bull-case midpoint and the bull's price-to-FIFO-tangible-book gap closes only slowly via buybacks. Quantification of this scenario is deferred to the financial-rebuild artifact once its `pending` lines resolve; this artifact lays the qualitative scaffolding only.

## Source Attribution

This validation pass relies on the upstream source register (`research/senea/source-register.csv`) plus six new sources introduced specifically for industry attack and bear-case validation. All new sources are also listed in `research/senea/industry-evidence.csv` with one row per claim-source pairing.

| Source ID | Title | Publisher | URL or Citation | Source Type | Used For | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| S-001 | Seneca Foods FY2025 Form 10-K (Item 1 Business, Item 1A Risk Factors, Item 7 MD&A on price-cost bridge, segment / customer disclosures) | Seneca Foods Corporation / U.S. SEC | SEC EDGAR filing index for SENEA, Form 10-K for fiscal year ended March 2025 (`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K`) | primary-filing | IC-001, IC-008, IC-009, IC-010 | high |
| S-003 | Del Monte Pacific Limited FY2025 annual report and SGX/PSE disclosure filings on the U.S. Del Monte Foods deconsolidation | Del Monte Pacific Limited (SGX/PSE listed) | `https://www.delmontepacific.com/investors` | primary-filing | IC-006 | high |
| S-004 | Lakeside Foods public statement that Lakeside and one other competitor account for ~90% of U.S. private-label vegetable canning | Lakeside Foods, Inc. | Lakeside Foods website / quoted industry interview material archived in plan Quick Source Anchors | industry-statement | IC-001, IC-002 | medium |
| S-007 | Seneca Foods historical 10-K and 10-Q filings (FY2018–FY2024) for cyclical price-cost commentary and customer-mix history | Seneca Foods Corporation / U.S. SEC | `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10` | primary-filing | IC-008 | high |
| S-008 | Del Monte Foods (U.S.) Chapter 11 docket on PACER plus the contemporaneous Del Monte Foods press release | U.S. Bankruptcy Court (PACER docket) / Del Monte Foods press release | PACER docket for Del Monte Foods (U.S.) Chapter 11 case; Del Monte Foods newsroom | court-record | IC-006, IC-007 | high |
| S-012 | USDA Economic Research Service "Vegetables and Pulses Outlook" and U.S. Census Bureau "Annual Survey of Manufactures" data on canned vegetable production and per-capita consumption | USDA ERS / U.S. Census Bureau | `https://www.ers.usda.gov/publications/pub-details/?pubid=` (Vegetables and Pulses Outlook) and `https://www.census.gov/programs-surveys/asm.html` (Annual Survey of Manufactures, NAICS 311421) | government-statistics | IC-010 | medium |
| S-013 | Public materials and trade press for smaller U.S. canned-vegetable players (Hanover Foods, Faribault Foods, Furmano's, Truitt Bros., Allens / Sager Creek) | Company websites and food-industry trade press | Company corporate websites and trade-press references (e.g., Food Dive, Food Business News, The Packer) | trade-press | IC-003, IC-004 | low |
| S-014 | Trade press coverage of the Del Monte Foods (U.S.) Chapter 11 filing and the Del Monte Pacific deconsolidation | Reuters / Bloomberg / Wall Street Journal / Food Dive | Reuters and WSJ wire copy on the Del Monte Foods (U.S.) Chapter 11 filing; Food Dive industry coverage | trade-press | IC-006, IC-007, B-003 | medium |
| S-015 | 10-K / 20-F disclosures from Walmart, Kroger, Costco, Albertsons, Ahold Delhaize on private-label penetration and grocery competitive intensity | U.S. SEC EDGAR / SEDAR / SGX | EDGAR filing indexes for the listed retailers | primary-filing | IC-009 | medium |
| S-016 | Circana / IRI / Nielsen retail-scanner aggregates on U.S. canned vegetable category dollar and unit trend (third-party syndicated panels) | Circana (IRI) / NielsenIQ | Circana / NielsenIQ syndicated panel aggregates as cited in trade press; subscription required for full data | third-party-data | IC-010 | medium |
| S-017 | Tinplate / steel price index series (CRU Tinplate Index, S&P Global Platts / Argus tinplate spot, U.S. Federal Reserve Industrial Production index for canned vegetable manufacturing) | CRU Group / S&P Global Platts / Argus / U.S. Federal Reserve | CRU and S&P Platts subscription publications; FRED series for "Canned Fruits and Vegetables" production index | commodity-index | IC-008, B-005 | medium |

The upstream sources `S-002` (S&P SmallCap 600 deletion), `S-005` (Seneca FY2025 DEF 14A), `S-006` (Seneca IR coverage page), `S-009` (SENEA Class A market price), `S-010` (corporate tax rate), and `S-011` (share counts) are not directly required by the industry attack and are referenced from the financial-rebuild artifact rather than re-cited here. `S-005` is referenced indirectly in bear case item B-007 via claim `C-010`.

## Unresolved Primary Checks

These primary checks must close before this artifact can move from `draft` to `verified`. Each item names the exact source pointer to retrieve and the test it satisfies.

- **P-001 — Seneca self-disclosure of competitive position.** Retrieve Item 1 ("Business") of the FY2025 10-K (`S-001`) and quote the text describing Seneca's competitive position, key competitors, and private-label share. Resolves industry claim `IC-001` from `partially-verified` to `verified` or `failed`.
- **P-002 — Lakeside ~90% statement archival.** Archive the Lakeside corporate statement (`S-004`) verbatim, with date and venue, and triangulate against `S-016` Circana / NielsenIQ aggregates and `S-012` Census ASM data. Resolves industry claims `IC-001`, `IC-005`, and the upstream open question `Q-001` (which competitor Lakeside names alongside itself).
- **P-003 — Smaller players quantification.** Retrieve corporate-website and trade-press references for Hanover Foods, Faribault Foods, Furmano's, Truitt Bros., and Allens / Sager Creek (`S-013`). Where possible, quote any corporate statement on volume or share. Resolves industry claim `IC-004`.
- **P-004 — Del Monte Chapter 11 entity and reorganization plan.** Pull the PACER docket (`S-008`) for the Del Monte Foods (U.S.) Chapter 11 case and confirm: (a) which legal entity filed (Del Monte Foods Inc. vs Del Monte Foods Holdings) — upstream open question `Q-004`; (b) reorganization vs liquidation posture; (c) timeline for plan confirmation. Triangulate via trade press (`S-014`). Resolves industry claims `IC-006` and `IC-007` and bear case item `B-003`.
- **P-005 — Del Monte Pacific deconsolidation primary text.** Retrieve and quote the relevant disclosure paragraphs in the Del Monte Pacific FY2025 annual report (`S-003`) describing the discontinued-operations classification and the May 2025 deconsolidation effective date. Resolves industry claim `IC-006`.
- **P-006 — Pricing-cost bridge across crop, steel/tinplate, freight, and labor cycles.** Reconstruct the FY2018–FY2025 revenue bridge (price vs volume vs mix) and gross-margin bridge (price vs raw produce vs tinplate vs freight vs labor) from `S-001` and `S-007` Item 7 MD&A; cross-reference tinplate price indices (`S-017`) and freight indices. Resolves claim `C-011` (also covered in financial-rebuild gap `F-008`) and industry claim `IC-008`; informs bear case item `B-005`.
- **P-007 — Substitution and category trend.** Retrieve and quote `S-012` (USDA ERS / Census ASM canned vegetable production and per-capita consumption series) and `S-016` (Circana / NielsenIQ canned vegetable category dollar and unit trend). Resolves industry claim `IC-010` and bear case items `B-001` and `B-009`.
- **P-008 — Customer concentration disclosure.** Retrieve and quote Item 1 / Item 1A of the FY2025 10-K (`S-001`) on customer concentration (any 10%+ customers, top-five customer share). Triangulate against retailer side disclosures (`S-015`) on private-label penetration. Resolves industry claim `IC-009` and bear case item `B-002`.
- **P-009 — Class B voting concentration.** Carry forward upstream open question `Q-006`: confirm combined Class A / Class B voting power held by the founding family / insiders via the FY2025 DEF 14A (`S-005`). Resolves bear case item `B-007`.

Until P-001 through P-009 close, this artifact remains `draft` and every industry claim graded `unverified` or `partially-verified` here remains so. Downstream tasks must update both this Markdown report and its JSON sibling (`research/senea/industry-bear-case.json`) once retrieval converts each pointer into quoted text.
