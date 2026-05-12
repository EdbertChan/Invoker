# INV-117 Experiment Brief — Deterministic Proof of CI ⇄ Local Test-Surface Coverage

## Goal

Establish deterministic, evidence-backed proof that the architecture connecting
`.github/workflows/ci.yml`, `scripts/run-all-tests.sh`, and
`scripts/workspace-test.sh` upholds the **bidirectional coverage contract** the
Invoker test surface relies on:

1. Every test-suite script referenced by a CI job in `.github/workflows/ci.yml`
   resolves to a file that actually exists on disk under
   `scripts/test-suites/<tier>/`, so CI cannot drift away from local artifacts.
2. Every `scripts/test-suites/required/*.sh` is exercised by at least one CI
   matrix entry, so a green CI run is a superset of the local required-tier
   signal driven by `scripts/run-all-tests.sh`.
3. Every `scripts/test-suites/dangerous/*.sh` is exercised by at least one CI
   matrix entry, since the dangerous tier (e.g. Docker) is opt-in locally but
   mandatory in CI.
4. The vitest workspace driver (`scripts/workspace-test.sh`) — invoked
   indirectly via `package.json#test` and the `required/10-vitest-workspace.sh`
   wrapper — is exercised by CI through that wrapper, so the workspace driver
   has the same locale-stable, deterministic ordering contract in both CI and
   `pnpm run test:all`.
5. The optional-tier coverage is **partial-by-design**: `optional/*.sh` files
   are explicitly mapped to CI matrix entries where applicable; any orphan in
   the optional tier must be documented (Deferred) rather than silently
   skipped.

The selected approach is the **status quo explicit CI-matrix mapping**. We
compare it against an auto-derivation alternative below and record the
deterministic commands a reviewer can run to falsify either design.

## Files under test

- `.github/workflows/ci.yml` — defines seven jobs (`build-artifacts`,
  `quality-checks`, `required-fast`, `dry-run`, `playwright`, `ssh`,
  `optional-other`, `docker`). Each non-quality job references one or more
  `scripts/test-suites/<tier>/<file>.sh` paths inside its matrix entries or
  step commands.
- `scripts/run-all-tests.sh` — tier-aware local suite runner. Enumerates
  `scripts/test-suites/{required,optional,dangerous}` via
  `find … -maxdepth 1 -type f -name '*.sh' ! -name '_*' | LC_ALL=C sort`, so
  the local listing is locale-stable.
- `scripts/workspace-test.sh` — workspace-wide vitest driver. Invoked by
  `package.json#test` → `pnpm test`; the CI runner reaches it through the
  `required/10-vitest-workspace.sh` wrapper, which `exec`s `pnpm test` from
  the repo root.

## Selected design (status quo: explicit CI-matrix mapping)

The CI workflow lists every suite script by path inside a job's
`strategy.matrix.include` (or, for single-suite jobs, a single `run:` line).
The local runner enumerates the same files via `find … | LC_ALL=C sort`.

```
scripts/test-suites/required/         scripts/test-suites/optional/
├── 05-delete-all-prod-db-guard.sh    ├── 30-e2e-ssh.sh          ─┐ ssh
├── 07-invalid-config-json.sh         ├── 31-e2e-ssh-merge.sh    ─┘
├── 10-vitest-workspace.sh ──── CI:   ├── 32-e2e-chaos.sh                (orphan)
├── 15-owner-boundary-policy.sh       ├── 33-e2e-chaos-overload.sh       (orphan)
├── 15-submit-workflow-chain.sh       ├── 40-playwright-app.sh ── playwright (3-way shard)
├── 20-e2e-dry-run.sh         ──┐     ├── 60-worktree-provisioning.sh
├── 21-e2e-dry-run-downstream.sh ├ dry-run (3 shards) (optional-other)
├── 22-e2e-dry-run-github.sh    ─┘    └── 70-ui-visual-proof-validate.sh (optional-other)
├── 23-fix-intent-repros.sh ── required-fast
└── 50-verify-executor-routing.sh     scripts/test-suites/dangerous/
                                      └── 10-docker-comprehensive.sh ── docker
```

