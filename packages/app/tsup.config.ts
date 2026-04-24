import { defineConfig } from 'tsup';
import { cpSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const gitSha = execSync('git rev-parse --short HEAD').toString().trim();
const pkgVersion = JSON.parse(readFileSync('./package.json', 'utf-8')).version;

export default defineConfig({
  entry: ['src/main.ts', 'src/preload.ts', 'src/headless-client.ts'],
  format: ['cjs'],
  outDir: 'dist',
  external: ['electron', 'sql.js', 'dockerode', '@invoker/surfaces', '@slack/bolt', 'dotenv'],
  noExternal: [
    '@invoker/workflow-core',
    '@invoker/workflow-graph',
    '@invoker/contracts',
    '@invoker/data-store',
    '@invoker/transport',
    '@invoker/execution-engine',
    'yaml',
  ],
  define: {
    '__BUILD_SHA__': JSON.stringify(gitSha),
    '__BUILD_VERSION__': JSON.stringify(pkgVersion),
  },
  clean: true,
  onSuccess: async () => {
    cpSync('assets', 'dist/assets', { recursive: true });
  },
});
