import { DEFAULT_WORKTREE_PROVISION_COMMAND } from './default-worktree-provision-command.js';
import { computeRepoCacheKey } from './git-utils.js';

export interface ResolveProvisionCommandOptions {
  /** Task / workflow repository URL. */
  repoUrl?: string;
  /** Top-level config map: repo URL (any common spelling) → provision shell command. */
  byRepo?: Record<string, string>;
  /**
   * Used when no repo map entry matches (e.g. SSH target provisionCommand).
   * Defaults to DEFAULT_WORKTREE_PROVISION_COMMAND when omitted.
   */
  fallback?: string;
}

/**
 * Resolve the shell command used to provision a workspace for a repo.
 *
 * Matching:
 * 1. Exact key match on `repoUrl`
 * 2. Normalized GitHub identity match (`github.com/owner/repo`) so SSH/HTTPS
 *    spellings of the same repo share one config entry
 * 3. Otherwise `fallback`, or the default worktree provision command
 */
export function resolveProvisionCommand(options: ResolveProvisionCommandOptions): string {
  const fallback = options.fallback ?? DEFAULT_WORKTREE_PROVISION_COMMAND;
  const byRepo = options.byRepo;
  const repoUrl = options.repoUrl?.trim();
  if (!repoUrl || !byRepo || Object.keys(byRepo).length === 0) {
    return fallback;
  }

  const exact = byRepo[repoUrl];
  if (typeof exact === 'string' && exact.length > 0) {
    return exact;
  }

  const want = computeRepoCacheKey(repoUrl);
  for (const [key, command] of Object.entries(byRepo)) {
    if (typeof command !== 'string' || command.length === 0) continue;
    if (key === repoUrl) return command;
    if (computeRepoCacheKey(key) === want) return command;
  }

  return fallback;
}
