# INV-117 Experiment Brief

## Goal

Establish deterministic experiment proof for the CI and local test orchestration architecture so the selected approach is evidence-backed and reviewable.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use `scripts/run-all-tests.sh` as the deterministic proof orchestrator, with CI split into bounded jobs in `.github/workflows/ci.yml` and package workspace tests delegated to `scripts/workspace-test.sh`.

Evidence:

- `.github/workflows/ci.yml` pins CI to `NODE_VERSION: '26'`, sets `CI: true`, builds app artifacts once, and fans required repros into named matrix shards.
- `scripts/workspace-test.sh` makes workspace package tests deterministic in CI by selecting `CONCURRENCY=1` whenever `CI` is set, while still allowing explicit override through `INVOKER_WORKSPACE_TEST_CONCURRENCY`.
- `scripts/run-all-tests.sh` discovers suites lexicographically from `scripts/test-suites/{required,optional,dangerous}`, supports resumable state for normal use, and switches to proof mode with `INVOKER_TEST_ALL_PROOF=1`.
- Proof mode forces reruns, disables resume, uses a temporary proof state file by default, and validates summary thresholds before exiting successfully.

## Competing design considered

Alternative: keep all proof logic in `.github/workflows/ci.yml` as explicit matrix entries and rely on GitHub Actions job success as the proof artifact.

Verdict: rejected for INV-117 proof. The workflow matrix is useful for CI wall-clock time and isolation, but it is not the best source of deterministic local evidence because suite discovery, resume behavior, unavailable-preflight handling, and expected counts would be duplicated in YAML. Keeping proof thresholds in `scripts/run-all-tests.sh` gives reviewers one local command that exercises the same suite registry documented by `scripts/test-suites/README.md`.

## Deterministic commands

Run from the repository root.

### 1. Static syntax proof

Command:

```bash
bash -n scripts/workspace-test.sh scripts/run-all-tests.sh
```

Expected output:

```text
<no stdout or stderr>
```

Expected exit code: `0`.

Verdict threshold: any shell parse error fails the experiment.

Observed in this worktree: exit code `0`, no output.

### 2. Suite-count proof

Command:

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/optional -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
```

Expected output:

```text
16
7
1
```

Expected exit code: `0`.

Verdict threshold:

- Required proof must execute `16` suites.
- Extended proof must execute `23` suites.
- Destructive proof must execute `24` suites, or `23` suites plus one allowed unavailable skip for `dangerous/10-docker-comprehensive.sh`.

Observed in this worktree: `16`, `7`, and `1`.

### 3. Required proof run

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Expected summary:

```text
======== Summary ========
Mode: required
State file: /tmp/invoker-test-all-proof.<suffix>
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected exit code: `0`.

Verdict threshold: exact summary counts above. Any failed suite, checkpoint skip, unavailable skip, or non-zero exit fails the experiment.

### 4. Extended proof run

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
```

Expected summary:

```text
======== Summary ========
Mode: extended
State file: /tmp/invoker-test-all-proof.<suffix>
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected exit code: `0`.

Verdict threshold: exact summary counts above.

### 5. Destructive proof run

Command:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Expected summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.<suffix>
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary when Docker is unavailable:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.<suffix>
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1

Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Expected exit code: `0`.

Verdict threshold: no failures, no checkpoint skips, and at most one unavailable skip. The only allowed unavailable skip is `dangerous/10-docker-comprehensive.sh`.

## Decision

Select the script-centered proof architecture. CI remains the review-facing execution surface, but `scripts/run-all-tests.sh` is the deterministic proof authority because it owns suite discovery, proof-mode reruns, summary printing, and threshold validation in one executable path.
