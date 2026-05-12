# INV-67 Experiment Brief — Deterministic Proof of Test Surface

## Goal

Establish deterministic, evidence-backed proof that the Invoker test surface
exposed via `pnpm test`, `pnpm run test:all`, and the suite runner has the
properties the architecture relies on:

1. `pnpm test` runs every workspace package's `vitest run` serially under a
   bounded concurrency.
2. `pnpm run test:all` walks `scripts/test-suites/<tier>/*.sh` in deterministic
   sorted order, honoring `required`/`optional`/`dangerous` tiering and the
   checkpoint state file.
3. Resume/parallel/fail-fast modes are gated by explicit env vars; the default
   invocation is reproducible regardless of host CPU count.

The selected approach is the existing trio of scripts. We compare it against an
alternative below, and we record the deterministic commands a reviewer can run
to falsify either design.

## Files under test

- `scripts/run-all-tests.sh` — tier-aware suite runner with checkpointing,
  preflight, and optional parallelism (`INVOKER_TEST_ALL_JOBS`).
- `scripts/workspace-test.sh` — workspace-wide vitest driver wrapped around
  `pnpm -r --workspace-concurrency=$CONCURRENCY test` plus
  `scripts/required-builds.sh`.
- `package.json` — declares `test`, `test:all`, `test:all:extended`,
  `test:all:destructive`, and the high/low-resource variants.

## Selected design (status quo)

`pnpm test` → `scripts/test-plan-to-invoker-skill.sh` + `workspace-test.sh`.
`workspace-test.sh` defaults to `CONCURRENCY=4` locally and `CONCURRENCY=1`
under `CI=1`; an explicit `INVOKER_WORKSPACE_TEST_CONCURRENCY` overrides both.
`pnpm run test:all` shells into `run-all-tests.sh`, which:

- Resolves `MODE_KEY` from `INVOKER_TEST_ALL_EXTENDED` and
  `INVOKER_TEST_ALL_DANGEROUS` (`required` → `extended` → `dangerous`).
- Enumerates suites via `find ... -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort`,
  which makes ordering locale-stable.
- Persists `mode|suite\tstatus` rows into `$GIT_DIR/invoker-test-all-state.tsv`
  so `INVOKER_TEST_ALL_RESUME=1` can skip prior `passed` / `skipped-unavailable`
  entries unless `INVOKER_TEST_ALL_FORCE_RERUN=1`.

### Strengths

- Single source of truth (`scripts/test-suites/<tier>/`) — adding a `.sh` file
  is the only step needed to enroll a new suite.
- Checkpoint file lives under `.git/`, so worktrees don't leak state across
  branches.
- Parallelism is opt-in via `INVOKER_TEST_ALL_JOBS`, gated by an allowlist of
  parallel-safe suites in `is_parallel_safe` — by default jobs=1, which is
  deterministic.

### Risks

- `is_parallel_safe` is hand-curated; an unsafe suite added to that allowlist
  could race and fail intermittently when `JOBS>1`.
- `should_skip_for_resume` skips `passed` and `skipped-unavailable` — a flaky
  suite that previously passed will be silently skipped on resume.

## Alternative design considered — `pnpm -r --filter` matrix

A competing approach would replace `run-all-tests.sh` with a `pnpm -r --filter
'./packages/**' test` invocation plus a parallel GitHub Actions matrix per
workspace package, with shell suites kept only as optional integration smoke
tests.

| Dimension | Status quo (scripts/run-all-tests.sh) | Alternative (pnpm matrix) |
|-----------|---------------------------------------|--------------------------|
| Determinism of ordering | `LC_ALL=C sort` over filenames | `pnpm -r` topology, depends on workspace graph |
| Local reproducibility | Single bash entrypoint, no CI dependency | Requires emulating GHA matrix locally |
| Checkpointing | TSV state file, opt-in resume | None (matrix re-runs entire shard) |
| Skip-unavailable signal | `suite_preflight` exits 10 | Job-level `if:` conditions |
| Parallel safety | Curated allowlist (`is_parallel_safe`) | Implicit (one job per package) |
| Cost of adding a suite | Drop `.sh` into `scripts/test-suites/<tier>/` | New workflow file or matrix entry |

