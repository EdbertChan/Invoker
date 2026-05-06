import { describe, it, expect } from 'vitest';
import { sanitizeBranchForPath, computeRepoUrlHash, MAX_PATH_SEGMENT } from '../git-utils.js';

describe('computeRepoUrlHash', () => {
  it('returns a 12-char hex string', () => {
    const hash = computeRepoUrlHash('https://github.com/user/repo');
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it('is deterministic', () => {
    const a = computeRepoUrlHash('https://github.com/user/repo');
    const b = computeRepoUrlHash('https://github.com/user/repo');
    expect(a).toBe(b);
  });

  it('is sensitive to input changes', () => {
    const a = computeRepoUrlHash('https://github.com/user/repo-a');
    const b = computeRepoUrlHash('https://github.com/user/repo-b');
    expect(a).not.toBe(b);
  });
});

describe('sanitizeBranchForPath', () => {
  it('replaces slashes with hyphens', () => {
    expect(sanitizeBranchForPath('experiment/task-123/abc')).toBe('experiment-task-123-abc');
  });

  it('returns short names unchanged', () => {
    expect(sanitizeBranchForPath('master')).toBe('master');
    expect(sanitizeBranchForPath('feature/short')).toBe('feature-short');
  });

  it('returns names at exactly MAX_PATH_SEGMENT unchanged', () => {
    const branch = 'a'.repeat(MAX_PATH_SEGMENT);
    expect(sanitizeBranchForPath(branch)).toBe(branch);
    expect(sanitizeBranchForPath(branch).length).toBe(MAX_PATH_SEGMENT);
  });

  it('truncates names exceeding MAX_PATH_SEGMENT with a hash suffix', () => {
    const longBranch = 'experiment/' + 'a'.repeat(200);
    const result = sanitizeBranchForPath(longBranch);
    expect(result.length).toBe(MAX_PATH_SEGMENT);
    // Should end with a 12-char hex hash after a dash
    expect(result).toMatch(/-[0-9a-f]{12}$/);
  });

  it('is deterministic for long names', () => {
    const longBranch = 'experiment/wf-123456/very-long-task-name/' + 'x'.repeat(100);
    const a = sanitizeBranchForPath(longBranch);
    const b = sanitizeBranchForPath(longBranch);
    expect(a).toBe(b);
  });

  it('produces different results for different long branches', () => {
    const branchA = 'experiment/wf-123/' + 'a'.repeat(100);
    const branchB = 'experiment/wf-123/' + 'b'.repeat(100);
    const resultA = sanitizeBranchForPath(branchA);
    const resultB = sanitizeBranchForPath(branchB);
    expect(resultA).not.toBe(resultB);
  });

  it('handles the real-world long branch name from the bug report', () => {
    const realBranch =
      'experiment/wf-1777407618343-4/add-shared-headless-transport-module/' +
      'g9.t9.awf-1777407618343-4add-shared-headless-transport-module-ac1f65b91-a04e32db';
    const result = sanitizeBranchForPath(realBranch);
    expect(result.length).toBe(MAX_PATH_SEGMENT);
    expect(result.length).toBeLessThanOrEqual(80);
    // Should start with a recognizable prefix
    expect(result).toMatch(/^experiment-wf-/);
  });

  it('never exceeds MAX_PATH_SEGMENT characters', () => {
    const cases = [
      'a'.repeat(81),
      'experiment/' + 'x'.repeat(200),
      'experiment/wf-999/task/' + 'z'.repeat(300),
      '/'.repeat(200),
    ];
    for (const branch of cases) {
      expect(sanitizeBranchForPath(branch).length).toBeLessThanOrEqual(MAX_PATH_SEGMENT);
    }
  });
});
