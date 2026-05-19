import { defineConfig } from 'tsup';

const skipDts = process.env.INVOKER_REQUIRED_BUILDS_SKIP_DTS === '1';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: skipDts ? false : { resolve: false, compilerOptions: { composite: false } },
  tsconfig: 'tsconfig.tsup.json',
  clean: true,
  // Bundle workspace deps (their package.json point to .ts source, won't load at runtime).
  // sql.js/dockerode stay external — resolved from node_modules.
  noExternal: [
    '@invoker/workflow-core',
    '@invoker/contracts',
    '@invoker/data-store',
    '@invoker/transport',
    'yaml',
  ],
  external: ['@slack/bolt', 'sql.js', 'dockerode'],
});
