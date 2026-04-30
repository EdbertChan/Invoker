# SENEA Claim Test — Index Deletion And Forced Selling

Test scope: only the S&P SmallCap 600 index deletion and forced-selling claim family from
the SENEA diligence plan (`/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`),
the claim ledger (`research/senea/claims-source-pack.json`), and the source register
(`research/senea/source-register.csv`). Anchor claim is **C-007**; supporting source is
**S-002**; the related open question is **Q-003**.

## Claim Family

The claim family bundles five testable sub-claims that together carry the "index deletion
caused forced, non-fundamental selling" narrative:

- **IS-1 — Deletion fact.** SENEA was deleted from the S&P SmallCap 600 in July 2023
  (parent claim C-007; source S-002).
- **IS-2 — Forced ETF/index selling.** The deletion mechanically forced index-tracking
  funds (e.g. iShares IJR, SPDR SLY, Vanguard VIOO) to liquidate their SENEA positions
  at or near the effective date, producing concentrated sell flow that is not driven by
  fundamentals (parent claim C-007; sources S-002 plus ETF holdings/flow data not yet
  in the source register).
- **IS-3 — Liquidity impact.** Post-deletion average daily volume, bid-ask spread, and
  price impact materially worsened versus a pre-deletion baseline, consistent with loss
  of dedicated index demand (parent claim C-007; market-data source not yet in the
  register).
- **IS-4 — Event-window attribution.** Abnormal returns inside the announcement-to-
  effective-date window are statistically distinguishable from contemporaneous market,
  small-cap, and food-sector returns, in the direction predicted by index-deletion
  literature (parent claim C-007; sources S-001 for fundamentals control, S-002 for the
  event date, plus market-data source not yet in the register).
- **IS-5 — Separation from fundamentals and factor moves.** Cumulative weakness in the
  event window, and any persistent post-event drift, cannot be explained by
  contemporaneous Seneca fundamental disclosures (10-K/10-Q/press releases), small-cap
  value factor moves, or food-sector moves (parent claim C-007; sources S-001, S-007,
  plus factor/sector data not yet in the register).

## Verdict

**Verdict: `unresolved`. Confidence in this verdict: `high`.**

All five sub-claims are unresolved at this stage of the diligence workflow. The
`research/senea/claims-source-pack.json` source register documents source S-002 as a
pointer to the S&P Dow Jones Indices index-action archive
(`https://www.spglobal.com/spdji/en/index-announcements/`) that is "to be retrieved",
and the project's own `scope` field states that "primary-source retrieval and pass/fail
verification are deferred to downstream tasks (financial-rebuild, industry-attack,
attribution)." Open question Q-003 in the same pack — "What is the precise effective
date of the S&P SmallCap 600 deletion in July 2023, and which constituent index ETFs
rebalanced on that date?" — is itself unanswered, so the announcement date, effective
date, and ETF set required for IS-2 through IS-5 are not yet on file.

No price, volume, ETF-holdings, or factor-return data has been collected into the
research artifact tree (`research/senea/` currently contains only `claims-source-pack.json`,
`claims-source-pack.md`, and `source-register.csv`; no `event_study.csv` or
`senea_metrics.csv` has been written). The plan's own decision Gate 4 is explicit that
"attribution only passes if event windows and factor/sector controls explain a meaningful
part of the dislocation without hand-waving" — that gate cannot be cleared from the
documents alone.

The verdict is therefore `unresolved`, and downstream tasks must collect the data listed
in **Open Questions** before any of IS-1 through IS-5 can flip to `pass` or `fail`.

## Event Timeline

The timeline below is the structure required for the event study. Dates marked
`needs-retrieval` are not yet pinned because S-002 has not been pulled and Q-003 is
still open; they must be filled before IS-1 through IS-5 can be scored.

| step | event | date | status | source |
| --- | --- | --- | --- | --- |
| T-1 | S&P Dow Jones Indices announcement of SENEA deletion from S&P SmallCap 600 | needs-retrieval (July 2023, exact day per S-002) | pending | S-002 |
| T-2 | Effective date of deletion (close of business on rebalance day) | needs-retrieval (July 2023, exact day per S-002) | pending | S-002 |
| T-3 | Final index-fund rebalance trade prints | needs-retrieval (typically T-2 close) | pending | S-002 + ETF prospectuses (not yet in register) |
| T-4 | Any contemporaneous Seneca disclosure inside the [T-1 - 5, T-2 + 5] window | needs-retrieval | pending | S-001, S-007 |
| T-5 | Russell reconstitution and other small-cap rebalances overlapping the same window | needs-retrieval (Russell reconstitution typically late June each year) | pending | external index calendar (not yet in register) |
| T-6 | Subsequent index events that could re-introduce or further remove SENEA | needs-retrieval | pending | S-002 |

