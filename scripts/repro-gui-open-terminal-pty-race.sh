#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_FILE="$ROOT_DIR/packages/app/src/__tests__/__tmp_repro_gui_open_terminal_pty_race.test.ts"

cleanup() {
  rm -f "$TEST_FILE"
}
trap cleanup EXIT

cat >"$TEST_FILE" <<'TS'
import { describe, expect, it } from 'vitest';
import {
  EmbeddedTerminalManager,
  type EmbeddedTerminalBackend,
} from '../embedded-terminal-manager.js';

describe('repro: GUI open-terminal PTY output race', () => {
  it('drops output emitted before the renderer terminal pane subscribes', () => {
    const backend: EmbeddedTerminalBackend = {
      name: 'pty',
      spawn(opts) {
        opts.emitOutput('FIRST_FRAME_FROM_PTY\n');
        return {
          write() {},
          resize() {},
          close() {},
        };
      },
    };

    const manager = new EmbeddedTerminalManager({ backend });

    const session = manager.openOrReuse({
      taskId: 'wf/repro-terminal',
      spec: { command: 'repro-command', args: [] },
      cwd: process.cwd(),
    });

    const rendererObserved: string[] = [];
    manager.on('output', (event) => {
      if (event.sessionId === session.sessionId) rendererObserved.push(event.data);
    });

    expect(session.mode).toBe('spawn');
    expect(rendererObserved).toContain('FIRST_FRAME_FROM_PTY\n');
  });
});
TS

set +e
OUTPUT="$(cd "$ROOT_DIR" && pnpm --filter @invoker/app exec vitest run "$TEST_FILE" 2>&1)"
STATUS=$?
set -e

printf '%s\n' "$OUTPUT"

if [[ $STATUS -eq 0 ]]; then
  echo "UNEXPECTED: repro did not reproduce the race; the temporary test passed." >&2
  exit 1
fi

if grep -q "FIRST_FRAME_FROM_PTY" <<<"$OUTPUT" && grep -q "toContain" <<<"$OUTPUT"; then
  echo "REPRODUCED: PTY output emitted before the renderer subscribes is not replayed to the GUI."
  exit 0
fi

echo "UNEXPECTED: temporary test failed for a different reason." >&2
exit "$STATUS"
