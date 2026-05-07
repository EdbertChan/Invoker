/**
 * git-ops — Thin, stateless wrapper for git subprocess invocations.
 *
 * Consolidates all `spawn('git', ...)` call sites into a single module with
 * consistent error handling, tracing, and return types.
 *
 * Design decisions (INV-114):
 * - Pure functions. No constructor, no class, no state.
 * - Bash-embedded git scripts (branch-utils.ts, ssh-git-exec.ts) stay as-is;
 *   they must remain self-contained for SSH/Docker transport.
 * - No caching, connection pooling, or batching — see experiment doc
 *   `docs/exp-inv-114-git-optimization-primitives.md` for escalation criteria.
 */

import { spawn } from 'node:child_process';
import { traceExecution } from './exec-trace.js';

export interface ExecGitOptions {
  /** Timeout in milliseconds. 0 = no timeout (default). */
  timeout?: number;
}

/**
 * Core git dispatch: spawn `git <args>` in `cwd`, resolve stdout on exit 0,
 * reject with a descriptive Error on non-zero exit or spawn failure.
 *
 * Every invocation emits a `[git-trace]` line via `traceExecution`.
 */
export function execGit(args: string[], cwd: string, opts?: ExecGitOptions): Promise<string> {
  traceExecution(`[git-trace] git ${args.join(' ')}  cwd=${cwd}`);
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (err) => {
      reject(new Error(`Failed to spawn git: ${err.message}`));
    });
    child.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else {
        const details = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
        reject(new Error(`git ${args.join(' ')} failed (code ${code}): ${details}`));
      }
    });

    if (opts?.timeout && opts.timeout > 0) {
      setTimeout(() => {
        try { child.kill('SIGTERM'); } catch { /* already exited */ }
      }, opts.timeout);
    }
  });
}

/**
 * Fire-and-forget variant that resolves `void` on success and rejects on failure.
 * Useful for write-only commands (worktree remove, branch delete) where stdout is irrelevant.
 */
export async function execGitVoid(args: string[], cwd: string, opts?: ExecGitOptions): Promise<void> {
  await execGit(args, cwd, opts);
}

// ── Higher-level helpers ──────────────────────────────────

/** `git rev-parse --verify <ref>` — resolve a ref to its SHA or throw. */
export function revParse(ref: string, cwd: string): Promise<string> {
  return execGit(['rev-parse', '--verify', ref], cwd);
}

/** `git fetch <remote> [refspecs...]` */
export function fetch(remote: string, cwd: string, refspecs?: string[]): Promise<string> {
  const args = ['fetch', remote];
  if (refspecs) args.push(...refspecs);
  return execGit(args, cwd);
}

/** `git push [flags...] <remote> <refspec>` */
export function push(remote: string, refspec: string, cwd: string, flags?: string[]): Promise<string> {
  const args = ['push'];
  if (flags) args.push(...flags);
  args.push(remote, refspec);
  return execGit(args, cwd);
}

/** `git worktree add <path> <branch>` — attach a new worktree. */
export function worktreeAdd(path: string, branch: string, cwd: string): Promise<string> {
  return execGit(['worktree', 'add', path, branch], cwd);
}

/** `git checkout -b <branch> [startPoint]` — create and switch to a new branch. */
export function branchCreate(branch: string, cwd: string, startPoint?: string): Promise<string> {
  const args = ['checkout', '-b', branch];
  if (startPoint) args.push(startPoint);
  return execGit(args, cwd);
}

/** `git log -1 --format=<format> <ref>` — read a single commit's metadata. */
export function logOne(ref: string, cwd: string, format: string = '%B'): Promise<string> {
  return execGit(['log', '-1', `--format=${format}`, ref], cwd);
}

/** `git diff --stat [options...] <range>` — summary of changes between refs. */
export function diffStat(range: string, cwd: string, extraArgs?: string[]): Promise<string> {
  const args = ['diff', '--stat'];
  if (extraArgs) args.push(...extraArgs);
  args.push(range);
  return execGit(args, cwd);
}
