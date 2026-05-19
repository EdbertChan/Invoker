# INV-63 Experiment Brief

## Goal

Establish deterministic proof that the `plan-to-invoker` architecture requires experiment decisions to be evidence-backed, reviewable, and reproducible before implementation work consumes them.

## Files under test

- `skills/plan-to-invoker/SKILL.md`
- `.cursor/skills/plan-to-invoker/SKILL.md`
- `skills/plan-to-invoker/scripts/skill-doctor.sh`
- `skills/plan-to-invoker/scripts/lint-task-atomicity.sh`

## Architecture decision

Selected approach: keep experiment evidence as a committed deterministic artifact at `docs/context/<issue>/experiment-brief.md`, then require downstream implementation tasks to reference that exact path and require cleanup before the final verification gate.

Competing approach considered: keep experiment evidence only in chat, task descriptions, or temporary local scratch files. This reduces ceremony, but it is not independently reviewable, cannot be re-run from the repository alone, and can drift from the implementation plan without a committed handoff path.

Verdict: choose the committed artifact contract. It gives reviewers a stable file to inspect, lets `skill-doctor.sh` and `lint-task-atomicity.sh` enforce the handoff shape, and keeps architecture choices tied to deterministic commands instead of transient discussion.

## Deterministic commands

Run all commands from the repository root.

### 1. Verify skill document parity

Command:

```bash
cmp -s skills/plan-to-invoker/SKILL.md .cursor/skills/plan-to-invoker/SKILL.md && echo skill-docs-identical
```

Expected output:

```text
skill-docs-identical
```

Threshold: exact byte-for-byte parity between the repo skill and Cursor skill.

Verdict: pass means both skill entrypoints expose the same policy contract. Fail means one entrypoint can accept or reject plans using stale policy.

### 2. Verify doctor script parses

Command:

```bash
bash -n skills/plan-to-invoker/scripts/skill-doctor.sh && echo syntax-ok
```

Expected output:

```text
syntax-ok
```

Threshold: shell parser exits `0`.

Verdict: pass means the deterministic validation orchestrator is syntactically runnable. Fail blocks relying on the doctor as the proof surface.

### 3. Verify doctor command contract

Command:

```bash
bash skills/plan-to-invoker/scripts/skill-doctor.sh --help
```

Expected output fragments:

```text
Usage: bash skill-doctor.sh [OPTIONS] <plan-file>
--source-file FILE
--coverage-map FILE
--stack-manifest FILE
Exit codes:
0 = all checks passed
1 = one or more checks failed
```

Threshold: all listed fragments must appear, and the command must exit `0`.

Verdict: pass means reviewers have a single documented command surface for validation, including policy-matrix and stack-manifest enforcement.

### 4. Verify experiment policy is present in both skill entrypoints

Command:

```bash
rg -n "Experiment artifact persistence rule|docs/context/<issue>/experiment-brief.md|Implementation-plan full-suite gate|pnpm run test:all|--stack-manifest" \
  skills/plan-to-invoker/SKILL.md \
  .cursor/skills/plan-to-invoker/SKILL.md \
  skills/plan-to-invoker/scripts/skill-doctor.sh
```

Expected output fragments:

```text
skills/plan-to-invoker/SKILL.md:36:**Experiment artifact persistence rule
.cursor/skills/plan-to-invoker/SKILL.md:36:**Experiment artifact persistence rule
skills/plan-to-invoker/SKILL.md:119:- Implementation-plan full-suite gate
.cursor/skills/plan-to-invoker/SKILL.md:119:- Implementation-plan full-suite gate
skills/plan-to-invoker/scripts/skill-doctor.sh:12:#   --stack-manifest FILE
```

Threshold: matching policy text must be present in both skill files, and `skill-doctor.sh` must expose `--stack-manifest`.

Verdict: pass means the selected architecture is documented in both human-facing skill entrypoints and wired into the deterministic validator surface.

### 5. Verify lint enforcement hooks exist

Command:

```bash
rg -n "experiment|artifact|cleanup|Alternative|Layer:|Feature state|strict-delegation|test:all|stack-manifest" \
  skills/plan-to-invoker/scripts/lint-task-atomicity.sh \
  skills/plan-to-invoker/scripts/skill-doctor.sh
```

Expected output fragments:

```text
skills/plan-to-invoker/scripts/lint-task-atomicity.sh:127:function first_experiment_artifact
skills/plan-to-invoker/scripts/lint-task-atomicity.sh:335:  if (id ~ /^experiment-/ && has_prompt) {
skills/plan-to-invoker/scripts/lint-task-atomicity.sh:340:    if (artifact_path == "") {
skills/plan-to-invoker/scripts/lint-task-atomicity.sh:344:      errors[++errn] = "Task \"" id "\" must require committing the experiment artifact in prompt text"
skills/plan-to-invoker/scripts/lint-task-atomicity.sh:518:      if (cleanup_id == "") {
skills/plan-to-invoker/scripts/lint-task-atomicity.sh:566:    } else if (final_command != "pnpm run test:all") {
skills/plan-to-invoker/scripts/skill-doctor.sh:307:    atomicity_args+=(--stack-manifest "$STACK_MANIFEST_FILE")
```

Threshold: every fragment must appear. Line numbers may change after edits, but the matched rules must remain.

Verdict: pass means the architecture is enforceable, not merely documented: experiment tasks need committed artifacts, implementation tasks need the handoff path, cleanup tasks are required, and terminal workflows retain the full-suite gate.

## Acceptance threshold

The experiment passes only when:

1. Skill docs are byte-identical.
2. `skill-doctor.sh` parses and prints its documented command contract.
3. Both skill entrypoints contain the experiment artifact rule and final-gate rule.
4. The doctor and atomicity lint scripts expose concrete enforcement hooks for artifact handoff, cleanup, stack-aware validation, and `pnpm run test:all`.

Any failure is a hard stop for INV-63 because it means the selected design is not reproducibly reviewable from committed repository state.