### Alternative verdicts (Supported / Rejected / Deferred)

Each design considered for INV-67 is classified with an explicit verdict so the
decision is reviewable without re-deriving the tradeoffs:

| Design / approach | Verdict | Reason |
|-------------------|---------|--------|
| Status quo: `scripts/run-all-tests.sh` + `workspace-test.sh` tiering | **Supported** | Deterministic ordering (`LC_ALL=C sort`), checkpoint resume scoped to `.git/`, parallel safety gated by an explicit allowlist. Satisfies E1–E8 thresholds below. |
| `pnpm -r --filter` + GHA matrix replacement | **Rejected** | Loses local replay and checkpoint resume; topology-order rather than locale-stable ordering; cost of adding a suite rises (new workflow/matrix entry). Reconsider only if CI elapsed time becomes the dominant cost. |
| Move directly to implementation without evidence | **Rejected** | Violates the INV-67 reviewability requirement: no deterministic command can falsify the design and no threshold is recorded. |
| Evaluate alternatives informally without deterministic checks | **Rejected** | Informal evaluation cannot produce a pass/fail exit code; reviewers cannot reproduce the verdict from a clean checkout. |
| Migrate checkpoint state out of `.git/` into a repo-tracked path | **Deferred** | Worth revisiting if multi-host shared runners need to read the checkpoint, but not required for INV-67's local-replay scope. No experiment in this brief depends on it. |
| Auto-discover parallel-safe suites instead of curated `is_parallel_safe` | **Deferred** | Currently no signal in `scripts/test-suites/<tier>/*.sh` to declare parallel safety; deferring until the suite metadata is formalized. The curated allowlist remains the safe default. |

**Selected design verdict:** the status quo is **Supported** and adopted. The
matrix variant is **Rejected** for INV-67 and re-evaluable later; the two
Deferred items are tracked here so they are not silently lost.

## Deterministic commands and expected outputs

Run these from the repo root. Each command produces a clear pass/fail exit
code and a stable token in stdout that a reviewer can grep for.

### E1 — Tier enumeration is alphabetically stable

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' \
  | LC_ALL=C sort \
  | sed "s#^scripts/test-suites/required/##"
```

Expected: the same ordered list across runs, machines, and locales. Verdict
PASS iff the output is byte-identical between two consecutive invocations.

Threshold: zero diff lines between runs (`diff <(...) <(...)` exits 0).

### E2 — `pnpm test` default concurrency is bounded

```bash
INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected: every workspace package's vitest run executes exactly once, in
workspace-topology order. Verdict PASS iff exit code is 0 and the trailing
`scripts/required-builds.sh` invocation succeeds. Threshold: total failed
packages = 0.

Comparison run (default local concurrency):

```bash
bash scripts/workspace-test.sh
```

Expected: identical pass/fail verdict to the bounded run; only wall-clock
differs. Verdict PASS iff the set of failing packages is empty in both runs.

### E3 — `test:all` baseline (required tier only)

```bash
pnpm run test:all
```

Expected stdout contains:

```
==> Running Invoker test suites (mode=required, jobs=1, resume=0)
======== Summary ========
Mode: required
Failed: 0
```

Verdict PASS iff exit code is 0 and the `Failed: 0` line is present.
Threshold: `Failed` and `Skipped unavailable` counts are both 0 on a healthy
checkout; any non-zero value is a hard fail.

### E4 — Mode escalation surfaces extra suites deterministically

```bash
pnpm run test:all:extended -- --dry-run 2>/dev/null \
  || env INVOKER_TEST_ALL_EXTENDED=1 \
       INVOKER_TEST_ALL_FAIL_FAST=1 \
       bash scripts/run-all-tests.sh 2>&1 \
     | grep -E '^==> (Starting|Running) '
```

