# INV-119 Experiment Brief

## Goal

Establish deterministic experiment proof for INV-119 so the architecture choice is backed by a reviewable command surface instead of an implicit local workflow.

## Files under test

- `.github/workflows/ci.yml`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/required/20-e2e-dry-run.sh`
- `scripts/e2e-dry-run/run-all.sh`
- `scripts/e2e-dry-run/cases/case-1.1-success.sh`
- `scripts/e2e-dry-run/cases/case-1.2-failure.sh`
- `scripts/e2e-dry-run/cases/case-1.3-cancel.sh`
- `scripts/e2e-dry-run/cases/case-1.4-edit-restart.sh`
- `scripts/e2e-dry-run/cases/case-1.5-fix-approve.sh`
- `scripts/e2e-dry-run/cases/case-1.6-fix-reject.sh`
- `scripts/e2e-dry-run/cases/case-1.7-manual-approve.sh`
- `scripts/e2e-dry-run/cases/case-1.8-manual-reject.sh`
- `scripts/e2e-dry-run/cases/case-1.9-fix-codex-approve.sh`

## Selected approach

Use the CI dry-run shard wrapper as the deterministic proof surface:

```bash
bash scripts/test-suites/required/20-e2e-dry-run.sh
```

This delegates to:

```bash
bash scripts/e2e-dry-run/run-all.sh 'case-1.*.sh'
```

The shard is selected because `.github/workflows/ci.yml` runs it directly in the `dry-run / case-1` matrix job after restoring the shared app and UI build artifacts. The same workflow file also runs the broader required and quality checks, so this proof aligns with CI instead of inventing an INV-119-only path.

## Competing design considered

Alternative: use the monolithic local orchestrator as the only proof command:

```bash
pnpm run test:all
```

That command enters `scripts/run-all-tests.sh`, discovers every non-private shell suite under `scripts/test-suites/required/`, and prints a global summary. It is useful for local confidence, but it is less reviewable for INV-119 because the case-1 evidence is mixed with unrelated guardrail, Vitest, downstream dry-run, GitHub dry-run, and routing suites.

Verdict: keep `pnpm run test:all` as the broader regression check, but use `scripts/test-suites/required/20-e2e-dry-run.sh` as the primary deterministic experiment proof. The selected proof is narrower, maps one-to-one to the CI dry-run shard, and keeps the expected output threshold specific to the case-1 architecture behavior.

## Deterministic commands

### 1. Prove CI wires the selected shard

```bash
rg -n '^  dry-run:|name: dry-run|case-1|20-e2e-dry-run|Run dry-run shard|bash \$\{\{ matrix\.suite \}\}' .github/workflows/ci.yml
```

Expected output must include:

```text
dry-run:
name: dry-run / ${{ matrix.name }}
name: case-1
suite: scripts/test-suites/required/20-e2e-dry-run.sh
Run dry-run shard
bash ${{ matrix.suite }}
```

Threshold: all six listed strings must be present. Missing any string means the proof no longer maps directly to CI and this brief must be updated before INV-119 can be accepted.

### 2. Prove the required wrapper is a thin shard

```bash
sed -n '1,40p' scripts/test-suites/required/20-e2e-dry-run.sh
```

Expected output must include:

```text
set -euo pipefail
exec bash "$ROOT/scripts/e2e-dry-run/run-all.sh" 'case-1.*.sh'
```

Threshold: the wrapper must keep `set -euo pipefail` and must exec `scripts/e2e-dry-run/run-all.sh` with only the `case-1.*.sh` pattern. If additional case patterns are added, the expected case count and verdict in this document must change.

### 3. Prove the selected shard has a stable case set

```bash
find scripts/e2e-dry-run/cases -maxdepth 1 -type f -name 'case-1.*.sh' | LC_ALL=C sort
```

Expected output:

```text
scripts/e2e-dry-run/cases/case-1.1-success.sh
scripts/e2e-dry-run/cases/case-1.2-failure.sh
scripts/e2e-dry-run/cases/case-1.3-cancel.sh
scripts/e2e-dry-run/cases/case-1.4-edit-restart.sh
scripts/e2e-dry-run/cases/case-1.5-fix-approve.sh
scripts/e2e-dry-run/cases/case-1.6-fix-reject.sh
scripts/e2e-dry-run/cases/case-1.7-manual-approve.sh
scripts/e2e-dry-run/cases/case-1.8-manual-reject.sh
scripts/e2e-dry-run/cases/case-1.9-fix-codex-approve.sh
```

Threshold: exactly 9 files must be returned, sorted bytewise with `LC_ALL=C`. Any added, removed, or renamed case changes the proof surface and requires a brief update.

### 4. Prove the e2e runner fails closed

```bash
sed -n '1,90p' scripts/e2e-dry-run/run-all.sh
```

Expected output must include:

```text
if [ "${#matches[@]}" -eq 0 ]; then
  echo "No case scripts matched pattern: $pattern"
  exit 1
fi
echo "e2e-dry-run: $passed passed, $failed failed (${#cases[@]} total)"
if [ "$failed" -ne 0 ]; then
  exit 1
fi
exit 0
```

Threshold: unmatched patterns and nonzero failed-case counts must both exit nonzero. The final success threshold for INV-119 is:

```text
e2e-dry-run: 9 passed, 0 failed (9 total)
```

### 5. Run the selected proof

```bash
bash scripts/test-suites/required/20-e2e-dry-run.sh
```

Expected final line:

```text
e2e-dry-run: 9 passed, 0 failed (9 total)
```

Threshold: exit code must be `0`; passed count must be `9`; failed count must be `0`; total count must be `9`. Any nonzero exit code or different count is a failed INV-119 proof.

### 6. Run the broader local regression surface

```bash
INVOKER_TEST_ALL_FAIL_FAST=1 pnpm run test:all
```

Expected summary must include:

```text
======== Summary ========
Mode: required
Failed: 0
```

Threshold: exit code must be `0` and the required-mode summary must report `Failed: 0`. This is supporting evidence, not the primary INV-119 proof, because it covers more than the case-1 architecture behavior.

## Verdict

Selected design accepted: use the CI dry-run case-1 shard as the deterministic experiment proof for INV-119.

Rationale:

- It is the same executable entry point used by `.github/workflows/ci.yml`.
- It references a concrete wrapper under `scripts/test-suites/required/`.
- It expands to a stable, sorted set of 9 case scripts under `scripts/e2e-dry-run/cases/`.
- Its runner fails closed for unmatched patterns and failed cases.
- Its acceptance threshold is concrete: `e2e-dry-run: 9 passed, 0 failed (9 total)` with exit code `0`.

The competing monolithic orchestrator remains valuable for regression coverage, but it is not the chosen INV-119 proof because it makes the architecture evidence harder to review in isolation.
