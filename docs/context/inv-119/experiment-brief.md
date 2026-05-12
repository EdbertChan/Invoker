# INV-119 Experiment Brief — Deterministic Proof of CI E2E Dry-Run Sharding

## Goal

Establish deterministic, evidence-backed proof that the e2e-dry-run sharding
architecture exposed via `.github/workflows/ci.yml`, `scripts/run-all-tests.sh`,
and `scripts/test-suites/required/20-e2e-dry-run.sh` (plus its sibling shards
`21-*` and `22-*`) has the properties the CI design relies on:

1. The three CI matrix shards (`case-1`, `case-2`, `case-4`) partition every
   `scripts/e2e-dry-run/cases/case-*.sh` script **disjointly and completely** —
   no case is covered twice and no case is silently skipped.
2. Each shard is a thin alphabetically-sorted bash wrapper around
   `scripts/e2e-dry-run/run-all.sh '<pattern>'`, so reordering the matrix in
   `.github/workflows/ci.yml` is observably equivalent to reordering the
   suite files locally.
3. The local entry point `pnpm run test:all` (driven by
   `scripts/run-all-tests.sh`) enumerates the same three shard suites in the
   same locale-stable order as the CI matrix, so a green local run is a
   superset of the CI dry-run signal.

The selected approach is the **status quo three-shard split**. We compare it
against two alternatives below and record the deterministic commands a
reviewer can run to falsify either design.

## Files under test

- `.github/workflows/ci.yml` — defines the `dry-run` job with a 3-entry
  matrix (`case-1` → `…/20-e2e-dry-run.sh`, `case-2` → `…/21-…`, `case-4` →
  `…/22-…`) running inside `mcr.microsoft.com/playwright:v1.58.2-noble`.
- `scripts/run-all-tests.sh` — tier-aware suite runner. Enumerates suites via
  `find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' | LC_ALL=C sort`,
  so the three shard wrappers are listed in lexicographic order alongside the
  rest of the required tier.
- `scripts/test-suites/required/20-e2e-dry-run.sh` — case-1 shard wrapper.
  Single line of business: `exec bash "$ROOT/scripts/e2e-dry-run/run-all.sh" 'case-1.*.sh'`.

Sibling shards under test (same contract as `20-*`):

- `scripts/test-suites/required/21-e2e-dry-run-downstream.sh` — case-2 glob.
- `scripts/test-suites/required/22-e2e-dry-run-github.sh` — case-4 glob.

## Selected design (status quo three-shard split)

The CI `dry-run` job declares a `strategy.matrix.include` of three rows:

```yaml
matrix:
  include:
    - { name: case-1, suite: scripts/test-suites/required/20-e2e-dry-run.sh }
    - { name: case-2, suite: scripts/test-suites/required/21-e2e-dry-run-downstream.sh }
    - { name: case-4, suite: scripts/test-suites/required/22-e2e-dry-run-github.sh }
```

Each shard wrapper is a one-liner that `exec`s `scripts/e2e-dry-run/run-all.sh`
with a single glob (`case-1.*.sh`, `case-2.*.sh`, or `case-4.*.sh`). The
glob covers every case script whose basename starts with the matching family
prefix; new cases enroll automatically by being dropped into
`scripts/e2e-dry-run/cases/` with the right prefix.

### Strengths

- **Single source of truth.** The case glob is the only enrollment surface.
  Add `case-1.99-foo.sh` and it joins the `case-1` shard with no CI change.
- **CI/local symmetry.** The same suite file runs in CI and in
  `pnpm run test:all`, so a green local run produces evidence about the same
  artifact as the CI matrix.
- **Locale-stable ordering.** `scripts/run-all-tests.sh` sorts via
  `LC_ALL=C sort`, so shard order is byte-stable across hosts.
- **Disjoint partition by prefix.** `case-1.*`, `case-2.*`, `case-4.*` are
  mutually exclusive globs; a case file can belong to at most one shard.

### Risks

- **Partition gaps are silent.** A `case-3.*.sh` (or `case-5.*.sh`) added
  without a matching shard wrapper would never run in CI yet would still be
  picked up by `scripts/e2e-dry-run/run-all.sh` when invoked without a glob.
- **Matrix drift.** `.github/workflows/ci.yml` lists the three suites
  explicitly; renaming a shard file requires updating the workflow. The
  required-fast / dry-run partition is intentional (different runners, Playwright
  container) and cannot be auto-derived from the suite filename alone.

## Alternative designs considered

A competing approach could either (A) collapse the three shards into a single
job that calls `scripts/e2e-dry-run/run-all.sh` with no glob, or (B) explode
each `case-*.sh` script into its own GHA matrix entry.

