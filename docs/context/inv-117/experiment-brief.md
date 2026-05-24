# INV-117 Experiment Brief: Deterministic Proof Surface

## Purpose

INV-117 evaluates how review evidence should be produced for architecture-sensitive changes. The selected approach is a deterministic repository-local proof command that is explicitly mapped to the CI workflow and test-suite registry, with fixed pass thresholds and no checkpoint reuse.

Files under test:

- `.github/workflows/ci.yml`
- `scripts/workspace-test.sh`
- `scripts/run-all-tests.sh`
- `scripts/test-suites/README.md`
- `scripts/test-suites/required/*.sh`
- `scripts/test-suites/optional/*.sh`
- `scripts/test-suites/dangerous/*.sh`
- `package.json`

## Selected Design

Use `scripts/run-all-tests.sh` proof mode, exposed through `package.json` as:

```sh
pnpm run test:all:proof
pnpm run test:all:proof:extended
pnpm run test:all:proof:destructive
```

This design is selected because `scripts/run-all-tests.sh` already owns suite discovery, mode selection, resume state, per-suite logging, unavailable-environment handling, and proof thresholds. In proof mode it forces reruns, disables resume, and validates the summary before returning success.

The local package workspace command remains:

```sh
bash scripts/workspace-test.sh
```

That command is the focused package-level surface. It runs `pnpm -r --workspace-concurrency="$CONCURRENCY" test` and then `bash scripts/required-builds.sh`. Its deterministic CI behavior comes from `CI=true`, which sets workspace test concurrency to `1` unless `INVOKER_WORKSPACE_TEST_CONCURRENCY` is explicitly provided.

## Competing Design

Alternative considered: document CI job names from `.github/workflows/ci.yml` and ask reviewers to inspect the GitHub Actions matrix as proof.

Verdict: reject as the primary proof mechanism. The workflow is authoritative for hosted CI, but its jobs are distributed across matrices, container images, artifact download steps, and scheduled-only repros. That makes local reproduction and review evidence harder to compare. It also does not by itself provide a single deterministic threshold for "all expected suites ran".

The CI workflow should remain the hosted enforcement layer. The experiment proof should use the repository-local runner because it gives reviewers one command family, one summary format, and threshold validation in code.

## Deterministic Commands

Run these from the repository root after dependencies are installed with `pnpm install --frozen-lockfile`.

### Required Proof

```sh
pnpm run test:all:proof
```

Expected summary:

```text
======== Summary ========
Mode: required
Executed: 16
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold:

- Command exits `0`.
- `Executed` is exactly `16`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- `Skipped unavailable` is exactly `0`.

Verdict: pass only if all thresholds hold.

### Extended Proof

```sh
pnpm run test:all:proof:extended
```

Expected summary:

```text
======== Summary ========
Mode: extended
Executed: 23
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Threshold:

- Command exits `0`.
- `Executed` is exactly `23`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- `Skipped unavailable` is exactly `0`.

Verdict: pass only if all thresholds hold.

### Dangerous Proof

```sh
pnpm run test:all:proof:destructive
```

Expected summary when Docker is available:

```text
======== Summary ========
Mode: dangerous
Executed: 24
Failed: 0
Skipped by checkpoint: 0
Skipped unavailable: 0
```

Expected summary when Docker is unavailable:

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

Threshold:

- Command exits `0`.
- `Failed` is exactly `0`.
- `Skipped by checkpoint` is exactly `0`.
- If Docker is available, `Executed` is exactly `24` and `Skipped unavailable` is exactly `0`.
- If Docker is unavailable, `Executed` is exactly `23`, `Skipped unavailable` is exactly `1`, and the only unavailable skip is `dangerous/10-docker-comprehensive.sh`.

Verdict: pass only if one expected dangerous-mode profile holds.

### Workspace Package Surface

```sh
CI=true bash scripts/workspace-test.sh
```

Expected output includes:

```text
==> Running package workspace tests (concurrency=1)
==> Running required package builds
```

Threshold:

- Command exits `0`.
- The first status line reports `concurrency=1`.
- Required package builds run after package workspace tests.

Verdict: pass only if the CI concurrency behavior and build step both appear.

## CI Mapping

`.github/workflows/ci.yml` uses Node `26`, installs dependencies with `pnpm install --frozen-lockfile`, builds `@invoker/ui` and `@invoker/app`, uploads `app-build-dist.tgz`, and then reuses that artifact across required, optional, Playwright, SSH, dry-run, scheduled, and Docker jobs.

The local proof runner maps to CI as follows:

- `quality-checks` maps to `pnpm run check:deps`, `pnpm run check:required-builds`, and `pnpm run check:types`.
- `required-fast` maps to required suite wrappers under `scripts/test-suites/required/`.
- `dry-run` maps to `required/20-e2e-dry-run.sh`, `required/21-e2e-dry-run-downstream.sh`, and `required/22-e2e-dry-run-github.sh`.
- `scheduled-repros` maps to `required/23-fix-intent-repros.sh` when the workflow is scheduled or manually dispatched.
- `playwright` maps to `optional/40-playwright-app.sh` with shard variables.
- `ssh` maps to `optional/30-e2e-ssh.sh` and `optional/31-e2e-ssh-merge.sh`.
- `optional-other` maps to `optional/60-worktree-provisioning.sh` and `optional/70-ui-visual-proof-validate.sh`.
- `docker` maps to `dangerous/10-docker-comprehensive.sh`.

## Reviewable Verdict

Selected approach: repository-local proof mode in `scripts/run-all-tests.sh`, with CI as the hosted enforcement layer.

Acceptance threshold for INV-117 evidence:

- The brief references the concrete CI and script files under test.
- Each command has a deterministic expected summary.
- Each proof mode has explicit pass thresholds.
- At least one competing design is compared and rejected with a concrete reason.
- Reviewers can reproduce the selected evidence with commands committed in this file.
