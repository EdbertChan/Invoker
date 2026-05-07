import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { execGit, execGitVoid } from '../git-primitives.js';

function git(cwd: string, args: string): string {
  return execSync(`git ${args}`, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

describe('git-primitives', { timeout: 15_000 }, () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), 'git-primitives-test-'));
    execSync('git init -b main', { cwd: sandbox });
    git(sandbox, 'config user.email "test@test.com"');
    git(sandbox, 'config user.name "Test"');
    writeFileSync(join(sandbox, 'file.txt'), 'hello\n');
    git(sandbox, 'add -A');
    git(sandbox, 'commit -m "initial"');
  });

  afterEach(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  describe('execGit', () => {
    it('returns trimmed stdout on success', async () => {
      const sha = await execGit(['rev-parse', 'HEAD'], sandbox);
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
    });

    it('resolves branch name via rev-parse --abbrev-ref', async () => {
      const branch = await execGit(['rev-parse', '--abbrev-ref', 'HEAD'], sandbox);
      expect(branch).toBe('main');
    });

    it('rejects with stderr+stdout on non-zero exit code', async () => {
      await expect(
        execGit(['rev-parse', '--verify', 'nonexistent-ref'], sandbox),
      ).rejects.toThrow(/failed \(code 128\)/);
    });

    it('error message includes both stderr and stdout details', async () => {
      try {
        await execGit(['merge', '--no-commit', 'nonexistent'], sandbox);
        expect.unreachable('should have thrown');
      } catch (err: any) {
        expect(err.message).toContain('git merge');
        expect(err.message).toContain('failed');
      }
    });

    it('rejects with spawn error for invalid binary', async () => {
      // Exploit the spawn path by pointing to a non-existent cwd
      await expect(
        execGit(['status'], '/nonexistent-directory-that-does-not-exist'),
      ).rejects.toThrow();
    });

    it('traces execution when traceStack is true', async () => {
      const origEnv = process.env.INVOKER_TRACE_EXECUTION;
      process.env.INVOKER_TRACE_EXECUTION = '1';
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await execGit(['rev-parse', 'HEAD'], sandbox, { traceStack: true });
        expect(consoleSpy).toHaveBeenCalled();
        const traceCall = consoleSpy.mock.calls.find(
          (c) => typeof c[0] === 'string' && c[0].includes('[git-trace]'),
        );
        expect(traceCall).toBeDefined();
        // traceStack should include stack frames
        expect(traceCall![0]).toContain('at ');
      } finally {
        consoleSpy.mockRestore();
        if (origEnv === undefined) delete process.env.INVOKER_TRACE_EXECUTION;
        else process.env.INVOKER_TRACE_EXECUTION = origEnv;
      }
    });

    it('traces execution without stack by default', async () => {
      const origEnv = process.env.INVOKER_TRACE_EXECUTION;
      process.env.INVOKER_TRACE_EXECUTION = '1';
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await execGit(['rev-parse', 'HEAD'], sandbox);
        const traceCall = consoleSpy.mock.calls.find(
          (c) => typeof c[0] === 'string' && c[0].includes('[git-trace]'),
        );
        expect(traceCall).toBeDefined();
        // No stack frames when traceStack not set
        expect(traceCall![0]).not.toContain('at ');
      } finally {
        consoleSpy.mockRestore();
        if (origEnv === undefined) delete process.env.INVOKER_TRACE_EXECUTION;
        else process.env.INVOKER_TRACE_EXECUTION = origEnv;
      }
    });
  });

  describe('execGitVoid', () => {
    it('resolves without returning stdout', async () => {
      const result = await execGitVoid(['status'], sandbox);
      expect(result).toBeUndefined();
    });

    it('rejects on non-zero exit code', async () => {
      await expect(
        execGitVoid(['checkout', 'nonexistent-branch'], sandbox),
      ).rejects.toThrow(/failed/);
    });
  });
});
