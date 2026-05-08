import { describe, it, expect } from 'vitest';
import { normalizeApprovalMode } from '../approval-mode.js';

describe('normalizeApprovalMode', () => {
  it('maps external_review to external_review', () => {
    expect(normalizeApprovalMode('external_review')).toBe('external_review');
  });

  it('passes through manual and automatic', () => {
    expect(normalizeApprovalMode('manual')).toBe('manual');
    expect(normalizeApprovalMode('automatic')).toBe('automatic');
  });

  it('rejects unknown labels', () => {
    expect(() => normalizeApprovalMode('github')).toThrow(/Invalid approvalMode/);
    expect(() => normalizeApprovalMode('gitlab')).toThrow(/Invalid approvalMode/);
  });
});
