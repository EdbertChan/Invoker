import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_WORKTREE_PROVISION_COMMAND } from '../default-worktree-provision-command.js';

describe('DEFAULT_WORKTREE_PROVISION_COMMAND', () => {
  it('prepends a Homebrew Node matching .node-version before pnpm install', () => {
    const command = DEFAULT_WORKTREE_PROVISION_COMMAND;
    const nodeVersionIdx = command.indexOf('.node-version');
    const homebrewNodeIdx = command.indexOf('/opt/homebrew/opt/node@$INVOKER_NODE_MAJOR/bin');
    const pnpmInstallIdx = command.indexOf('pnpm install --frozen-lockfile');

    expect(nodeVersionIdx).toBeGreaterThanOrEqual(0);
    expect(homebrewNodeIdx).toBeGreaterThan(nodeVersionIdx);
    expect(pnpmInstallIdx).toBeGreaterThan(homebrewNodeIdx);
    expect(command).toContain('/usr/local/opt/node@$INVOKER_NODE_MAJOR/bin');
  });

  it('uses the .node-version Node before invoking pnpm', () => {
    const dir = mkdtempSync(join(tmpdir(), 'invoker-provision-node-version-'));
    const nodeBin = join(dir, 'node22', 'bin');
    const pnpmBin = join(dir, 'pnpm-bin');
    mkdirSync(nodeBin, { recursive: true });
    mkdirSync(pnpmBin, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"name":"fixture"}\n');
    writeFileSync(join(dir, '.node-version'), '22\n');
    writeFileSync(
      join(nodeBin, 'node'),
      '#!/bin/sh\nprintf "v22.99.0\\n"\n',
      { mode: 0o755 },
    );
    writeFileSync(
      join(pnpmBin, 'pnpm'),
      '#!/bin/sh\nnode --version > pnpm-node-version.txt\nexit 0\n',
      { mode: 0o755 },
    );

    execFileSync('/bin/bash', ['-c', `set -euo pipefail; ${DEFAULT_WORKTREE_PROVISION_COMMAND}`], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${pnpmBin}:/usr/bin:/bin`,
        INVOKER_NODE_VERSION_BIN_DIRS: nodeBin,
      },
    });

    expect(readFileSync(join(dir, 'pnpm-node-version.txt'), 'utf8')).toBe('v22.99.0\n');
  });
});
