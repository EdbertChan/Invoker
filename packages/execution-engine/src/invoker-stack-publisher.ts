import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import type { SQLiteAdapter } from '@invoker/data-store';

export type InvokerPublicationMode = 'review' | 'landing';

export interface InvokerPublicationHost {
  readonly persistence: SQLiteAdapter;
  readonly defaultBranch: string | undefined;
  readonly cwd: string;

  execGitReadonly(args: string[], cwd?: string): Promise<string>;
  buildMergeSummary(workflowId: string): Promise<string>;
  authorPrBodyWithSkill?(args: {
    workflowId?: string;
    mergeNodeTaskId?: string;
    title: string;
    baseBranch: string;
    featureBranch: string;
    workflowSummary: string;
    cwd: string;
  }): Promise<{ body: string; sessionId: string; agentName: string }>;
}

type WorkflowRecord = NonNullable<ReturnType<SQLiteAdapter['loadWorkflow']>>;

type PublicationStep = {
  workflowId: string;
  mergeNodeTaskId: string;
  workflow: WorkflowRecord;
  title: string;
  summary: string;
  prBody: string;
  sourceBaseRef: string;
  sourceFeatureRef: string;
};

type PublishedPr = {
  workflowId: string;
  title: string;
  url: string;
  number: number;
  baseRefName: string;
  headRefName: string;
};

export type PublishedInvokerStack = {
  mode: InvokerPublicationMode;
  rootWorkflowId: string;
  reviewBaseSha: string;
  reviewBaseBranch?: string;
  landingBaseSha?: string;
  prs: PublishedPr[];
};

const INVOKER_REPO_RE = /(?:EdbertChan|Neko-Catpital-Labs)\/Invoker(?:\.git)?\/?$/i;

function isInvokerRepoUrl(url: string | undefined): boolean {
  return Boolean(url && INVOKER_REPO_RE.test(url));
}

function parseGitHubRepoSlug(url: string): string {
  const trimmed = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  const sshMatch = trimmed.match(/[:/]([^/:]+\/[^/]+)$/);
  if (!sshMatch) {
    throw new Error(`Cannot derive GitHub repo slug from remote URL: ${url}`);
  }
  return sshMatch[1];
}

function normalizeParentRemoteName(parentRemote: string | undefined): string {
  const normalized = parentRemote?.trim();
  return normalized ? normalized : 'upstream';
}

function defaultPrBody(summary: string): string {
  const trimmed = summary.trim() || 'Invoker publication update.';
  return [
    '## Summary',
    '',
    trimmed,
    '',
    '## Test Plan',
    '',
    '- [ ] Not run (publication-only path)',
    '',
    '## Revert Plan',
    '',
    '- Safe to revert? Yes',
    '- Revert command: `git revert <sha>`',
    '- Post-revert steps: None',
    '- Data migration? No',
  ].join('\n');
}

async function execCmd(
  cmd: string,
  args: string[],
  cwd: string,
  extraEnv?: Record<string, string>,
  trim = true,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...extraEnv },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(trim ? stdout.trim() : stdout);
        return;
      }
      reject(new Error(`${cmd} ${args.join(' ')} failed (code ${code}): ${stderr.trim()}${stdout.trim() ? `\n${stdout.trim()}` : ''}`));
    });
  });
}

async function execGit(args: string[], cwd: string): Promise<string> {
  return execCmd('git', args, cwd);
}

function collectStackWorkflowIds(persistence: SQLiteAdapter, workflowId: string): string[] {
  const parentIds = new Set<string>();
  for (const task of persistence.loadTasks(workflowId)) {
    if (task.config.isMergeNode) continue;
    if ((task.dependencies?.length ?? 0) > 0) continue;
    for (const dep of task.config.externalDependencies ?? []) {
      if (dep.taskId === '__merge__') {
        parentIds.add(dep.workflowId);
      }
    }
  }
  if (parentIds.size > 1) {
    throw new Error(`Workflow ${workflowId} has multiple upstream workflow gates; synthetic review stack requires a linear chain.`);
  }
  const parentId = [...parentIds][0];
  if (!parentId) return [workflowId];
  return [...collectStackWorkflowIds(persistence, parentId), workflowId];
}

