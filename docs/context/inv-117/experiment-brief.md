# INV-117 Experiment Brief

## Goal

Establish deterministic experiment proof for INV-117 so architecture choices are evidence-backed and reviewable.

## Files Under Test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Architecture Choice

Selected approach: use `scripts/run-all-tests.sh` proof mode as the deterministic experiment interface, with CI topology as the cross-check.

The proof runner is the better review target because it converts architecture assumptions into executable thresholds:

- `INVOKER_TEST_ALL_PROOF=1` forces rerun behavior by setting `FORCE_RERUN=1` and `RESUME=0`, preventing prior checkpoint state from satisfying the experiment.
- Suite discovery is deterministic because `collect_suites` reads `required`, then `optional`, then `dangerous`, and sorts each directory with `LC_ALL=C sort`.
- `validate_proof_thresholds` fails the command unless executed suite counts, failure counts, checkpoint skips, and unavailable skips match the selected mode.
- Per-suite logs and the final summary make the result auditable without relying on GitHub Actions UI state.

Competing design considered: treat `.github/workflows/ci.yml` as the only proof artifact.

Verdict: reject as the primary experiment proof. CI is necessary for merge confidence, but the workflow fans suites into matrix jobs and event-specific jobs. That topology proves repository health, not a single reproducible local command with explicit numeric thresholds. It is also harder to review threshold drift because counts are implicit in matrix entries rather than enforced by one threshold function.

## Deterministic Commands

Run from the repository root after `pnpm install --frozen-lockfile`.

### Required proof

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Expected final output:

```text
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Exit threshold: command exits `0`. Any nonzero exit is a failed proof.

Verdict threshold:

- Pass when all four expected summary counters match exactly.
- Fail when `Executed` is not `16`, `Failed` is not `0`, `Skipped by checkpoint` is not `0`, or `Skipped unavailable` is not `0`.

### Extended proof

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
```

Expected final output:

```text
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Exit threshold: command exits `0`. Any nonzero exit is a failed proof.

Verdict threshold:

- Pass when all four expected summary counters match exactly.
- Fail when `Executed` is not `23`, `Failed` is not `0`, `Skipped by checkpoint` is not `0`, or `Skipped unavailable` is not `0`.

### Destructive proof

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Expected final output when Docker is available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected final output when Docker is unavailable:

```text
======== Summary ========
Mode: dangerous
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1

Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Exit threshold: command exits `0`. Any nonzero exit is a failed proof.

Verdict threshold:

- Pass when Docker is available and `Executed=24`, `Failed=0`, `Skipped by checkpoint=0`, and `Skipped unavailable=0`.
- Pass when Docker is unavailable only if the single unavailable skip is exactly `dangerous/10-docker-comprehensive.sh`, with `Executed=23`, `Failed=0`, and `Skipped by checkpoint=0`.
- Fail for any other unavailable skip, more than one unavailable skip, any failed suite, or any checkpoint skip.

### Workspace concurrency cross-check

Command:

```bash
CI=true bash scripts/workspace-test.sh
```

Expected output:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Verdict threshold:

- Pass when the command exits `0` and the first status line reports `concurrency=1`.
- Fail when `INVOKER_WORKSPACE_TEST_CONCURRENCY` is invalid, because the script must exit `2` with `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.

## CI Cross-Check

`.github/workflows/ci.yml` pins `NODE_VERSION: '26'`, installs with `pnpm install --frozen-lockfile`, builds shared UI/app artifacts once, and then reuses those artifacts across required, dry-run, Playwright, SSH, optional, and Docker jobs.

The CI shape should remain consistent with the proof runner:

- Required CI jobs cover the required shell suites directly or through grouped commands.
- Optional CI jobs cover Playwright, SSH, worktree provisioning, and visual proof suites.
- Docker CI covers `scripts/test-suites/dangerous/10-docker-comprehensive.sh` after building the required Docker images.

Verdict: CI remains the merge confidence layer, while proof mode remains the deterministic architecture experiment layer.

## Review Checklist

- Confirm `scripts/run-all-tests.sh` still reports `Mode`, `Executed`, `Failed`, `Skipped by checkpoint`, and `Skipped unavailable`.
- Confirm proof mode still sets `RESUME=0` and forces rerun behavior.
- Confirm expected executed counts match the sorted suite files under `scripts/test-suites`.
- Confirm `.github/workflows/ci.yml` still exercises the same required, optional, and dangerous suite families.
