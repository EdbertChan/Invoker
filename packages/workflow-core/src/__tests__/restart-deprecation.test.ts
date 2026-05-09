import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Orchestrator } from '../orchestrator.js';
import { CommandService } from '../command-service.js';

// ── Post-migration assertions ─────────────────────────────────
// INV-91 retirement: the deprecated `restartTask` symbol has been
// removed from both Orchestrator and CommandService. These tests
// guard against re-introduction.

describe('restartTask retirement (INV-91)', () => {
  it('Orchestrator does not have a restartTask method', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((Orchestrator.prototype as any).restartTask).toBeUndefined();
  });

  it('CommandService does not have a restartTask method', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((CommandService.prototype as any).restartTask).toBeUndefined();
  });

  it('Orchestrator exposes retryTask and recreateTask', () => {
    expect(typeof Orchestrator.prototype.retryTask).toBe('function');
    expect(typeof Orchestrator.prototype.recreateTask).toBe('function');
  });

  it('CommandService exposes retryTask and recreateTask', () => {
    expect(typeof CommandService.prototype.retryTask).toBe('function');
    expect(typeof CommandService.prototype.recreateTask).toBe('function');
  });

  // ── Lock-in: no production code references deprecated symbols ──

  describe('production lock-in: no .restartTask( call sites in workflow-core/src/', () => {
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

    it('no production .ts file under workflow-core/src/ calls .restartTask(', () => {
      const srcRoot = new URL('..', import.meta.url).pathname;
      const files = walk(srcRoot);
      expect(files.length).toBeGreaterThan(0);

      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/\.\s*restartTask\s*\(/.test(line)) {
            offenders.push(`${relative(srcRoot, file)}:${i + 1}: ${line.trim()}`);
          }
        }
      }

      expect(offenders, `Regression: production code still calls .restartTask(:\n${offenders.join('\n')}`).toEqual([]);
    });

    it('no production .ts file references restartTask as a string identifier', () => {
      const srcRoot = new URL('..', import.meta.url).pathname;
      const files = walk(srcRoot);

      const offenders: string[] = [];
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Skip comment lines (JSDoc, inline)
          if (/^\s*(\*|\/\/)/.test(line)) continue;
          if (/restartTask/.test(line)) {
            offenders.push(`${relative(srcRoot, file)}:${i + 1}: ${line.trim()}`);
          }
        }
      }

      expect(offenders, `Regression: production code references restartTask:\n${offenders.join('\n')}`).toEqual([]);
    });
  });
});