| Dimension | Status quo (3 family shards) | Alt A (one job, no glob) | Alt B (one job per case) |
|-----------|-----------------------------|--------------------------|--------------------------|
| Determinism of ordering | `LC_ALL=C sort` over family-prefixed wrappers | `cases/*.sh` glob from `run-all.sh` | Matrix order in YAML |
| CI parallelism | 3 jobs (one Playwright container each) | 1 job (serial) | N jobs (one per case) |
| Wall-clock under failure | Bounded by slowest family | Bounded by total runtime | Bounded by slowest single case |
| Enrollment cost | Drop a `case-N.M.*.sh` file | Drop a `case-*.sh` file | Drop a file **and** add a matrix entry |
| Partition completeness check | `diff <(union of globs) <(cases/*.sh)` | N/A (single bucket) | Required: every file ↔ matrix row |
| Local reproducibility | `bash <suite>.sh` matches CI exactly | Identical to CI | Local can't replicate matrix without harness |
| Coverage-gap blast radius | Gap only when a new family prefix appears (`case-3.*`, etc.) | None | One per missing matrix row |

### Alternative verdicts (Supported / Rejected / Deferred)

| Design / approach | Verdict | Reason |
|-------------------|---------|--------|
| Status quo: 3 family-prefix shards (`20/21/22-e2e-dry-run*.sh`) | **Supported** | Family-prefix partition is observable and disjoint; CI matrix size is small enough to audit visually; satisfies E1–E7 thresholds below. |
| Alt A: collapse to a single dry-run job calling `run-all.sh` with no glob | **Rejected** | Loses CI parallelism (≈3× wall-clock) and removes the explicit partition contract, so a future `case-3.*` would silently join the single bucket without a reviewer noticing the new family. |
| Alt B: one matrix entry per case script | **Rejected** | Enrollment cost rises (every new `case-N.M.*.sh` needs a YAML edit); Playwright container startup dominates per-case runtime; local replay diverges from CI matrix shape. |
| Auto-discover family prefixes (generate matrix from `cases/case-*.*.sh` basenames) | **Deferred** | Would close the silent-gap risk but requires a generator step or composite action; defer until a third family (`case-3` or `case-5`) is introduced or a partition gap is observed. |
| Move directly to implementation without evidence | **Rejected** | Violates the INV-119 reviewability requirement: no deterministic command can falsify the partition, and no threshold is recorded. |

**Selected design verdict:** the status quo is **Supported** and adopted. Alt A
and Alt B are **Rejected** for INV-119; the auto-discovery option is
**Deferred** with an explicit trigger (a third case family) so it is not
silently lost.

## Deterministic commands and expected outputs

Run these from the repo root. Each command produces a clear pass/fail exit
code and a stable token in stdout that a reviewer can grep for.

### E1 — Shard wrappers enumerate stably in required-tier sort order

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' \
  | LC_ALL=C sort \
  | grep -E '/(20|21|22)-e2e-dry-run.*\.sh$'
```

Expected (exact, in this order):

```
scripts/test-suites/required/20-e2e-dry-run.sh
scripts/test-suites/required/21-e2e-dry-run-downstream.sh
scripts/test-suites/required/22-e2e-dry-run-github.sh
```

Verdict PASS iff the three lines are byte-identical to the expected block.
Threshold: zero diff lines between runs (`diff <(...) <(...)` exits 0).

### E2 — CI matrix references exactly the three shard suites

```bash
grep -E 'suite: scripts/test-suites/required/2[0-2]-e2e-dry-run' \
  .github/workflows/ci.yml | LC_ALL=C sort
```

Expected: three matches, one for each of `20-`, `21-`, and `22-e2e-dry-run*.sh`.
Verdict PASS iff `wc -l` equals 3 and each shard file from E1 appears exactly
once. Threshold: `matched_count == 3 && |unique(suites)| == 3`.

### E3 — Each shard wrapper is a single `exec` to `run-all.sh` with one glob

```bash
for f in scripts/test-suites/required/20-e2e-dry-run.sh \
         scripts/test-suites/required/21-e2e-dry-run-downstream.sh \
         scripts/test-suites/required/22-e2e-dry-run-github.sh; do
  grep -E "^exec bash .*scripts/e2e-dry-run/run-all.sh' 'case-[124]\.\*\.sh'$" "$f" \
    || { echo "FAIL: $f"; exit 1; }
done
echo OK
```

Expected: `OK`. Verdict PASS iff every wrapper contains exactly one `exec bash
… run-all.sh 'case-N.*.sh'` line where `N ∈ {1, 2, 4}` and the wrapper
contains no other test-execution statements.

Threshold: zero non-matching wrappers.

### E4 — Partition is disjoint and complete over `scripts/e2e-dry-run/cases/`

```bash
shopt -s nullglob
ALL=$(ls scripts/e2e-dry-run/cases/case-*.sh | LC_ALL=C sort)
COVERED=$( { ls scripts/e2e-dry-run/cases/case-1.*.sh
             ls scripts/e2e-dry-run/cases/case-2.*.sh
             ls scripts/e2e-dry-run/cases/case-4.*.sh
           } | LC_ALL=C sort )

