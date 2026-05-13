import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { loadConfig } from '../config.js';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const testDir = join(tmpdir(), `invoker-config-test-${process.pid}`);
const fakeHome = join(testDir, 'home');

beforeEach(() => {
  mkdirSync(join(fakeHome, '.invoker'), { recursive: true });
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => fakeHome,
  };
});

describe('loadConfig', () => {
  it('returns empty config when no files exist', () => {
    const config = loadConfig();
    expect(config).toEqual({});
  });

  it('reads user-level ~/.invoker/config.json', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ defaultBranch: 'main' }),
    );
    const config = loadConfig();
    expect(config.defaultBranch).toBe('main');
  });

  it('throws on malformed JSON', () => {
    writeFileSync(join(fakeHome, '.invoker', 'config.json'), 'not json {{{');
    expect(() => loadConfig()).toThrow(/Invalid Invoker config JSON/);
  });

  it('throws on non-object JSON', () => {
    writeFileSync(join(fakeHome, '.invoker', 'config.json'), '"just a string"');
    expect(() => loadConfig()).toThrow(/expected a JSON object/);
  });

  it('reads planningTimeoutSeconds from user config', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ planningTimeoutSeconds: 600 }),
    );
    const config = loadConfig();
    expect(config.planningTimeoutSeconds).toBe(600);
  });

  it('reads planningHeartbeatIntervalSeconds from user config', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ planningHeartbeatIntervalSeconds: 30 }),
    );
    const config = loadConfig();
    expect(config.planningHeartbeatIntervalSeconds).toBe(30);
  });

  it('reads disableAutoRunOnStartup from user config', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ disableAutoRunOnStartup: true }),
    );
    const config = loadConfig();
    expect(config.disableAutoRunOnStartup).toBe(true);
  });

  it('reads maxConcurrency from user config', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ maxConcurrency: 6 }),
    );
    const config = loadConfig();
    expect(config.maxConcurrency).toBe(6);
  });

  it('reads autoFixRetries from user config', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ autoFixRetries: 3 }),
    );
    const config = loadConfig();
    expect(config.autoFixRetries).toBe(3);
  });

  it('reads autoApproveAIFixes from user config', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ autoApproveAIFixes: true }),
    );
    const config = loadConfig();
    expect(config.autoApproveAIFixes).toBe(true);
  });

  it('reads autoFixAgent from user config', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ autoFixAgent: 'codex' }),
    );
    const config = loadConfig();
    expect(config.autoFixAgent).toBe('codex');
  });

  it('loadConfig picks up browser field', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ browser: 'firefox' }),
    );
    const config = loadConfig();
    expect(config.browser).toBe('firefox');
  });

  it('reads imageStorage from user config', () => {
    const imageStorage = {
      provider: 'r2',
      accountId: 'abc123',
      bucketName: 'my-bucket',
      accessKeyId: 'key',
      secretAccessKey: 'secret',
      publicUrlBase: 'https://my-bucket.r2.dev',
    };
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ imageStorage }),
    );
    const config = loadConfig();
    expect(config.imageStorage).toEqual(imageStorage);
  });

  it('reads local execution pool members', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ executionPools: { localOnly: ['local'] } }),
    );
    const config = loadConfig();
    expect(config.executionPools?.localOnly).toEqual(['local']);
  });

  it('reads SSH execution pool members backed by remoteTargets', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({
        remoteTargets: {
          'remote-1': {
            host: '127.0.0.1',
            user: 'runner',
            sshKeyPath: '~/.ssh/id_ed25519',
            maxConcurrentTasks: 2,
          },
        },
        executionPools: { sshLight: ['remote-1'] },
      }),
    );
    const config = loadConfig();
    expect(config.executionPools?.sshLight).toEqual(['remote-1']);
    expect(config.remoteTargets?.['remote-1']?.maxConcurrentTasks).toBe(2);
  });

  it('reads mixed local and SSH execution pool members', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({
        remoteTargets: {
          'remote-1': { host: '127.0.0.1', user: 'runner', sshKeyPath: '~/.ssh/id_ed25519' },
        },
        executionPools: { mixed: ['local', 'remote-1'] },
      }),
    );
    const config = loadConfig();
    expect(config.executionPools?.mixed).toEqual(['local', 'remote-1']);
  });

  it('rejects execution pool members missing from remoteTargets', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ executionPools: { sshLight: ['missing-remote'] } }),
    );
    expect(() => loadConfig()).toThrow('executionPools.sshLight member "missing-remote" must be "local" or a key in remoteTargets');
  });

  it('rejects empty execution pools', () => {
    writeFileSync(
      join(fakeHome, '.invoker', 'config.json'),
      JSON.stringify({ executionPools: { empty: [] } }),
    );
    expect(() => loadConfig()).toThrow('executionPools.empty must not be empty');
  });

});
