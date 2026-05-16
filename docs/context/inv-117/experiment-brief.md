# INV-117 Experiment Brief: Deterministic CI Proof

## Goal

Establish deterministic experiment proof that the CI/test architecture is evidence-backed and reviewable.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`

## Selected approach

Use explicit GitHub Actions matrices for reviewable CI job names, backed by `scripts/run-all-tests.sh` as the local deterministic proof runner.

Evidence:

- `.github/workflows/ci.yml` builds UI/app once and uploads `app-build-dist.tgz` before test jobs consume it.
- `.github/workflows/ci.yml` gives quality, required repro, dry-run, Playwright, SSH, optional, and Docker surfaces separate named jobs or matrix names.
- `scripts/run-all-tests.sh` discovers suites from `required/`, `optional/`, and `dangerous/` with lexicographic ordering.
- `scripts/run-all-tests.sh` supports proof mode through `INVOKER_TEST_ALL_PROOF=1`, which forces reruns, disables resume skips, and validates summary thresholds.
- `scripts/workspace-test.sh` keeps package workspace tests deterministic in CI by defaulting workspace concurrency to `1` when `CI` is set.

## Competing design

Alternative: replace CI matrices with one monolithic `pnpm run test:all` job.

Verdict: rejected.

Reason: a monolithic job can reuse the local runner but hides failure ownership behind one CI status, collapses independent timeout/resource envelopes, and makes GitHub review evidence weaker. The selected design keeps deterministic local proof while preserving CI-level names such as `required-fast / Vitest Workspace`, `dry-run / case-1`, `playwright / 1-of-3`, `ssh / shard-30`, and `docker / comprehensive`.

## Deterministic commands

Run from the repository root.

### 1. Syntax gate

Command:

```sh
bash -n scripts/workspace-test.sh
bash -n scripts/run-all-tests.sh
```

Expected output:

```text
```

Threshold:

- Exit code is `0`.
- No stdout or stderr is emitted.

Verdict:

- Pass proves the two shell entrypoints are parseable before any runtime dependency is required.

### 2. Workspace concurrency proof

Command:

```sh
sed -n '7,23p' scripts/workspace-test.sh
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected output:

```text
if [ -n "${INVOKER_WORKSPACE_TEST_CONCURRENCY:-}" ]; then
  CONCURRENCY="$INVOKER_WORKSPACE_TEST_CONCURRENCY"
elif [ -n "${CI:-}" ]; then
  CONCURRENCY=1
else
  CONCURRENCY=4
fi

if ! [[ "$CONCURRENCY" =~ ^[0-9]+$ ]] || [ "$CONCURRENCY" -lt 1 ]; then
  echo "ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer" >&2
  exit 2
fi

echo "==> Running package workspace tests (concurrency=$CONCURRENCY)"
pnpm -r --workspace-concurrency="$CONCURRENCY" test
echo "==> Running required package builds"
bash "$ROOT/scripts/required-builds.sh"
ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer
```

Threshold:

- The static inspection must show CI defaults to `CONCURRENCY=1`.
- The static inspection must show local default concurrency is `4`.
- The static inspection must show explicit `INVOKER_WORKSPACE_TEST_CONCURRENCY` overrides both defaults.
- The invalid override case must exit `2` and emit the exact error line above.

Verdict:

- Pass proves CI serialization is deterministic while local override remains explicit and validated.

### 3. Suite inventory proof

Command:

```sh
printf 'required=%s\n' "$(find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' | wc -l | tr -d ' ')"
printf 'optional=%s\n' "$(find scripts/test-suites/optional -maxdepth 1 -type f -name '*.sh' ! -name '_*' | wc -l | tr -d ' ')"
printf 'dangerous=%s\n' "$(find scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' | wc -l | tr -d ' ')"
```

Expected output:

```text
required=16
optional=7
dangerous=1
```

Threshold:

- Required mode inventory is exactly `16` suites.
- Extended mode inventory is exactly `23` suites: `16 required + 7 optional`.
- Dangerous mode inventory is exactly `24` suites when Docker is available, or `23` executed suites plus one allowed unavailable skip for `dangerous/10-docker-comprehensive.sh`.

Verdict:

- Pass proves the runner thresholds in `scripts/run-all-tests.sh` match the concrete suite files under test.

### 4. Proof runner threshold

Command:

```sh
INVOKER_TEST_ALL_PROOF=1 bash scripts/run-all-tests.sh
```

Expected terminal summary:

```text
======== Summary ========
Mode: required
State file: /tmp/invoker-test-all-proof.*
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold:

- Exit code is `0`.
- `Mode` is `required`.
- `Executed` is exactly `16`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- `Skipped unavailable` is exactly `0`.

Verdict:

- Pass proves required local proof reruns all required suites and cannot pass by reusing checkpoint state.

### 5. Extended proof threshold

Command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 bash scripts/run-all-tests.sh
```

Expected terminal summary:

```text
======== Summary ========
Mode: extended
State file: /tmp/invoker-test-all-proof.*
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold:

- Exit code is `0`.
- `Mode` is `extended`.
- `Executed` is exactly `23`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- `Skipped unavailable` is exactly `0`.

Verdict:

- Pass proves optional suites are included only when explicitly requested and still use proof-mode threshold enforcement.

### 6. Dangerous proof threshold

Command:

```sh
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 bash scripts/run-all-tests.sh
```

Expected terminal summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.*
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected terminal summary when Docker is unavailable:

```text
======== Summary ========
Mode: dangerous
State file: /tmp/invoker-test-all-proof.*
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 1

Unavailable skips:
  dangerous/10-docker-comprehensive.sh
```

Threshold:

- Exit code is `0`.
- `Mode` is `dangerous`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- Docker-available environments must execute exactly `24` suites and skip none.
- Docker-unavailable environments may execute exactly `23` suites with exactly one unavailable skip, and that skip must be `dangerous/10-docker-comprehensive.sh`.

Verdict:

- Pass proves the destructive surface is opt-in, deterministic, and explicit about host capability rather than silently dropping Docker coverage.

## Review verdict

Selected design passes if all syntax, inventory, and proof-runner thresholds above pass. It fails if any suite count drifts without updating `scripts/run-all-tests.sh`, if proof mode can skip by checkpoint, if an unexpected unavailable skip appears, or if CI collapses named evidence into an unreviewable monolithic status.
