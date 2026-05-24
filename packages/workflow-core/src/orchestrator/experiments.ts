export function canonicalizeExperimentIds(ids: readonly string[]): string[] {
  return Array.from(new Set(ids)).slice().sort();
}

export function isExperimentReselection(
  previousSet: readonly string[] | undefined,
  nextSet: readonly string[],
): boolean {
  if (previousSet === undefined) return false;
  const previous = canonicalizeExperimentIds(previousSet);
  const next = canonicalizeExperimentIds(nextSet);
  return previous.length !== next.length || previous.some((id, index) => id !== next[index]);
}
