/**
 * Keyboard navigation helpers shared by context menus.
 *
 * Both ContextMenu (task) and WorkflowContextMenu maintain a roving
 * highlight that cycles through enabled menuitems on ArrowUp/ArrowDown.
 * Items without `enabled: false` are treated as activatable.
 */

export interface KeyboardMenuItem {
  enabled?: boolean;
}

/** Cycle to the next (delta=1) or previous (delta=-1) enabled index. */
export function cycleEnabledIndex(
  items: ReadonlyArray<KeyboardMenuItem>,
  current: number,
  delta: 1 | -1,
): number {
  const len = items.length;
  if (len === 0) return current;
  for (let step = 1; step <= len; step++) {
    const idx = ((current + delta * step) % len + len) % len;
    if (items[idx]?.enabled !== false) return idx;
  }
  return current;
}

/** First enabled item index, or 0 when none are enabled. */
export function findFirstEnabledIndex(items: ReadonlyArray<KeyboardMenuItem>): number {
  const idx = items.findIndex((item) => item.enabled !== false);
  return idx >= 0 ? idx : 0;
}

/** Keys that an open context menu owns and the document should not act on. */
export const MENU_OWNED_KEYS = new Set(['ArrowUp', 'ArrowDown', 'Enter', ' ']);
