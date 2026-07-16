# INV-117 deterministic experiment brief

Review claim: INV-117 should use the repository-owned proof harness in
`scripts/run-all-tests.sh` as the deterministic experiment surface, with
`.github/workflows/ci.yml` used as the CI parity map and
`scripts/workspace-test.sh` used as the package-level subproof.

Safety invariant: this slice adds evidence documentation only. It does not
change CI, runner behavior, package scripts, or test selection.

Slice rationale: the experiment proof is isolated before any architecture
change so reviewers can evaluate the evidence criteria independently.

Architectural effect: no runtime architecture changes. The selected proof
architecture makes `scripts/run-all-tests.sh` the local source of deterministic
thresholds and treats GitHub Actions as a distributed execution of the same
suite families.

## Files under test

- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) defines the
  CI surface: Node 26 with `CI=true`, build artifacts, quality checks, required
  fast suites, scheduled repros, dry-run shards, Playwright shards, SSH shards,
  optional suites, and the Docker comprehensive suite.
- [`scripts/workspace-test.sh`](../../../scripts/workspace-test.sh) defines the
  package workspace subproof: explicit concurrency override wins, CI defaults
  to concurrency 1, local runs default to concurrency 4, invalid concurrency
  exits 2, then `pnpm -r --workspace-concurrency="$CONCURRENCY" test` and
  `scripts/required-builds.sh` must both pass.
- [`scripts/run-all-tests.sh`](../../../scripts/run-all-tests.sh) defines the
  deterministic aggregate proof: proof mode forces rerun, disables resume, uses
  a temporary state file when none is supplied, emits a summary, and validates
  required thresholds before returning success.
- [`scripts/test-suites/`](../../../scripts/test-suites) supplies the concrete
  suites counted by the aggregate proof.

## Selected approach

Use the script-backed proof harness:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

This is the selected approach because proof mode makes the run independent of
previous checkpoints, requires an exact executed-suite count, requires zero
failures, and rejects unavailable skips except for the documented Docker-only
dangerous-suite exception.

CI remains part of the evidence, but as a parity map rather than the primary
experiment mechanism. The workflow proves that the same suite families are
split across reproducible GitHub Actions jobs, while the local proof command
keeps the threshold logic in one auditable script.

## Alternative considerations

Rejected primary design: CI-only proof through `.github/workflows/ci.yml`.

Reason: CI-only proof is reviewable for hosted execution, but it is not the
best deterministic experiment artifact. The workflow distributes suites across
matrices, conditional scheduled jobs, containers, system package setup, and
artifact download steps. It does not provide one local command with explicit
summary thresholds, resume bypass, or a fixed state-file policy.

Secondary design: direct one-by-one suite invocation from CI matrix commands.

Reason: direct invocation is useful for isolating a failing shard, but it loses
the aggregate threshold checks in `validate_proof_thresholds`, so it cannot be
the authoritative INV-117 proof.

## Deterministic command plan

Run all commands from the repository root and capture the commit under test:

```bash
git rev-parse HEAD
node --version
pnpm --version
bash -n scripts/workspace-test.sh
bash -n scripts/run-all-tests.sh
```

Expected output and verdict:

- `git rev-parse HEAD` prints one commit SHA; record it with the proof logs.
- `node --version` is recorded with the proof. It must report a Node 26 runtime
  when claiming CI parity with `.github/workflows/ci.yml`.
- `pnpm --version` must succeed.
- `bash -n` exits 0 and prints no diagnostics.
- Verdict: fail the proof if any command exits non-zero.

Confirm the suite registry counts used by the proof thresholds:

```bash
find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/optional -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
find scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort | wc -l
```

Expected output and verdict:

- Required count: `16`.
- Optional count: `7`.
- Dangerous count: `1`.
- Verdict: fail the proof if these counts do not match the thresholds below,
  because the registered suite set must match the hard-coded proof thresholds
  in `scripts/run-all-tests.sh`.

Run the package workspace subproof:

```bash
CI=1 INVOKER_WORKSPACE_TEST_CONCURRENCY=1 bash scripts/workspace-test.sh
```

Expected output and verdict:

- Output includes `==> Running package workspace tests (concurrency=1)`.
- Output includes `==> Running required package builds`.
- Command exits 0.
- Verdict: pass only when workspace package tests and required package builds
  both pass.

Run the required aggregate proof:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected output and verdict:

- Output starts with
  `==> Running Invoker test suites (mode=required, jobs=1, resume=0)`.
