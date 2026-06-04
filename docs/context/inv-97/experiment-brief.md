# INV-97 experiment brief

Date: 2026-06-04

Goal: establish deterministic proof that app-layer mutation handoffs launch through the execution runner and preserve `workspacePath` metadata.

## Selected approach

Use an in-process app-layer repro suite that exercises mutation results through the shared dispatch bridge and `TaskRunner`, not through raw orchestrator state alone. This proves the architecture boundary that matters for INV-97:

1. A mutation returns started/runnable tasks.
2. The app dispatch layer filters those tasks and calls `TaskRunner.executeTasks`.
3. `TaskRunner` starts the executor, rejects missing `workspacePath`, and persists executor metadata to task and attempt state.
4. The repro asserts the restarted or unblocked task completes with the expected workspace path.

This approach is selected because it is deterministic, fast, and directly covers the app-to-execution handoff without real git, Electron, or child processes.

## Alternative considered

Alternative: prove INV-97 only with headless CLI or end-to-end workflow commands.

Verdict: rejected as the primary proof. It is closer to the user surface, but it adds DB lifecycle, process startup, real command execution, and optional git behavior that can obscure the specific architecture question. It also makes expected output less deterministic. The headless code is still referenced below to show that production surfaces construct the same `TaskRunner` and dispatch runnable mutation results, but the deterministic proof stays in-process.

## Files under test

- `packages/app/src/__tests__/app-layer-handoff-repro.test.ts:31` defines the app-layer dispatch helper that calls `dispatchStartedTasksWithGlobalTopup`.
- `packages/app/src/__tests__/app-layer-handoff-repro.test.ts:47` through `packages/app/src/__tests__/app-layer-handoff-repro.test.ts:224` cover command edit, prompt edit, runner edit, agent edit, external gate policy, replace task, merge retry, and standalone-owner merge retry handoffs.
- `packages/app/src/global-topup.ts:90` bridges runnable app-layer work into `taskExecutor.executeTasks(runnable)`.
- `packages/app/src/global-topup.ts:149` defines which mutation results are dispatchable launches.
- `packages/app/src/global-topup.ts:223` dispatches mutation-scoped work first and then performs global top-up without duplicate launches.
- `packages/execution-engine/src/task-runner.ts:378` runs each task through `TaskRunner.executeTask`.
- `packages/execution-engine/src/task-runner.ts:811` fails fast when an executor returns no `workspacePath`.
- `packages/execution-engine/src/task-runner.ts:831` through `packages/execution-engine/src/task-runner.ts:855` persist `workspacePath` and branch metadata to task and attempt records.
- `packages/app/src/headless.ts:179` constructs the production headless `TaskRunner`.
- `packages/app/src/headless.ts:1486` through `packages/app/src/headless.ts:1522` route retry-task through `dispatchStartedTasksWithGlobalTopup`.
- `packages/app/src/headless.ts:2036` through `packages/app/src/headless.ts:2165` show edit command/prompt/executor/agent surfaces dispatch runnable results to `TaskRunner`.
- `packages/app/src/headless.ts:2636` through `packages/app/src/headless.ts:2661` show gate-policy mutation results dispatching to `TaskRunner`.
- `packages/test-kit/src/test-harness.ts:18` through `packages/test-kit/src/test-harness.ts:24` provide deterministic non-merge executor handles with `/tmp/mock-worktree`.
- `packages/test-kit/src/mock-git.ts:82` through `packages/test-kit/src/mock-git.ts:84` provide deterministic merge worktrees with `/tmp/mock-merge-worktree`.

## Deterministic proof command

Run from the repository root:

```bash
rm -f /tmp/inv-97-vitest.json /tmp/inv-97-vitest.stdout /tmp/inv-97-vitest.stderr
pnpm --filter @invoker/app exec vitest run src/__tests__/app-layer-handoff-repro.test.ts --reporter=json --outputFile=/tmp/inv-97-vitest.json >/tmp/inv-97-vitest.stdout 2>/tmp/inv-97-vitest.stderr
rc=$?
TEST_STATUS=$rc node - <<'NODE'
const fs = require('fs');
const parsed = JSON.parse(fs.readFileSync('/tmp/inv-97-vitest.json', 'utf8'));
const results = parsed.testResults.flatMap((file) => file.assertionResults ?? []);
console.log(`exitCode=${process.env.TEST_STATUS}`);
console.log(`success=${parsed.success}`);
console.log(`testSuites=${parsed.numPassedTestSuites}/${parsed.numTotalTestSuites} passed; failed=${parsed.numFailedTestSuites}`);
console.log(`tests=${parsed.numPassedTests}/${parsed.numTotalTests} passed; failed=${parsed.numFailedTests}`);
console.log(`caseCount=${results.length}`);
for (const result of results) console.log(`case=${result.status}:${result.title}`);
NODE
exit $rc
```

Observed expected output:

