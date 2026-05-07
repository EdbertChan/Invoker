import { spawn } from 'node:child_process';
import { traceExecution } from './exec-trace.js';

export interface GitExecOpts {
  /** Include caller stack frames in trace output. Default: false. */
  traceStack?: boolean;
}

/**
 * Spawn `git <args>` in `cwd`, collect stdout+stderr, resolve with trimmed
 * stdout on exit 0, reject with a descriptive error otherwise.
 *
 * This is the single spawn-based git execution primitive for the
 * execution-engine package. All other `execGit*` helpers delegate here.
 */
export function execGit(args: string[], cwd: string, opts?: GitExecOpts): Promise<string> {
  if (opts?.traceStack) {
    const stack = new Error().stack;
    const callerFrames = stack?.split('\n').slice(1, 5).map(l => l.trim()).join('\n    ') ?? '(no stack)';
    traceExecution(`[git-trace] git ${args.join(' ')}  cwd=${cwd}\n    ${callerFrames}`);
  } else {
    traceExecution(`[git-trace] git ${args.join(' ')}  cwd=${cwd}`);
  }
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
  });
}

/**
 * Like {@link execGit} but discards stdout. Use for operations where the
 * output is not needed (e.g. `git worktree remove`).
 */
export async function execGitVoid(args: string[], cwd: string): Promise<void> {
  await execGit(args, cwd);
}