- Summary contains `Mode: required`.
- Summary contains `Executed: 16`.
- Summary contains `Failed: 0`.
- Summary contains `Skipped by checkpoint: 0`.
- Summary contains `Skipped unavailable: 0`.
- Command exits 0.
- Verdict: fail the proof on any failed suite, any checkpoint skip, any
  unavailable skip, or any executed count other than 16.

Run the extended aggregate proof when optional architecture coverage is needed:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected output and verdict:

- Output starts with
  `==> Running Invoker test suites (mode=extended, jobs=1, resume=0)`.
- Summary contains `Mode: extended`.
- Summary contains `Executed: 23`.
- Summary contains `Failed: 0`.
- Summary contains `Skipped by checkpoint: 0`.
- Summary contains `Skipped unavailable: 0`.
- Command exits 0.
- Verdict: fail the proof on any failed suite, any skip, or any executed count
  other than 23.

Run the destructive aggregate proof only in an environment approved for Docker
and dangerous suites:

```bash
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_EXTENDED=1 INVOKER_TEST_ALL_DANGEROUS=1 INVOKER_TEST_ALL_JOBS=1 bash scripts/run-all-tests.sh
```

Expected output and verdict:

- Output starts with
  `==> Running Invoker test suites (mode=dangerous, jobs=1, resume=0)`.
- Summary contains `Mode: dangerous`.
- Summary contains `Failed: 0`.
- Summary contains `Skipped by checkpoint: 0`.
- If Docker is available, summary contains `Executed: 24` and
  `Skipped unavailable: 0`.
- If Docker is unavailable, summary contains `Executed: 23`,
  `Skipped unavailable: 1`, and the only unavailable skip is
  `dangerous/10-docker-comprehensive.sh`.
- Command exits 0.
- Verdict: fail the proof on any failed suite, any checkpoint skip, more than
  one unavailable skip, an unavailable skip for any suite other than
  `dangerous/10-docker-comprehensive.sh`, or an executed count outside the
  Docker-availability rule above.

## Guardrail probes

Validate that invalid proof inputs fail deterministically:

```bash
INVOKER_WORKSPACE_TEST_CONCURRENCY=0 bash scripts/workspace-test.sh
```

Expected output and verdict:

- Stderr contains
  `ERROR: INVOKER_WORKSPACE_TEST_CONCURRENCY must be a positive integer`.
- Command exits 2.

```bash
INVOKER_TEST_ALL_JOBS=0 bash scripts/run-all-tests.sh
```

Expected output and verdict:

- Stderr contains `ERROR: INVOKER_TEST_ALL_JOBS must be a positive integer`.
- Command exits 2.

These probes are not part of the pass threshold for architecture validation;
they prove the harness rejects nondeterministic or invalid runner settings.

## CI parity checkpoints

Use `.github/workflows/ci.yml` as the hosted parity checklist:

- `build-artifacts` must build `@invoker/ui` and `@invoker/app`, then upload
  `app-build-dist.tgz`.
- `quality-checks` must pass `pnpm run check:deps`,
  `pnpm run check:required-builds`, and `pnpm run check:types`.
- `required-fast` must pass the required guardrails, Vitest workspace, workflow
  chain, branch carry-forward, merge-gate, MECE, task reset, and executor
  routing suites.
- `dry-run`, `playwright`, `ssh`, `optional-other`, and `docker` must pass
  their configured shards when those CI jobs are in scope.

Verdict: CI parity passes when every in-scope workflow job exits 0 and the
uploaded build artifact is present before downstream jobs run.

## Threshold summary

| Surface | Pass threshold |
| --- | --- |
| Syntax | `bash -n` exits 0 for the inspected scripts. |
| Suite registry | Required `16`, optional `7`, dangerous `1`. |
| Workspace subproof | Concurrency `1`, workspace tests pass, required builds pass. |
| Required proof | `Executed=16`, `Failed=0`, `Skipped by checkpoint=0`, `Skipped unavailable=0`. |
| Extended proof | `Executed=23`, `Failed=0`, `Skipped by checkpoint=0`, `Skipped unavailable=0`. |
| Dangerous proof | Docker available: `Executed=24`, no skips. Docker unavailable: `Executed=23`, exactly one unavailable skip for `dangerous/10-docker-comprehensive.sh`. |
| CI parity | Every in-scope workflow job exits 0 after build artifact extraction. |

Final INV-117 verdict: accept an architecture decision only when the selected
proof tier meets its threshold on the recorded commit SHA, and cite the command
output lines above in the review.
