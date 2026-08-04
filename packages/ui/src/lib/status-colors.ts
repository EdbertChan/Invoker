import type { TaskStatus, WorkflowStatus } from '../types.js';

export type StatusVisualKey =
  | TaskStatus
  | WorkflowStatus
  | 'assigning'
  | 'running_executing'
  | 'fix_approval';

export interface StatusInlineColors {
  bg: string;
  border: string;
  text: string;
}

export interface StatusVisual {
  bg: string;
  border: string;
  text: string;
  dot: string;
  rail: string;
  inline: StatusInlineColors;
  active: boolean;
  pulse: boolean;
}

const NEUTRAL_SURFACE = 'bg-card';
const NEUTRAL_INLINE_BG = '#ffe0f1';
const NEUTRAL_INLINE_BORDER = 'rgba(61,20,40,0.12)';

export const STATUS_VISUALS: Record<StatusVisualKey, StatusVisual> = {
  pending: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-muted-foreground',
    dot: 'bg-neutral-400',
    rail: 'bg-neutral-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#525252' },
    active: false,
    pulse: false,
  },
  running: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-blue-700',
    dot: 'bg-blue-400',
    rail: 'bg-blue-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#1d4ed8' },
    active: true,
    pulse: true,
  },
  assigning: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-amber-800',
    dot: 'bg-amber-400',
    rail: 'bg-amber-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#92400e' },
    active: true,
    pulse: true,
  },
  running_executing: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-sky-700',
    dot: 'bg-sky-400',
    rail: 'bg-sky-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#0369a1' },
    active: true,
    pulse: true,
  },
  fixing_with_ai: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-orange-800',
    dot: 'bg-orange-400',
    rail: 'bg-orange-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#9a3412' },
    active: true,
    pulse: true,
  },
  completed: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-emerald-800',
    dot: 'bg-emerald-400',
    rail: 'bg-emerald-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#065f46' },
    active: false,
    pulse: false,
  },
  failed: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-red-700',
    dot: 'bg-red-500',
    rail: 'bg-red-500',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#b91c1c' },
    active: false,
    pulse: false,
  },
  closed: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-zinc-600',
    dot: 'bg-zinc-500',
    rail: 'bg-zinc-500',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#525252' },
    active: false,
    pulse: false,
  },
  blocked: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-slate-600',
    dot: 'bg-slate-500',
    rail: 'bg-slate-500',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#525252' },
    active: false,
    pulse: false,
  },
  needs_input: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-orange-800',
    dot: 'bg-orange-400',
    rail: 'bg-orange-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#9a3412' },
    active: false,
    pulse: false,
  },
  review_ready: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-sky-700',
    dot: 'bg-sky-400',
    rail: 'bg-sky-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#0369a1' },
    active: false,
    pulse: false,
  },
  awaiting_approval: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-purple-700',
    dot: 'bg-purple-400',
    rail: 'bg-purple-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#7e22ce' },
    active: false,
    pulse: false,
  },
  fix_approval: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-fuchsia-700',
    dot: 'bg-fuchsia-400',
    rail: 'bg-fuchsia-400',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#a21caf' },
    active: false,
    pulse: false,
  },
  stale: {
    bg: NEUTRAL_SURFACE,
    border: 'border-border',
    text: 'text-neutral-600',
    dot: 'bg-neutral-600',
    rail: 'bg-neutral-600',
    inline: { bg: NEUTRAL_INLINE_BG, border: NEUTRAL_INLINE_BORDER, text: '#525252' },
    active: false,
    pulse: false,
  },
};

export const DEFAULT_STATUS_VISUAL = STATUS_VISUALS.pending;

export function getStatusVisual(status: string | undefined): StatusVisual {
  if (!status) return DEFAULT_STATUS_VISUAL;
  return STATUS_VISUALS[status as StatusVisualKey] ?? DEFAULT_STATUS_VISUAL;
}

export function getStatusInlineColors(status: string | undefined): StatusInlineColors {
  return getStatusVisual(status).inline;
}

export function isActiveStatusVisual(status: string | undefined): boolean {
  return getStatusVisual(status).active;
}