diff <(printf '%s\n' "$ALL") <(printf '%s\n' "$COVERED")
echo "exit=$?"
```

Expected: empty diff, `exit=0`. Verdict PASS iff every case script under
`scripts/e2e-dry-run/cases/` is matched by exactly one of the three shard
globs. Threshold: `|cases ∖ covered| == 0` AND `|covered ∖ cases| == 0`.

### E5 — Shard globs do not overlap each other

```bash
A=$(ls scripts/e2e-dry-run/cases/case-1.*.sh | LC_ALL=C sort)
B=$(ls scripts/e2e-dry-run/cases/case-2.*.sh | LC_ALL=C sort)
C=$(ls scripts/e2e-dry-run/cases/case-4.*.sh | LC_ALL=C sort)
comm -12 <(printf '%s\n' "$A") <(printf '%s\n' "$B") | wc -l
comm -12 <(printf '%s\n' "$A") <(printf '%s\n' "$C") | wc -l
comm -12 <(printf '%s\n' "$B") <(printf '%s\n' "$C") | wc -l
```

Expected: three lines of output, each `0`. Verdict PASS iff every pairwise
intersection is empty. Threshold: `|A ∩ B| + |A ∩ C| + |B ∩ C| == 0`.

### E6 — Case-1 shard invocation matches `run-all.sh` glob semantics

```bash
bash scripts/e2e-dry-run/run-all.sh 'case-1.*.sh' \
  2>&1 | head -1
```

Expected (first line): the literal banner emitted by `run-all.sh` for the
first matching case (`======== case-1.1-success.sh ========`). Verdict PASS
iff the first banner line corresponds to the lexicographically-smallest
`case-1.*.sh` file from E4. Threshold: banner matches `head -n 1` of the
sorted case-1 listing.

Note: this experiment exercises only the dispatch contract — a full run is
covered by E7 and the CI job itself.

### E7 — `pnpm run test:all` runs the three shards under the required tier

```bash
INVOKER_TEST_ALL_FAIL_FAST=0 pnpm run test:all 2>&1 \
  | grep -E '^==> Running (scripts/test-suites/required/(20|21|22)-e2e-dry-run)'
```

Expected: three `==> Running scripts/test-suites/required/2N-e2e-dry-run…`
lines, one for each shard, in lexicographic order. Verdict PASS iff the
required-tier run surfaces all three shards on a clean checkpoint. Threshold:
exactly three matching lines AND the surrounding `Failed: 0` summary line is
present.

## Summary verdict matrix

| Experiment | Pass criterion | Threshold |
|------------|----------------|-----------|
| E1 shard ordering | three lines, byte-identical to expected block | diff = 0 |
| E2 CI matrix references | `grep` returns three suite lines | matched = 3, unique = 3 |
| E3 wrapper shape | each wrapper `exec`s `run-all.sh` with one glob | non-matching = 0 |
| E4 partition complete | every `cases/case-*.sh` covered by one shard | symmetric diff = 0 |
| E5 partition disjoint | pairwise intersections empty | sum of \|A∩B\|, \|A∩C\|, \|B∩C\| = 0 |
| E6 dispatch contract | first banner matches sorted-first case-1 file | banner = expected |
| E7 local enumeration | three shard runs surfaced under required tier | matches = 3, Failed: 0 |

A run is considered deterministic proof for INV-119 iff E1–E7 all return
their PASS verdict on a clean checkout of this branch.

### Verdict mapping to overall decision

- All seven experiments PASS on their threshold → the three-shard design is
  **Supported**. Adopt without further changes.
- Any experiment FAILS on its threshold → the three-shard design is
  **Rejected** for that property; re-open the alternative-design comparison
  above for the failing dimension (most notably the auto-discovery deferral
  when E4 or E5 fails).
- An experiment cannot be executed in this environment (e.g. `pnpm` not
  installed for E7) → that experiment is **Deferred** and must be re-run
  once the prerequisite is available before the overall verdict is treated
  as final.

## How to reproduce end-to-end

```bash
git checkout experiment/wf-1778431092204-40/experiment-inv-119/g0.t2.a-a43282bac-18daf9f7
pnpm install --frozen-lockfile
# Run E1–E7 in order; abort on first failure.
```

E6 and E7 mutate `scripts/e2e-dry-run` working state and the
`$(git rev-parse --git-dir)/invoker-test-all-state.tsv` checkpoint
respectively; delete the checkpoint between runs if you need a clean baseline.