### Strengths

- **Disk-grounded.** Every CI matrix path is verifiable against the filesystem
  with `test -f`; no indirection through composite actions, generators, or
  workflow templating.
- **Locale-stable enumeration.** The local runner sorts via `LC_ALL=C sort`,
  so any new required-tier file enrolls in `pnpm run test:all` immediately
  without YAML edits.
- **CI/local symmetry on `pnpm test`.** The workspace driver is reachable from
  both the local `pnpm test` and the CI `required-fast / Vitest Workspace`
  matrix entry via the same wrapper, so workspace concurrency semantics
  (`INVOKER_WORKSPACE_TEST_CONCURRENCY`, CI default = 1) are tested in both
  environments.
- **Audit by `grep`.** A reviewer can confirm coverage with `grep -E
  'bash scripts/test-suites/' .github/workflows/ci.yml` and a `find` over the
  suite tree.

### Risks

- **Orphans are silent in CI.** A new `optional/<X>.sh` (e.g. the existing
  `optional/32-e2e-chaos.sh`, `optional/33-e2e-chaos-overload.sh`) added
  without a matching CI matrix entry will be picked up by
  `pnpm run test:all:extended` locally but never by CI.
- **Matrix drift.** Renaming a suite file requires updating the workflow.
  The required-fast / dry-run / playwright / ssh / optional-other / docker
  split is intentional (different runners, container images, sshd setup) and
  cannot be auto-derived from the filename alone.

## Alternative designs considered

A competing approach could either (A) auto-derive the CI matrix from
`scripts/test-suites/<tier>/*.sh` listings using a composite action or a
pre-job generator, or (B) collapse the CI suite invocations into a single
`pnpm run test:all` step.

| Dimension | Status quo (explicit matrix) | Alt A (auto-derive matrix) | Alt B (single `pnpm test:all`) |
|-----------|-----------------------------|----------------------------|-------------------------------|
| Determinism of ordering | `LC_ALL=C sort` local; explicit YAML in CI | Generator output dependent | `LC_ALL=C sort` driven by runner |
| CI parallelism | Per-job (Playwright container, sshd, Docker host) | Per-suite (1 job each) | 1 job (serial) |
| Wall-clock under failure | Bounded by slowest tier-group | Bounded by slowest single suite | Bounded by total runtime |
| Enrollment cost | New `.sh` + workflow row | New `.sh` only | New `.sh` only |
| Container/runner mapping | Explicit per matrix row | Requires per-suite metadata | One runner for all (loses Playwright container, sshd, Docker) |
| Orphan detection | Manual review (`grep` + `find`) | Automatic | N/A (everything runs) |
| Local reproducibility | `bash <suite>.sh` matches CI exactly | Identical to CI | Identical to CI |

### Alternative verdicts (Supported / Rejected / Deferred)

| Design / approach | Verdict | Reason |
|-------------------|---------|--------|
| Status quo: explicit CI-matrix mapping per suite/tier | **Supported** | Disk-grounded mapping, locale-stable enumeration, explicit runner/container assignment per tier-group. Satisfies E1–E6 thresholds below. |
| Alt A: auto-derive CI matrix from `scripts/test-suites/<tier>/` listings | **Deferred** | Would close the orphan-detection gap but requires per-suite metadata (target runner, container image, sshd-required, Docker-required); defer until the metadata schema is formalized or an orphan-induced regression is observed. |
| Alt B: collapse CI suite invocations into a single `pnpm run test:all` step | **Rejected** | Loses per-tier parallelism (Playwright container, sshd setup, Docker host all become serial), removes container/runner specialization, and inflates wall-clock to the union of all suites. |
| Treat optional-tier orphans (`32-e2e-chaos.sh`, `33-e2e-chaos-overload.sh`) as silent gaps | **Rejected** | A silent gap violates the bidirectional coverage contract. These orphans must remain visibly Deferred in this brief until a CI lane (e.g. nightly chaos) is added or the suites are migrated to required/. |
| Move directly to implementation without evidence | **Rejected** | Violates the INV-117 reviewability requirement: no deterministic command can falsify the coverage contract and no threshold is recorded. |
| Evaluate alternatives informally without deterministic checks | **Rejected** | Informal evaluation cannot produce a pass/fail exit code; reviewers cannot reproduce the verdict from a clean checkout. |