The plan's `claim-ledger` section names this directly: "index deletion/forced selling"
is one of the explicit thesis pillars, and the `attribution` task is required to "run
event studies around S&P deletion ... Russell/S&P rebalance dates, and liquidity windows"
([senea_diligence_05efbabd.plan.md], "Invoker Task Plan", item 7).

## Price And Volume Evidence

No price or volume series has been collected into the research tree yet. The source
register's S-002 entry is an index-notice pointer; it does not contain market-data
fields. The plan's `nextArtifact` for C-007 is `artifacts/event_study.csv
(sp600_deletion_window)`, and that file has not been written.

The test design that must run once data is retrieved:

- **Daily closes and total-return series.** SENEA daily close, dividend-adjusted total
  return, and daily volume for at least [T-1 - 60, T-2 + 60] business days. Minimum
  acceptable source: SEC-filed Form 10-K Item 5 stock-performance graph data (S-001,
  S-007) cross-checked against an exchange feed; the plan does not yet name a market
  data vendor, so a vendor must be added to the source register before IS-3 / IS-4 can
  be scored.
- **Volume baseline.** 60-day pre-announcement median and mean daily volume vs the
  effective-date day, the day before, and the cumulative [T-2, T-2 + 5] window. The
  index-deletion literature predicts a one-day volume spike on T-2 (forced rebalance
  trade) followed by a step-down in baseline ADV.
- **Bid-ask spread / Amihud illiquidity.** Daily bid-ask spread and Amihud illiquidity
  ratio computed pre- and post-event; pre-event window [T-1 - 120, T-1 - 1], post-event
  window [T-2 + 5, T-2 + 125].
- **Abnormal return estimation.** Market-model and Fama-French-5 + momentum residuals
  using a [T-1 - 250, T-1 - 30] estimation window; cumulative abnormal returns reported
  for [T-1 - 1, T-1 + 1], [T-1, T-2], and [T-2, T-2 + 5].
- **Index ETF flow attribution.** Pre-event SENEA shares held by IJR (iShares Core S&P
  Small-Cap), SLY (SPDR S&P 600 Small Cap), and VIOO (Vanguard S&P Small-Cap 600 ETF),
  pulled from each fund's holdings file on the day before T-2; expected mechanical
  sell volume = sum of those positions. Compare expected mechanical sell volume to
  observed T-2 volume to size the forced-selling claim.

Until these series exist as committed artifacts in the research tree, the
price-and-volume side of the claim family cannot be scored, and IS-3 / IS-4 remain
`unresolved`.

## Contrary Evidence

Even before data is retrieved, four lines of contrary evidence are in scope and must be
addressed in the final scoring; surfacing them now keeps the verdict honest:

- **Concurrent fundamentals.** Seneca's FY2024 10-K (period ended late March 2024,
  filed in mid-2024) and FY2023 10-K cover the period that contains July 2023.
  Cumulative weakness over the months around the deletion can be substantially explained
  by reported earnings, LIFO-driven margin compression, or commodity moves rather than
  index flows. Source S-001 (FY2025 10-K) and S-007 (historical 10-K/10-Q set) are the
  documents that need to be checked for any earnings, guidance, or pricing disclosure
  inside the event window.
- **Small-cap value factor.** Mid-2023 was a period of broad small-cap value
  underperformance vs large-cap growth; a Fama-French / Russell 2000 Value control is
  required before attributing the cumulative move to index deletion. No factor return
  data is yet in the register.
- **Russell 2000 overlap.** The annual Russell reconstitution typically lands in late
  June of each year; depending on whether SENEA's Russell membership changed at the
  same time, part of any forced-selling effect may belong to Russell flows rather than
  S&P SmallCap 600 flows. This is the core of open question Q-003.
- **Pre-announcement drift / leakage.** S&P SmallCap 600 deletions are pre-announced;
  the cumulative abnormal return inside [T-1, T-2] may already be near zero by the
  effective date if arbitrageurs front-ran the rebalance, in which case the
  forced-selling claim survives as a microstructure / liquidity story but not as a
  price-discount story. This needs to be tested empirically rather than asserted.

These contrary lines are not "rebuttals to a confirmed claim"; they are the standard
specification controls without which IS-4 and IS-5 cannot be cleared at Gate 4 of the
plan.

## Source Attribution

Every conclusion above traces to documents already on the local register or to data
that is explicitly named in the open-questions list:

- The deletion event itself (IS-1, T-1, T-2): **S-002** — "S&P Dow Jones Indices
  announcement of the July 2023 deletion of Seneca Foods (SENEA) from the S&P SmallCap
  600", retrieval URL
  `https://www.spglobal.com/spdji/en/index-announcements/`.