```text
exitCode=0
success=true
testSuites=2/2 passed; failed=0
tests=8/8 passed; failed=0
caseCount=8
case=passed:edit-task-command launches restarted task and persists workspacePath
case=passed:edit-task-prompt launches restarted task and persists workspacePath
case=passed:edit-task-type launches restarted task and persists workspacePath
case=passed:edit-task-agent launches restarted task and persists workspacePath
case=passed:set-task-external-gate-policies launches newly unblocked task and persists workspacePath
case=passed:replace-task launches replacement tasks and persists workspacePath
case=passed:set-merge-branch relaunches merge task and persists workspacePath
case=passed:standalone-owner set-merge-branch uses the same handoff and persists workspacePath
```

Thresholds:

- `exitCode` must be `0`.
- `success` must be `true`.
- `tests` must be `8/8 passed; failed=0`.
- `caseCount` must be `8`.
- Every listed case must be `passed`.
- JSON duration, start time, and end time fields are intentionally ignored.

## Static source guard command

Run from the repository root:

```bash
node - <<'NODE'
const fs = require('fs');
const files = {
  repro: 'packages/app/src/__tests__/app-layer-handoff-repro.test.ts',
  globalTopup: 'packages/app/src/global-topup.ts',
  runner: 'packages/execution-engine/src/task-runner.ts',
  headless: 'packages/app/src/headless.ts',
};
const src = Object.fromEntries(Object.entries(files).map(([key, path]) => [key, fs.readFileSync(path, 'utf8')]));
console.log(`repro.testCases=${(src.repro.match(/^\s+it\('/gm) ?? []).length}`);
console.log(`repro.dispatchStartedAwaitCalls=${(src.repro.match(/await dispatchStarted\(/g) ?? []).length}`);
console.log(`repro.workspacePathAssertions=${(src.repro.match(/execution\.workspacePath\)\.toBe/g) ?? []).length}`);
console.log(`repro.mockWorktreeMentions=${(src.repro.match(/\/tmp\/mock-worktree/g) ?? []).length}`);
console.log(`repro.mockMergeWorktreeMentions=${(src.repro.match(/\/tmp\/mock-merge-worktree/g) ?? []).length}`);
console.log(`globalTopup.dispatchHelper=${/export async function dispatchStartedTasksWithGlobalTopup/.test(src.globalTopup)}`);
console.log(`globalTopup.executeTasksBridge=${/const run = \(\) => taskExecutor\.executeTasks\(runnable\)/.test(src.globalTopup)}`);
console.log(`globalTopup.dedupe=${/alreadyDispatched[\s\S]*runningExecutionKey/.test(src.globalTopup)}`);
console.log(`runner.executeTasks=${/async executeTasks\(tasks: TaskState\[\]\)/.test(src.runner)}`);
console.log(`runner.workspaceFailFast=${/did not provide workspacePath/.test(src.runner)}`);
console.log(`runner.persistWorkspacePath=${/workspacePath: handle\.workspacePath/.test(src.runner)}`);
console.log(`headless.createExecutor=${/export function createHeadlessExecutor/.test(src.headless)}`);
console.log(`headless.retryUsesTopup=${/async function headlessRetryTask[\s\S]*dispatchStartedTasksWithGlobalTopup/.test(src.headless)}`);
console.log(`headless.editCommandDirectExecute=${/async function headlessEdit[\s\S]*editTaskCommand[\s\S]*await taskExecutor\.executeTasks\(runnable\)/.test(src.headless)}`);
console.log(`headless.gatePolicyDirectExecute=${/async function headlessSetGatePolicy[\s\S]*setTaskExternalGatePolicies[\s\S]*await taskExecutor\.executeTasks\(runnable\)/.test(src.headless)}`);
NODE
```

Observed expected output:

```text
repro.testCases=8
repro.dispatchStartedAwaitCalls=8
repro.workspacePathAssertions=14
repro.mockWorktreeMentions=6
repro.mockMergeWorktreeMentions=3
globalTopup.dispatchHelper=true
globalTopup.executeTasksBridge=true
globalTopup.dedupe=true
runner.executeTasks=true
runner.workspaceFailFast=true
runner.persistWorkspacePath=true
headless.createExecutor=true
headless.retryUsesTopup=true
headless.editCommandDirectExecute=true
headless.gatePolicyDirectExecute=true
```

Thresholds:

- `repro.testCases` must stay at `8` unless this brief is updated with new expected cases.
- `repro.dispatchStartedAwaitCalls` must match `repro.testCases`.
- `repro.workspacePathAssertions` must be at least `14`.
- `repro.mockWorktreeMentions` must be at least `6`.
- `repro.mockMergeWorktreeMentions` must be at least `3`.
- Every boolean guard must be `true`.

## Verdict

Accept the selected app-layer repro approach for INV-97. The focused Vitest proof passed with all 8 cases, and the static source guard confirms the proof still targets the intended handoff files and runner invariants. Headless remains useful as integration coverage, but it should not replace this deterministic architecture proof.