async function buildPublicationSteps(
  host: InvokerPublicationHost,
  workflowId: string,
  targetBaseBranch: string,
): Promise<{ rootWorkflowId: string; rootWorkflow: WorkflowRecord; steps: PublicationStep[] }> {
  const workflowIds = collectStackWorkflowIds(host.persistence, workflowId);
  const rootWorkflowId = workflowIds[0];
  const rootWorkflow = host.persistence.loadWorkflow(rootWorkflowId);
  if (!rootWorkflow) throw new Error(`Workflow ${rootWorkflowId} not found`);
  const steps: PublicationStep[] = [];

  for (let index = 0; index < workflowIds.length; index++) {
    const currentWorkflowId = workflowIds[index];
    const workflow = host.persistence.loadWorkflow(currentWorkflowId);
    if (!workflow) throw new Error(`Workflow ${currentWorkflowId} not found`);
    if (!workflow.featureBranch) throw new Error(`Workflow ${currentWorkflowId} has no featureBranch`);
    const summary = await host.buildMergeSummary(currentWorkflowId);
    const prBody = host.authorPrBodyWithSkill
      ? (await host.authorPrBodyWithSkill({
          workflowId: currentWorkflowId,
          mergeNodeTaskId: `__merge__${currentWorkflowId}`,
          title: workflow.name,
          baseBranch: targetBaseBranch,
          featureBranch: workflow.featureBranch,
          workflowSummary: summary,
          cwd: host.cwd,
        })).body
      : defaultPrBody(summary);
    steps.push({
      workflowId: currentWorkflowId,
      mergeNodeTaskId: `__merge__${currentWorkflowId}`,
      workflow,
      title: workflow.name,
      summary,
      prBody,
      sourceBaseRef: index === 0 ? '' : steps[index - 1].workflow.featureBranch!,
      sourceFeatureRef: workflow.featureBranch,
    });
  }

  return { rootWorkflowId, rootWorkflow, steps };
}

function extractPublishedPrUrls(output: string): string[] {
  return [...new Set((output.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/g) ?? []))];
}

async function loadPublishedPrs(repoSlug: string, cwd: string, expectedTitles: string[]): Promise<PublishedPr[]> {
  const pulls = new Map<string, PublishedPr>();
  for (const title of expectedTitles) {
    const list = await execCmd('gh', [
      'pr', 'list',
      '--repo', repoSlug,
      '--search', `in:title "${title}"`,
      '--state', 'open',
      '--json', 'number,title,url,baseRefName,headRefName',
      '--limit', '20',
    ], cwd);
    const parsed = JSON.parse(list || '[]') as Array<{
      number: number;
      title: string;
      url: string;
      baseRefName: string;
      headRefName: string;
    }>;
    for (const pr of parsed) {
      if (expectedTitles.includes(pr.title)) {
        pulls.set(pr.title, { workflowId: '', ...pr });
      }
    }
  }
  return [...pulls.values()];
}

async function applyDiffAsCommit(
  cloneDir: string,
  sourceBaseRef: string,
  sourceFeatureRef: string,
  title: string,
  body: string,
): Promise<void> {
  const patchPath = join(cloneDir, '.invoker-step.patch');
  const patch = sourceBaseRef
    ? await execCmd('git', ['diff', '--binary', `${sourceBaseRef}..${sourceFeatureRef}`], cloneDir, undefined, false)
    : '';
  if (patch.trim()) {
    writeFileSync(patchPath, patch, 'utf8');
    await execGit(['apply', '--index', '--3way', patchPath], cloneDir);
  }
  const msgPath = join(cloneDir, '.invoker-step-message.txt');
  writeFileSync(msgPath, `${title}\n\n${body.trim()}\n`, 'utf8');
  await execGit(['commit', '--allow-empty', '-F', msgPath], cloneDir);
}

async function configureAuthor(cloneDir: string, host: InvokerPublicationHost): Promise<void> {
  const userName = (
    process.env.GIT_AUTHOR_NAME
    ?? (await host.execGitReadonly(['config', '--get', 'user.name']).catch(() => 'EdbertChan')).trim()
  ) || 'EdbertChan';
  const userEmail = (
    process.env.GIT_AUTHOR_EMAIL
    ?? (await host.execGitReadonly(['config', '--get', 'user.email']).catch(() => 'edbert@example.com')).trim()
  ) || 'edbert@example.com';
  await execGit(['config', 'user.name', userName], cloneDir);
  await execGit(['config', 'user.email', userEmail], cloneDir);
}

export async function shouldUseInvokerSyntheticReview(
  host: InvokerPublicationHost,
  workflowId: string,
): Promise<boolean> {
  const workflow = host.persistence.loadWorkflow(workflowId);
  if (!workflow) return false;
  if (isInvokerRepoUrl(workflow.repoUrl)) return true;
  const parentRemote = normalizeParentRemoteName(workflow.parentRemote);
  try {
    const remoteUrl = await host.execGitReadonly(['remote', 'get-url', parentRemote], host.cwd);
    return isInvokerRepoUrl(remoteUrl);
  } catch {
    return false;
  }
}

