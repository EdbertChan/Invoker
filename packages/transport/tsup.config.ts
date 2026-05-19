import { defineConfig } from 'tsup';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const skipDts = process.env.INVOKER_REQUIRED_BUILDS_SKIP_DTS === '1';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  dts: skipDts
    ? false
    : {
        compilerOptions: {
          composite: false,
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          types: ['node'],
          typeRoots: [
            path.join(root, 'node_modules/@types'),
            path.join(root, '../../node_modules/@types'),
          ],
        },
      },
});