**Selected design verdict:** the status quo is **Supported** and adopted.
Alt B is **Rejected**; Alt A is **Deferred** with an explicit trigger (a
formal per-suite metadata schema or an observed orphan-induced regression).
Existing optional-tier orphans are recorded explicitly so they are not
silently lost.

## Deterministic commands and expected outputs

Run these from the repo root. Each command produces a clear pass/fail exit
code and a stable token in stdout that a reviewer can grep for.

### E1 — Every CI-referenced suite path exists on disk

```bash
grep -hE 'scripts/test-suites/[a-z]+/[0-9A-Za-z_.-]+\.sh' \
     .github/workflows/ci.yml \
  | grep -oE 'scripts/test-suites/[a-z]+/[0-9A-Za-z_.-]+\.sh' \
  | LC_ALL=C sort -u \
  | while read -r path; do
      if [ -f "$path" ]; then
        printf 'OK %s\n' "$path"
      else
        printf 'MISSING %s\n' "$path"
        exit 1
      fi
    done
echo "exit=$?"
```

Expected: every printed line begins with `OK ` and the trailing line is
`exit=0`. Verdict PASS iff no `MISSING` line is emitted and the loop exits 0.
Threshold: `|{paths in ci.yml} ∖ {paths on disk}| == 0`.

### E2 — Every `required/*.sh` is referenced by at least one CI matrix entry

```bash
LOCAL=$(find scripts/test-suites/required -maxdepth 1 -type f -name '*.sh' ! -name '_*' \
        | LC_ALL=C sort)
CI=$(grep -hoE 'scripts/test-suites/required/[0-9A-Za-z_.-]+\.sh' \
       .github/workflows/ci.yml | LC_ALL=C sort -u)

diff <(printf '%s\n' "$LOCAL") <(printf '%s\n' "$CI")
echo "exit=$?"
```

Expected: empty diff, `exit=0`. Verdict PASS iff every required-tier suite
appears in `.github/workflows/ci.yml` exactly once (in some matrix row) and
CI contains no required-suite reference that is missing from disk.
Threshold: symmetric difference between the two sets is empty.

### E3 — Every `dangerous/*.sh` is referenced by at least one CI matrix entry

```bash
LOCAL=$(find scripts/test-suites/dangerous -maxdepth 1 -type f -name '*.sh' ! -name '_*' \
        | LC_ALL=C sort)
CI=$(grep -hoE 'scripts/test-suites/dangerous/[0-9A-Za-z_.-]+\.sh' \
       .github/workflows/ci.yml | LC_ALL=C sort -u)

diff <(printf '%s\n' "$LOCAL") <(printf '%s\n' "$CI")
echo "exit=$?"
```

Expected: empty diff, `exit=0`. Verdict PASS iff every dangerous-tier suite
is referenced by exactly one CI job and CI contains no dangerous-suite
reference that is missing from disk. Threshold: symmetric difference empty.

### E4 — Optional-tier orphans are exactly the documented chaos suites

```bash
LOCAL=$(find scripts/test-suites/optional -maxdepth 1 -type f -name '*.sh' ! -name '_*' \
        | LC_ALL=C sort)
CI=$(grep -hoE 'scripts/test-suites/optional/[0-9A-Za-z_.-]+\.sh' \
       .github/workflows/ci.yml | LC_ALL=C sort -u)
ORPHANS=$(comm -23 <(printf '%s\n' "$LOCAL") <(printf '%s\n' "$CI"))

printf '%s\n' "$ORPHANS"
```

Expected (exact, in this order):

```
scripts/test-suites/optional/32-e2e-chaos.sh
scripts/test-suites/optional/33-e2e-chaos-overload.sh
```

Verdict PASS iff the orphan set is byte-identical to the expected two-line
block. Any extra orphan is a regression of the bidirectional contract and
must be either added to CI or explicitly Deferred in this brief.
Threshold: `orphan_set == {32-e2e-chaos.sh, 33-e2e-chaos-overload.sh}`.