export async function publishInvokerStack(
  host: InvokerPublicationHost,
  workflowId: string,
  mode: InvokerPublicationMode,
): Promise<PublishedInvokerStack> {
  const workflow = host.persistence.loadWorkflow(workflowId);
  if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

  const parentRemote = normalizeParentRemoteName(workflow.parentRemote);
  const sourceRemote = 'origin';
  const targetRemoteUrl = (await host.execGitReadonly(['remote', 'get-url', parentRemote], host.cwd)).trim();
  const sourceRemoteUrl = (await host.execGitReadonly(['remote', 'get-url', sourceRemote], host.cwd)).trim();
  const repoSlug = isInvokerRepoUrl(targetRemoteUrl)
    ? parseGitHubRepoSlug(targetRemoteUrl)
    : workflow.repoUrl
      ? parseGitHubRepoSlug(workflow.repoUrl)
      : parseGitHubRepoSlug(sourceRemoteUrl);

  const initialBaseBranch = workflow.baseBranch ?? host.defaultBranch ?? 'master';
  const { rootWorkflowId, rootWorkflow, steps } = await buildPublicationSteps(host, workflowId, initialBaseBranch);
  const targetBaseBranch = rootWorkflow.baseBranch ?? host.defaultBranch ?? 'master';
  const rootFeatureRef = steps[0].workflow.featureBranch!;

  const cloneDir = mkdtempSync(join(tmpdir(), `invoker-stack-${mode}-`));
  try {
    await execCmd('git', ['clone', targetRemoteUrl, cloneDir], host.cwd);
    await configureAuthor(cloneDir, host);
    await execCmd('mergify', ['stack', 'setup'], cloneDir);
    await execGit(['remote', 'add', 'source', sourceRemoteUrl], cloneDir);
    await execGit(['fetch', 'origin', targetBaseBranch], cloneDir);
    await execGit(['fetch', 'source', rootFeatureRef], cloneDir);
    for (const step of steps.slice(1)) {
      await execGit(['fetch', 'source', step.sourceFeatureRef], cloneDir);
      await execGit(['fetch', 'source', step.sourceBaseRef], cloneDir);
    }

    const targetBaseSha = (await execGit(['rev-parse', `origin/${targetBaseBranch}`], cloneDir)).trim();
    const reviewBaseSha = (await execGit(['merge-base', `source/${rootFeatureRef}`, `origin/${targetBaseBranch}`], cloneDir)).trim();
    const reviewBaseBranch = `review-base/${rootWorkflowId}`;
    const stackBranch = `${mode === 'review' ? 'review-stack' : 'landing-stack'}/${rootWorkflowId}`;

    if (mode === 'review') {
      await execGit(['branch', '-f', reviewBaseBranch, reviewBaseSha], cloneDir);
      await execGit(['push', '--force', 'origin', `${reviewBaseBranch}:${reviewBaseBranch}`], cloneDir);
      await execGit(['switch', '-C', stackBranch, reviewBaseBranch], cloneDir);
      steps[0].sourceBaseRef = reviewBaseSha;
    } else {
      await execGit(['switch', '-C', stackBranch, `origin/${targetBaseBranch}`], cloneDir);
      steps[0].sourceBaseRef = reviewBaseSha;
    }

    for (const step of steps) {
      await applyDiffAsCommit(
        cloneDir,
        step.sourceBaseRef.startsWith('source/') || /^[0-9a-f]{40}$/i.test(step.sourceBaseRef)
          ? step.sourceBaseRef
          : `source/${step.sourceBaseRef}`,
        `source/${step.sourceFeatureRef}`,
        step.title,
        step.prBody,
      );
    }

    const pushOutput = await execCmd('mergify', ['stack', 'push'], cloneDir);
    const pushUrls = extractPublishedPrUrls(pushOutput);
    if (pushUrls.length === 0) {
      throw new Error(`mergify stack push created no PR URLs for ${workflowId}`);
    }

    const publishedByTitle = new Map(
      (await loadPublishedPrs(repoSlug, cloneDir, steps.map((step) => step.title)))
        .map((pr) => [pr.title, pr]),
    );
    const prs: PublishedPr[] = [];
    for (const step of steps) {
      const pr = publishedByTitle.get(step.title);
      if (!pr) {
        throw new Error(`Could not resolve published PR metadata for step "${step.title}"`);
      }
      prs.push({ ...pr, workflowId: step.workflowId });
      host.persistence.updateWorkflow(step.workflowId, {
        parentRemote,
        publicationState: mode === 'review' ? 'review_published' : 'landing_published',
        reviewBaseSha,
        ...(mode === 'review' ? { reviewBaseBranch, reviewPrUrl: pr.url } : {}),
        ...(mode === 'landing' ? { landingBaseSha: targetBaseSha, landingPrUrl: pr.url } : {}),
      });
    }

    return {
      mode,
      rootWorkflowId,
      reviewBaseSha,
      ...(mode === 'review' ? { reviewBaseBranch } : {}),
      ...(mode === 'landing' ? { landingBaseSha: targetBaseSha } : {}),
      prs,
    };
  } finally {
    rmSync(cloneDir, { recursive: true, force: true });
  }
}
