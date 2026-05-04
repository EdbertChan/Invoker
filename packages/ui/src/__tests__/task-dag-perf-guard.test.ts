import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const taskNodeSource = readFileSync(
  resolve(__dirname, '..', 'components', 'TaskNode.tsx'),
  'utf-8',
);
const mergeGateNodeSource = readFileSync(
  resolve(__dirname, '..', 'components', 'MergeGateNode.tsx'),
  'utf-8',
);
const bundledEdgeSource = readFileSync(
  resolve(__dirname, '..', 'components', 'BundledEdge.tsx'),
  'utf-8',
);
const cssSource = readFileSync(
  resolve(__dirname, '..', 'index.css'),
  'utf-8',
);

describe('TaskDAG perf guard', () => {
  it('keeps task cards free of heavy box shadows', () => {
    expect(taskNodeSource).not.toContain('shadow-[0_6px_24px_rgba(0,0,0,0.28)]');
    expect(taskNodeSource).not.toContain('shadow-[0_0_0_1px_rgba(255,255,255,0.25),0_10px_30px_rgba(0,0,0,0.38)]');
    expect(mergeGateNodeSource).not.toContain('shadow-[0_6px_24px_rgba(0,0,0,0.28)]');
    expect(mergeGateNodeSource).not.toContain('shadow-[0_0_0_1px_rgba(255,255,255,0.25),0_10px_30px_rgba(0,0,0,0.38)]');
  });

  it('does not reintroduce edge hover filters or stroke transitions', () => {
    expect(bundledEdgeSource).not.toContain('transition:');
    expect(bundledEdgeSource).not.toContain('drop-shadow');
  });

  it('keeps the graph subtree in reduced-effects mode', () => {
    expect(cssSource).toContain('.task-dag-perf-optimized');
    expect(cssSource).toContain('animation: none !important;');
    expect(cssSource).toContain('transition: none !important;');
    expect(cssSource).toContain('filter: none !important;');
  });

  it('does not restore legacy edge-flow or pulse keyframes', () => {
    expect(cssSource).not.toContain('@keyframes edge-flow');
    expect(cssSource).not.toContain('@keyframes pulse-strong');
    expect(cssSource).not.toContain('will-change: transform, opacity, filter');
  });
});