### E5 — `required/10-vitest-workspace.sh` reaches `scripts/workspace-test.sh`

```bash
grep -E '^exec pnpm test$' scripts/test-suites/required/10-vitest-workspace.sh \
  && grep -E '"test": "bash scripts/test-plan-to-invoker-skill\.sh && bash scripts/workspace-test\.sh"' \
       package.json \
  && echo OK
```

Expected: `OK`. Verdict PASS iff the wrapper `exec`s `pnpm test` and the
root `package.json#test` script invokes `scripts/workspace-test.sh`, so the
CI `required-fast / Vitest Workspace` matrix entry is provably equivalent
to the local `pnpm test` driver. Threshold: both `grep`s return exit 0.

### E6 — `scripts/workspace-test.sh` enforces the bounded-concurrency contract under CI

```bash
CI=1 INVOKER_WORKSPACE_TEST_CONCURRENCY="" bash -c '
  source scripts/workspace-test.sh' 2>&1 | head -1 \
  || true

# Static inspection that the CI-default branch sets CONCURRENCY=1:
grep -nE '^  CONCURRENCY=1$' scripts/workspace-test.sh
grep -nE '^pnpm -r --workspace-concurrency="\$CONCURRENCY" test$' scripts/workspace-test.sh
echo "exit=$?"
```

Expected: the two `grep -n` calls each return exactly one match (the
CI-default branch assignment and the concurrency-bounded `pnpm -r`
invocation), and the trailing `exit=0` line is present. Verdict PASS iff
both `grep`s exit 0 and print exactly one line each. Threshold:
`CONCURRENCY=1 ∈ {CI branch}` AND
`pnpm -r --workspace-concurrency="$CONCURRENCY" test` appears verbatim as
its own line.

Note: this experiment exercises only the static contract; functional
`pnpm test` coverage is the responsibility of INV-67's E2 experiment, which
this brief does not duplicate.

## Summary verdict matrix

| Experiment | Pass criterion | Threshold |
|------------|----------------|-----------|
| E1 CI paths exist | every CI-referenced suite path is `test -f`-valid | missing = 0 |
| E2 required coverage | required suites ↔ CI references are equal sets | symmetric diff = 0 |
| E3 dangerous coverage | dangerous suites ↔ CI references are equal sets | symmetric diff = 0 |
| E4 optional orphans | orphan set equals documented chaos pair | orphan_set = {32, 33} |
| E5 vitest reachability | wrapper `exec`s `pnpm test` and `pnpm test` → `workspace-test.sh` | both `grep`s exit 0 |
| E6 CI concurrency contract | `CI=1` branch sets `CONCURRENCY=1` and bounds `pnpm -r` | each `grep -n` matches once |

A run is considered deterministic proof for INV-117 iff E1–E6 all return
their PASS verdict on a clean checkout of this branch.

### Verdict mapping to overall decision

- All six experiments PASS on their threshold → the explicit CI-matrix
  mapping design is **Supported**. Adopt without further changes.
- Any experiment FAILS on its threshold → the explicit-mapping design is
  **Rejected** for that property; re-open the alternative-design comparison
  above for the failing dimension (most notably the auto-derivation deferral
  when E2/E3 fails or the orphan set in E4 changes).
- An experiment cannot be executed in this environment (e.g. `find` or
  `grep` semantics differ under non-GNU userland) → that experiment is
  **Deferred** and must be re-run once the prerequisite is available before
  the overall verdict is treated as final.

## How to reproduce end-to-end

```bash
git checkout experiment/wf-1778431097453-46/experiment-inv-117/g0.t2.a-a2c1ff6cc-fa4dff6e
pnpm install --frozen-lockfile
# Run E1–E6 in order; abort on first failure.
```

E1–E4 are pure filesystem/grep checks and do not mutate working state. E5
and E6 are static inspections of `package.json` and `scripts/workspace-test.sh`;
they do not execute `pnpm test`. Functional execution of the workspace
driver is covered by INV-67's E2 and by the CI `required-fast / Vitest
Workspace` matrix entry.