- The contemporaneous-fundamentals control (IS-5, contrary evidence section):
  **S-001** — "Seneca Foods Corporation FY2025 Annual Report on Form 10-K (LIFO
  accounting, $359.3m LIFO reserve, FIFO-adjusted earnings, FIFO EBITDA disclosures)",
  retrieval URL
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10-K`,
  and **S-007** — "Seneca Foods historical 10-K and 10-Q filings (FY2005-FY2025) for
  balance-sheet and inventory reconstruction", retrieval URL
  `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0000088948&type=10`.
- The plan-level requirement that attribution must control for factor and sector moves:
  `/Users/edbertchan/.cursor/plans/senea_diligence_05efbabd.plan.md`, "Invoker Task
  Plan" item 7 ("Validate attribution") and "Decision Gates" Gate 4.
- The unresolved scope of S-002 retrieval: the source pack's own `scope` field plus
  open question **Q-003**, both inside `research/senea/claims-source-pack.json`.

ETF holdings/flow data, bid-ask/volume series, market-model factor returns, and the
Russell reconstitution calendar are **not yet in the source register** and must be
added before IS-2 through IS-5 are scored. Those gaps are tracked in the next section.

## Open Questions

The questions below are the exact diligence gaps that block the verdict from moving off
`unresolved`. They are sized so that each one maps to a discrete retrieval task.

1. **Q-IS-1 — Exact deletion dates.** Pull the S&P Dow Jones Indices announcement (S-002)
   and record the announcement date, the effective date, and the official cited reason
   for SENEA's deletion. Resolves: IS-1, plus T-1/T-2 in the event timeline. Mirrors
   pre-existing open question Q-003.
2. **Q-IS-2 — Index-fund holdings on the day before deletion.** Add a market-data /
   fund-holdings source to the register and pull SENEA share counts and dollar exposure
   in IJR, SLY, VIOO, and any other S&P SmallCap 600 trackers as of the close on T-2 - 1.
   Resolves: IS-2 expected mechanical sell volume.
3. **Q-IS-3 — Daily price/volume/spread series.** Retrieve SENEA daily OHLCV and bid-ask
   data covering [T-1 - 250, T-2 + 250]. Compute pre/post ADV, bid-ask, and Amihud
   illiquidity. Resolves: IS-3.
4. **Q-IS-4 — Event-study residuals.** Run market-model and Fama-French-5 + momentum
   regressions over the [T-1 - 250, T-1 - 30] estimation window and report cumulative
   abnormal returns over [T-1 - 1, T-1 + 1], [T-1, T-2], [T-2, T-2 + 5], and
   [T-2 + 6, T-2 + 60]. Resolves: IS-4.
5. **Q-IS-5 — Concurrent disclosures.** Catalogue every Seneca SEC filing, press
   release, and earnings release inside [T-1 - 30, T-2 + 30] (sources S-001, S-007),
   tag each as fundamental vs non-fundamental, and re-estimate residuals excluding
   fundamental-news days. Resolves: IS-5.
6. **Q-IS-6 — Russell and other index overlap.** Document SENEA's Russell 2000 / Russell
   2000 Value membership as of the same window and any reconstitution dates that fall
   inside the event window, so that S&P-driven flows can be separated from Russell-driven
   flows. Resolves: portion of IS-2 and IS-5; covers part of Q-003.

Until each of Q-IS-1 through Q-IS-6 has a committed artifact under `research/senea/`,
the index-deletion / forced-selling claim family stays at `unresolved`.
