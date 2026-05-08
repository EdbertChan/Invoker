/**
 * Canonical approval modes stored in persistence and consumed by the merge executor.
 */
export type CanonicalApprovalMode = 'manual' | 'automatic' | 'external_review';

const VALID_INPUT = new Set(['manual', 'automatic', 'external_review']);

/**
 * Normalize user-facing approval mode strings for workflow persistence.
 * @throws if the value is not a known approval mode label
 */
export function normalizeApprovalMode(raw: string): CanonicalApprovalMode {
  if (!VALID_INPUT.has(raw)) {
    throw new Error(
      `Invalid approvalMode: "${raw}". Expected one of: ${[...VALID_INPUT].join(', ')}`,
    );
  }
  if (raw === 'external_review') return 'external_review';
  if (raw === 'automatic') return 'automatic';
  return 'manual';
}
