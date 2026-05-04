/**
 * Playwright global setup: build app artifacts (if missing) and create a
 * local bare repo for E2E tests.
 *
 * By default, all E2E plans use file:///tmp/invoker-e2e-repo.git as their repoUrl
 * so WorktreeExecutor can clone without a network. Sharded CI can override the
 * bare-repo path via INVOKER_E2E_BARE_REPO to avoid cross-shard interference.
 */
import { execSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import * as path from 'path';

export const E2E_BARE_REPO = process.env.INVOKER_E2E_BARE_REPO ?? '/tmp/invoker-e2e-repo.git';

const repoRoot = path.resolve(__dirname, '..', '..', '..');

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME ?? 'Invoker E2E',
  GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL ?? 'ci@invoker.dev',
  GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME ?? 'Invoker E2E',
  GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL ?? 'ci@invoker.dev',
};

export default function globalSetup(): void {
  // Build UI and app if dist/main.js is missing (CI pre-builds; local dev may not).
  const mainJs = path.resolve(__dirname, '..', 'dist', 'main.js');
  if (!existsSync(mainJs)) {
    console.log('[global-setup] dist/main.js not found — building @invoker/ui and @invoker/app …');
    execSync('pnpm --filter @invoker/ui build', { cwd: repoRoot, stdio: 'inherit' });
    execSync('pnpm --filter @invoker/app build', { cwd: repoRoot, stdio: 'inherit' });
  }

  // Set up the bare repo used by all E2E tests.
  if (existsSync(E2E_BARE_REPO)) rmSync(E2E_BARE_REPO, { recursive: true });

  const tmpClone = `${E2E_BARE_REPO}.setup`;
  if (existsSync(tmpClone)) rmSync(tmpClone, { recursive: true });

  execSync(`git init --bare "${E2E_BARE_REPO}"`);
  execSync(`git clone "${E2E_BARE_REPO}" "${tmpClone}"`, { env: gitEnv });
  execSync('git commit --allow-empty -m "init"', { cwd: tmpClone, env: gitEnv });
  execSync('git push origin HEAD:refs/heads/master', { cwd: tmpClone, env: gitEnv });
  rmSync(tmpClone, { recursive: true });
}
