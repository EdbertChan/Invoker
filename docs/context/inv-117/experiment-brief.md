# INV-117 Experiment Brief

## Claim

INV-117 proof should be established by the existing `scripts/run-all-tests.sh`
proof contract and the CI `e2e-proof` shard plus aggregate lane. The package
workspace wrapper remains supporting build/package evidence, not the thresholded
proof gate.

## Concrete Files Under Test

- `.github/workflows/ci.yml`: defines the `e2e-proof` four-shard job and the
  `e2e-proof / aggregate` job that merges shard state and reruns the proof
  contract.
- `scripts/run-all-tests.sh`: owns `INVOKER_TEST_ALL_PROOF=1`, manifest-backed
  suite discovery, shard slicing, aggregate state validation, and INV-117
  thresholds.
- `scripts/workspace-test.sh`: runs package workspace tests and required builds;
  its comment explicitly leaves INV-117 proof thresholds in `run-all-tests.sh`.
- `scripts/test-suites/proof-e2e.manifest`: names the e2e suites that the proof
  contract counts.

## Alternatives Considered

| Option | Label | Cost to reverse | Kill condition | Verdict |
| --- | --- | --- | --- | --- |
| Use `scripts/run-all-tests.sh` proof mode with CI shard execution and aggregate validation. | considered: `scripts/run-all-tests.sh` defines `PROOF_CONTRACT="INV-117"` and proof thresholds; `.github/workflows/ci.yml` runs four proof shards and an aggregate validator. | Medium. Reversal requires removing the CI proof lane and proof branches in `run-all-tests.sh`. | Aggregate output can miss shard failures, inventory drift, failed suites, checkpoint skips, or disallowed unavailable skips. | Selected. |
| Treat `scripts/workspace-test.sh` as the primary INV-117 proof. | considered: `scripts/workspace-test.sh` says it is package/build evidence and delegates thresholds to `run-all-tests.sh`. | Low. Reversal is only documentation and gate selection. | INV-117 requires explicit deterministic thresholds, shard accounting, and aggregate validation. | Rejected as primary proof; retained as supporting evidence. |

## Thresholds

The selected proof gate passes only when all of these are true:

| Threshold | Source | Expected value |
| --- | --- | --- |
| Manifest inventory | `scripts/test-suites/proof-e2e.manifest` via `manifest_count` | 15 suites |
| Aggregate executed count | `validate_proof_thresholds` in `scripts/run-all-tests.sh` | `Executed: 15` |
| Failed suites | `validate_proof_thresholds` in `scripts/run-all-tests.sh` | `Failed: 0` |
| Checkpoint skips | `validate_proof_thresholds` in `scripts/run-all-tests.sh` | `Skipped by checkpoint: 0` |
| Unavailable skips in required proof mode | `validate_proof_thresholds` in `scripts/run-all-tests.sh` | `Skipped unavailable: 0` |
| Config skip accounting | `validate_proof_inventory` in `scripts/run-all-tests.sh` | `SUITES + SKIPPED_EXCLUDED == DISCOVERED_TOTAL` |

## Deterministic Commands

### 1. Manifest inventory

```bash
grep -cvE '^[[:space:]]*(#|$)' scripts/test-suites/proof-e2e.manifest
```

Expected output:

```text
15
```

Verdict: pass only if the count is `15`.

### 2. Positive aggregate proof

This command validates the aggregate contract without launching the heavy e2e
suites. It builds a synthetic state file with every manifest suite marked
`passed`, then runs the same aggregate branch used by CI.

```bash
state="$(mktemp)"
awk -v root="$PWD" ' /^[[:space:]]*(#|$)/ { next } { sub(/[[:space:]]*#.*/, ""); gsub(/[[:space:]]/, ""); if ($0 != "") printf "required\t%s/scripts/test-suites/%s\tpassed\n", root, $0 } ' scripts/test-suites/proof-e2e.manifest > "$state"
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_AGGREGATE=1 INVOKER_TEST_ALL_STATE_FILE="$state" bash scripts/run-all-tests.sh
```

Expected summary:

```text
======== Summary ========
Mode: required
State file: <temp path>
Executed: 15
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
Skipped by config: 0
```

Expected exit status: `0`.

Verdict: pass only if the summary has the expected counts and the command exits
`0`.

### 3. Negative aggregate proof

This command marks the first manifest suite as failed. The same aggregate branch
must reject it.

```bash
state="$(mktemp)"
awk -v root="$PWD" ' /^[[:space:]]*(#|$)/ { next } { sub(/[[:space:]]*#.*/, ""); gsub(/[[:space:]]/, ""); if ($0 != "") { status = (++n == 1 ? "failed" : "passed"); printf "required\t%s/scripts/test-suites/%s\t%s\n", root, $0, status } } ' scripts/test-suites/proof-e2e.manifest > "$state"
set +e
INVOKER_TEST_ALL_PROOF=1 INVOKER_TEST_ALL_AGGREGATE=1 INVOKER_TEST_ALL_STATE_FILE="$state" bash scripts/run-all-tests.sh
status=$?
set -e
printf 'exit=%s\n' "$status"
test "$status" -eq 1
```

Expected summary:

```text
======== Summary ========
Mode: required
State file: <temp path>
Executed: 15
Failed: 1
Skipped by checkpoint: 0
Skipped unavailable: 0
Skipped by config: 0

Failures:
  required/21-e2e-dry-run-downstream-reset.sh
ERROR: INV-117 proof expected Failed=0, got 1
exit=1
```

Expected exit status of the final `test "$status" -eq 1`: `0`.

Verdict: pass only if `scripts/run-all-tests.sh` exits `1` before the final
assertion and prints the INV-117 failure threshold.

## CI Proof Path

The CI proof path is deterministic by construction:

1. `.github/workflows/ci.yml` runs four `e2e-proof` shards with
   `INVOKER_TEST_ALL_PROOF=1`, shard index, shard total, and a shard-local
   `proof-state.tsv`.
2. Each shard uploads its `proof-state.tsv`.
3. `e2e-proof / aggregate` concatenates shard state into
   `merged-proof-state.tsv`.
4. The aggregate job reruns `scripts/run-all-tests.sh` with
   `INVOKER_TEST_ALL_PROOF=1` and `INVOKER_TEST_ALL_AGGREGATE=1`.
5. `validate_proof_inventory` and `validate_proof_thresholds` enforce the
   inventory and count thresholds above.

## Final Verdict

Use `scripts/run-all-tests.sh` proof mode plus the CI aggregate lane as the
INV-117 architecture proof. This gives a concrete suite inventory, a repeatable
aggregate validation command, positive and negative expected outputs, and
reviewable failure thresholds. Keep `scripts/workspace-test.sh` as supporting
package/build evidence only.
