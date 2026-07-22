import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKTREE_PROVISION_COMMAND } from '../default-worktree-provision-command.js';
import { resolveProvisionCommand } from '../provision-command.js';

describe('resolveProvisionCommand', () => {
  it('returns default when no repo map or repoUrl', () => {
    expect(resolveProvisionCommand({})).toBe(DEFAULT_WORKTREE_PROVISION_COMMAND);
    expect(resolveProvisionCommand({
      repoUrl: 'https://github.com/acme/app.git',
    })).toBe(DEFAULT_WORKTREE_PROVISION_COMMAND);
    expect(resolveProvisionCommand({
      byRepo: { 'https://github.com/acme/app.git': 'echo hi' },
    })).toBe(DEFAULT_WORKTREE_PROVISION_COMMAND);
  });

  it('matches exact repo URL keys', () => {
    expect(resolveProvisionCommand({
      repoUrl: 'https://github.com/acme/app.git',
      byRepo: {
        'https://github.com/acme/app.git': 'pnpm install --frozen-lockfile',
      },
    })).toBe('pnpm install --frozen-lockfile');
  });

  it('matches GitHub SSH and HTTPS as the same repo', () => {
    const byRepo = {
      'git@github.com:Neko-Catpital-Labs/Invoker.git': 'NODE_ENV=development pnpm install --frozen-lockfile',
    };
    expect(resolveProvisionCommand({
      repoUrl: 'https://github.com/Neko-Catpital-Labs/Invoker.git',
      byRepo,
    })).toBe('NODE_ENV=development pnpm install --frozen-lockfile');
    expect(resolveProvisionCommand({
      repoUrl: 'ssh://git@github.com/Neko-Catpital-Labs/Invoker.git',
      byRepo,
    })).toBe('NODE_ENV=development pnpm install --frozen-lockfile');
  });

  it('matches when config key is HTTPS and task uses SSH', () => {
    expect(resolveProvisionCommand({
      repoUrl: 'git@github.com:acme/app.git',
      byRepo: {
        'https://github.com/acme/app.git': 'echo from-https-key',
      },
    })).toBe('echo from-https-key');
  });

  it('uses exact non-GitHub URL match only', () => {
    const byRepo = {
      'https://gitlab.example.com/team/app.git': 'npm ci',
    };
    expect(resolveProvisionCommand({
      repoUrl: 'https://gitlab.example.com/team/app.git',
      byRepo,
    })).toBe('npm ci');
    expect(resolveProvisionCommand({
      repoUrl: 'git@gitlab.example.com:team/app.git',
      byRepo,
      fallback: 'fallback-cmd',
    })).toBe('fallback-cmd');
  });

  it('prefers exact key over normalized collision when both present', () => {
    expect(resolveProvisionCommand({
      repoUrl: 'https://github.com/acme/app.git',
      byRepo: {
        'https://github.com/acme/app.git': 'exact',
        'git@github.com:acme/app.git': 'ssh-key',
      },
    })).toBe('exact');
  });

  it('uses fallback when map misses', () => {
    expect(resolveProvisionCommand({
      repoUrl: 'https://github.com/acme/other.git',
      byRepo: {
        'https://github.com/acme/app.git': 'echo app',
      },
      fallback: 'target-override',
    })).toBe('target-override');
  });

  it('ignores empty mapped commands', () => {
    expect(resolveProvisionCommand({
      repoUrl: 'https://github.com/acme/app.git',
      byRepo: {
        'https://github.com/acme/app.git': '',
      },
      fallback: 'fallback-cmd',
    })).toBe('fallback-cmd');
  });
});