Expected: the list strictly contains all suites from E1 plus
`scripts/test-suites/optional/*.sh`. Verdict PASS iff every `required/*.sh`
from E1 appears in the listing and at least one `optional/*.sh` appears.

Threshold: `|extended_listing ∖ required_listing| ≥ 1`.

### E5 — Checkpoint resume skips prior passes

```bash
pnpm run test:all                                            # populate state
INVOKER_TEST_ALL_RESUME=1 pnpm run test:all 2>&1 | tee /tmp/inv67-resume.log
grep -c '^==> Running ' /tmp/inv67-resume.log
grep -c '^Checkpoint skips:' /tmp/inv67-resume.log
```

Expected: on the second run, the number of `==> Running` lines is 0 and the
`Checkpoint skips:` block is present. Verdict PASS iff both counts satisfy
`running == 0 && skips == 1`.

Threshold: zero suites re-executed on a clean resume.

### E6 — Force-rerun overrides resume

```bash
INVOKER_TEST_ALL_RESUME=1 INVOKER_TEST_ALL_FORCE_RERUN=1 pnpm run test:all \
  2>&1 | grep -c '^==> Running '
```

Expected: equals the count from E1 (every required suite re-executes).
Verdict PASS iff `force_run_count == required_count`.

### E7 — Invalid `INVOKER_TEST_ALL_JOBS` is rejected

```bash
INVOKER_TEST_ALL_JOBS=0 bash scripts/run-all-tests.sh; echo "exit=$?"
INVOKER_TEST_ALL_JOBS=abc bash scripts/run-all-tests.sh; echo "exit=$?"
```

Expected: both invocations write
`ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer` to stderr and exit
with code 2. Verdict PASS iff both exit codes are exactly 2.

Threshold: exit code is 2 (not 1, not 0) for both inputs.

### E8 — Dangerous tier is opt-in

```bash
env INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=0 \
  bash scripts/run-all-tests.sh 2>&1 \
  | grep -q 'mode=extended' && echo OK || echo FAIL
```

Expected: `OK` — extended mode without dangerous flag must not surface
`dangerous/*` suites. Verdict PASS iff stdout is `OK` and the run contains no
`dangerous/` suite path.

Threshold: zero `dangerous/` suite paths in stdout when dangerous flag is 0.

## Summary verdict matrix

| Experiment | Pass criterion | Threshold |
|------------|---------------|-----------|
| E1 ordering | byte-identical output across runs | diff = 0 |
| E2 workspace test | exit 0 from `workspace-test.sh` | failed packages = 0 |
| E3 test:all baseline | exit 0, `Failed: 0` present | failed = 0, skipped-unavailable = 0 |
| E4 extended tier | every required suite + ≥1 optional listed | extended ⊋ required |
| E5 resume skip | running = 0, skips block present | running = 0 |
| E6 force-rerun | running = required count | force = required |
| E7 bad JOBS rejected | exit 2 with explicit error | exit = 2 |
| E8 dangerous opt-in | no `dangerous/` path under extended-only | dangerous count = 0 |

A run is considered deterministic proof for INV-67 iff E1–E8 all return their
PASS verdict on a clean checkout of this branch.

### Verdict mapping to overall decision

- All eight experiments PASS on their threshold → status quo design is
  **Supported**. Adopt without further changes.
- Any experiment FAILS on its threshold → status quo design is **Rejected** for
  that property; re-open the alternative-design comparison above for the
  failing dimension.
- An experiment cannot be executed in this environment (e.g. dangerous tier
  requires opt-in fixtures not present) → that experiment is **Deferred** and
  must be re-run once the prerequisite is available before the overall verdict
  is treated as final.

## How to reproduce end-to-end

```bash
git checkout experiment/wf-1778431032727-27/experiment-inv-67/g2.t5.a-abb789eb8-1a5b683a
pnpm install --frozen-lockfile
# Run E1–E8 in order; abort on first failure.
```

The state file written by E3/E5/E6 lives at
`$(git rev-parse --git-dir)/invoker-test-all-state.tsv`. Delete it between
runs if you need a clean checkpoint baseline.
