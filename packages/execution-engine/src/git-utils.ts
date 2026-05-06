import { createHash } from 'node:crypto';

/**
 * Compute a deterministic 12-character hash of a repository URL.
 * Used for creating consistent cache directories across executors and pools.
 */
export function computeRepoUrlHash(repoUrl: string): string {
  return createHash('sha256').update(repoUrl).digest('hex').slice(0, 12);
}

/**
 * Maximum length for a worktree directory name.
 *
 * Long branch names (containing workflow IDs, task names, attempt hashes)
 * create deep filesystem paths. When combined with pnpm's
 * `node_modules/.pnpm/<pkg>/node_modules/<pkg>/...` structure, excessively
 * long worktree directory names cause ENOENT failures during `pnpm install`.
 *
 * 80 chars leaves ~170+ chars of headroom for the deepest pnpm paths on a
 * typical system with a ~50 char worktree base prefix.
 */
export const MAX_PATH_SEGMENT = 80;

/**
 * Sanitize a git branch name for use as a filesystem path segment.
 * Converts slashes to hyphens to create a safe directory name.
 * When the result exceeds {@link MAX_PATH_SEGMENT} characters, it is
 * truncated and a deterministic 12-char hash suffix is appended so different
 * branch names never collide.
 *
 * Example: "experiment/task-123-abc" → "experiment-task-123-abc"
 */
export function sanitizeBranchForPath(branch: string): string {
  const sanitized = branch.replace(/\//g, '-');
  if (sanitized.length <= MAX_PATH_SEGMENT) return sanitized;
  const hash = createHash('sha256').update(branch).digest('hex').slice(0, 12);
  // 80 - 1 (dash) - 12 (hash) = 67 chars for the truncated prefix
  const prefixLen = MAX_PATH_SEGMENT - 1 - 12;
  return `${sanitized.slice(0, prefixLen)}-${hash}`;
}
