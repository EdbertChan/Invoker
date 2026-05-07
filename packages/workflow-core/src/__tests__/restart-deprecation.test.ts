import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Orchestrator } from '../orchestrator.js';
import { CommandService } from '../command-service.js';

describe('restartTask retirement (INV-91)', () => {
  // ── Orchestrator-level: restartTask is GONE ───────────────────

  describe('Orchestrator.restartTask is removed', () => {
    it('restartTask no longer exists on the prototype', () => {
      expect((Orchestrator.prototype as Record<string, unknown>).restartTask).toBeUndefined();
    });

    it('canonical retryTask and recreateTask still exist', () => {
      expect(typeof Orchestrator.prototype.retryTask).toBe('function');
      expect(typeof Orchestrator.prototype.recreateTask).toBe('function');
    });
  });

  // ── CommandService-level: restartTask is GONE ─────────────────

  describe('CommandService.restartTask is removed', () => {
    it('restartTask no longer exists on the prototype', () => {
      expect((CommandService.prototype as Record<string, unknown>).restartTask).toBeUndefined();
    });

    it('canonical retryTask and recreateTask still exist', () => {
      expect(typeof CommandService.prototype.retryTask).toBe('function');
      expect(typeof CommandService.prototype.recreateTask).toBe('function');
    });
  });

  // ── Lock-in: no production code references deprecated symbols ─

  describe('production lock-in: no deprecated symbols in workflow-core/src/', () => {
    function walk(dir: string, files: string[] = []): string[] {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        const st = statSync(full);
        if (st.isDirectory()) {
          if (entry === '__tests__' || entry === 'node_modules') continue;
          walk(full, files);
        } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
          files.push(full);
        }
      }
      return files;
    }

    it('no production .ts file declares or calls restartTask', () => {
      const srcRoot = new URL('..', import.meta.url).pathname;
      const files = walk(srcRoot);
      expect(files.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/restartTask/.test(line)) {
            offenders.push(`${relative(srcRoot, file)}:${i + 1}: ${line.trim()}`);
          }
        }
      }

      expect(offenders, `Regression: production code still references restartTask:\n${offenders.join('\n')}`).toEqual([]);
    });
  });
});
