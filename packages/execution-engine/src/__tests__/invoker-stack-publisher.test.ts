import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { SQLiteAdapter } from '@invoker/data-store';
import type { TaskState } from '@invoker/workflow-core';
import { publishInvokerStack, shouldUseInvokerSyntheticReview } from '../invoker-stack-publisher.js';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function saveTask(
  adapter: SQLiteAdapter,
  workflowId: string,
  id: string,
  externalWorkflowId?: string,
): void {
  const task: TaskState = {
    id,
    description: id,
    status: 'completed',
    dependencies: [],
    createdAt: new Date(),
    config: externalWorkflowId
      ? {
          workflowId,
          externalDependencies: [{ workflowId: externalWorkflowId, taskId: '__merge__', requiredStatus: 'completed' }],
        }
      : { workflowId },
    execution: {},
  };
  adapter.saveTask(workflowId, task);
}

describe('invoker-stack-publisher', () => {
  let rootDir: string;
  let upstreamBare: string;
  let originBare: string;
  let hostClone: string;
  let tempPaths: string[] = [];
  let oldPath: string | undefined;
  let adapter: SQLiteAdapter;

  beforeEach(async () => {
    rootDir = mkdtempSync(join(tmpdir(), 'invoker-stack-publisher-'));
    upstreamBare = join(rootDir, 'upstream.git');
    originBare = join(rootDir, 'origin.git');
    hostClone = join(rootDir, 'host');
    oldPath = process.env.PATH;

    const seed = join(rootDir, 'seed');
    mkdirSync(seed, { recursive: true });
    git(rootDir, 'init', seed);
    git(seed, 'config', 'user.name', 'Test User');
    git(seed, 'config', 'user.email', 'test@example.com');
    writeFileSync(join(seed, 'README.md'), 'base\n', 'utf8');
    git(seed, 'add', 'README.md');
    git(seed, 'commit', '-m', 'base');
    const baseSha = git(seed, 'rev-parse', 'HEAD');
    git(seed, 'branch', '-M', 'master');
    git(rootDir, 'clone', '--bare', seed, upstreamBare);
    git(rootDir, 'clone', '--bare', seed, originBare);

    git(rootDir, 'clone', originBare, hostClone);
    git(hostClone, 'remote', 'add', 'upstream', upstreamBare);
    git(hostClone, 'config', 'user.name', 'Test User');
    git(hostClone, 'config', 'user.email', 'test@example.com');

    const upstreamWork = join(rootDir, 'upstream-work');
    git(rootDir, 'clone', upstreamBare, upstreamWork);
    git(upstreamWork, 'config', 'user.name', 'Test User');
    git(upstreamWork, 'config', 'user.email', 'test@example.com');
    writeFileSync(join(upstreamWork, 'UPSTREAM.txt'), 'new head\n', 'utf8');
    git(upstreamWork, 'add', 'UPSTREAM.txt');
    git(upstreamWork, 'commit', '-m', 'upstream head');
    git(upstreamWork, 'push', 'origin', 'HEAD:master');

    git(hostClone, 'fetch', 'upstream', 'master');
    git(hostClone, 'checkout', '-B', 'plan/step-1', baseSha);
    writeFileSync(join(hostClone, 'step1.txt'), 'step1\n', 'utf8');
    git(hostClone, 'add', 'step1.txt');
    git(hostClone, 'commit', '-m', 'Review Step 1');
    git(hostClone, 'push', '-u', 'origin', 'plan/step-1');

    git(hostClone, 'checkout', '-B', 'plan/step-2', 'plan/step-1');
    writeFileSync(join(hostClone, 'step2.txt'), 'step2\n', 'utf8');
    git(hostClone, 'add', 'step2.txt');
    git(hostClone, 'commit', '-m', 'Review Step 2');
    git(hostClone, 'push', '-u', 'origin', 'plan/step-2');

    const binDir = join(rootDir, 'bin');
    mkdirSync(binDir, { recursive: true });
    const mergifyStub = join(binDir, 'mergify');
    const ghStub = join(binDir, 'gh');
    writeFileSync(mergifyStub, `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "stack" ] && [ "$2" = "setup" ]; then
  exit 0
fi
if [ "$1" = "stack" ] && [ "$2" = "push" ]; then
  repo="Neko-Catpital-Labs/Invoker"
  branch="$(git branch --show-current)"
  root="\${branch#*/}"
  if [[ "$branch" == review-stack/* ]]; then
    base="review-base/$root"
    range="$base..HEAD"
  else
    base="master"
    range="origin/master..HEAD"
  fi
  git push --force origin "$branch:$branch" >/dev/null 2>&1
  mapfile -t subjects < <(git log --reverse --format=%s "$range")
  json="["
  idx=0
  for title in "\${subjects[@]}"; do
    number=$((100 + idx))
    if [ $idx -eq 0 ]; then
      baseRef="$base"
    else
      baseRef="stack/$root/$((idx-1))"
    fi
    headRef="stack/$root/$idx"
    json="$json{\\"number\\":$number,\\"title\\":\\"$title\\",\\"url\\":\\"https://github.com/$repo/pull/$number\\",\\"baseRefName\\":\\"$baseRef\\",\\"headRefName\\":\\"$headRef\\"},"
    echo "https://github.com/$repo/pull/$number"
    idx=$((idx+1))
  done
  json="\${json%,}]"
  mkdir -p .git
  printf '%s' "$json" > .git/fake-mergify-prs.json
  exit 0
fi
echo "unexpected mergify invocation: $*" >&2
exit 1
`, { mode: 0o755 });
    writeFileSync(ghStub, `#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "pr" ] && [ "$2" = "list" ]; then
  title=""
  while [ $# -gt 0 ]; do
    if [ "$1" = "--search" ]; then
      title="$2"
      shift 2
      continue
    fi
    shift
  done
  title="\${title#in:title \\"}"
  title="\${title%\\"}"
  python3 - "$title" <<'PY'
import json, sys
from pathlib import Path
title = sys.argv[1]
data = json.loads(Path('.git/fake-mergify-prs.json').read_text())
filtered = [row for row in data if row["title"] == title]
print(json.dumps(filtered))
PY
  exit 0
fi
echo "unexpected gh invocation: $*" >&2
exit 1
`, { mode: 0o755 });
    process.env.PATH = `${binDir}:${oldPath ?? ''}`;

    adapter = await SQLiteAdapter.create(':memory:');
    const now = new Date().toISOString();
    adapter.saveWorkflow({
      id: 'wf-1',
      name: 'Review Step 1',
      status: 'running',
      repoUrl: 'https://github.com/EdbertChan/Invoker',
      baseBranch: 'master',
      parentRemote: 'upstream',
      featureBranch: 'plan/step-1',
      createdAt: now,
      updatedAt: now,
    });
    adapter.saveWorkflow({
      id: 'wf-2',
      name: 'Review Step 2',
      status: 'running',
      repoUrl: 'https://github.com/EdbertChan/Invoker',
      baseBranch: 'plan/step-1',
      parentRemote: 'upstream',
      featureBranch: 'plan/step-2',
      createdAt: now,
      updatedAt: now,
    });
    saveTask(adapter, 'wf-1', 'wf-1/root');
    saveTask(adapter, 'wf-2', 'wf-2/root', 'wf-1');
  });

  afterEach(() => {
    process.env.PATH = oldPath;
    adapter.close();
    rmSync(rootDir, { recursive: true, force: true });
    for (const path of tempPaths) rmSync(path, { recursive: true, force: true });
    tempPaths = [];
  });

  it('detects Invoker workflows and publishes review/landing stacks against the correct bases', async () => {
    const host = {
      persistence: adapter,
      defaultBranch: 'master',
      cwd: hostClone,
      execGitReadonly: async (args: string[], cwd?: string) => git(cwd ?? hostClone, ...args),
      buildMergeSummary: async (workflowId: string) => `Summary for ${workflowId}`,
      authorPrBodyWithSkill: async ({ title }: { title: string }) => ({
        body: `## Summary\n\nBody for ${title}\n\n## Test Plan\n\n- [ ] simulated\n\n## Revert Plan\n\n- Safe to revert? Yes\n- Revert command: \`git revert <sha>\`\n- Post-revert steps: None\n- Data migration? No`,
        sessionId: 'sess',
        agentName: 'codex',
      }),
    };

    await expect(shouldUseInvokerSyntheticReview(host as any, 'wf-2')).resolves.toBe(true);

    const review = await publishInvokerStack(host as any, 'wf-2', 'review');
    expect(review.prs).toHaveLength(2);
    expect(review.prs[0].baseRefName).toBe('review-base/wf-1');
    expect(review.prs[1].baseRefName).toBe('stack/wf-1/0');
    expect(adapter.loadWorkflow('wf-2')?.reviewPrUrl).toBe('https://github.com/Neko-Catpital-Labs/Invoker/pull/101');

    const landing = await publishInvokerStack(host as any, 'wf-2', 'landing');
    expect(landing.prs).toHaveLength(2);
    expect(landing.prs[0].baseRefName).toBe('master');
    expect(landing.prs[1].baseRefName).toBe('stack/wf-1/0');
    expect(adapter.loadWorkflow('wf-2')?.landingPrUrl).toBe('https://github.com/Neko-Catpital-Labs/Invoker/pull/101');

    const inspect = join(rootDir, 'inspect');
    git(rootDir, 'clone', upstreamBare, inspect);
    tempPaths.push(inspect);
    git(inspect, 'fetch', 'origin', 'review-base/wf-1', 'review-stack/wf-1', 'landing-stack/wf-1');
    expect(git(inspect, 'rev-parse', 'origin/review-base/wf-1')).toBe(review.reviewBaseSha);
    const reviewTree = git(inspect, 'show', 'origin/review-stack/wf-1:step2.txt');
    const landingTree = git(inspect, 'show', 'origin/landing-stack/wf-1:step2.txt');
    expect(reviewTree).toContain('step2');
    expect(landingTree).toContain('step2');
  });
});
