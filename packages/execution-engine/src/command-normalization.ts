/**
 * Strip a leading `cd <absolute-path> && ` or `cd <absolute-path> ; ` prefix
 * from a command string. Managed workspaces already set the cwd, so absolute
 * cd prefixes would fail inside a managed worktree. Relative cd prefixes are
 * intentionally preserved.
 */
export function stripAbsoluteCdPrefix(cmd: string): string {
  const match = cmd.match(
    /^cd\s+(?:"(\/[^"]*?)"|'(\/[^']*?)'|(\/\S+?))\s*(?:&&|;)\s*([\s\S]*)$/,
  );
  if (!match) return cmd;
  return match[4] || cmd;
}

/**
 * Build the command string shown to an auto-fix agent so it matches how the
 * executor will actually run the task inside a managed workspace.
 */
export function normalizeCommandForFixPrompt(command: string, executorType?: string): string {
  if (executorType === 'ssh') {
    return stripAbsoluteCdPrefix(command);
  }
  return command;
}
