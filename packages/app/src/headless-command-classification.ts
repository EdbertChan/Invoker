/**
 * Shared classifier for headless CLI commands.
 *
 * This is used by both:
 * - main.ts (pre-init routing/delegation decisions)
 * - tests/policy checks to keep command routing behavior consistent
 */

import type { PersistenceAdapter } from '@invoker/data-store';
import type { TaskState } from '@invoker/workflow-core';
import { findHeadlessCommandDefinition, isMutatingSetSubcommand } from './headless-command-registry.js';
import type { WorkflowMutationPriority } from './workflow-mutation-coordinator.js';

export type HeadlessTargetLookup = Pick<PersistenceAdapter, 'loadWorkflow' | 'listWorkflows' | 'loadTasks'>;

export interface HeadlessExecMutationPayload {
  args: string[];
  waitForApproval?: boolean;
  noTrack?: boolean;
  traceId?: string;
}

export type HeadlessExecClassification = {
  workflowId?: string;
  priority: WorkflowMutationPriority;
};

export type HeadlessTargetResolution =
  | { kind: 'workflow'; workflowId: string }
  | { kind: 'task'; workflowId: string; taskId: string; resolvedTaskId: string }
  | { kind: 'unknown'; target: string };

type QueueTargetKind = 'workflow' | 'task' | 'workflow-or-task';

type HeadlessExecCommandSpec = {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly usage: string;
  readonly priority: WorkflowMutationPriority;
  readonly targetIndex: number;
  readonly targetKind: QueueTargetKind;
  readonly minArgs: number;
  readonly maxArgs?: number;
  readonly validate?: (args: string[]) => void;
};

type HeadlessExecSetSubcommandSpec = Omit<HeadlessExecCommandSpec, 'name' | 'aliases' | 'usage'> & {
  readonly subcommand: string;
  readonly usage: string;
};

const WORKFLOW_COMMAND_SPECS: readonly HeadlessExecCommandSpec[] = [
  {
    name: 'resume',
    usage: 'resume <workflowId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'retry',
    usage: 'retry <workflowId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'recreate',
    usage: 'recreate <workflowId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'cancel-workflow',
    usage: 'cancel-workflow <workflowId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'delete-workflow',
    aliases: ['delete'],
    usage: 'delete <workflowId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'fork-workflow',
    usage: 'fork-workflow <workflowId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'detach-workflow',
    usage: 'detach-workflow <workflowId> <upstreamWorkflowId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 3,
    maxArgs: 3,
  },
  {
    name: 'rebase-retry',
    usage: 'rebase-retry <workflowId|mergeTaskId|taskId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow-or-task',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'rebase-recreate',
    usage: 'rebase-recreate <workflowId|mergeTaskId|taskId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow-or-task',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'cancel',
    usage: 'cancel <taskId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'retry-task',
    usage: 'retry-task <taskId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'recreate-task',
    usage: 'recreate-task <taskId>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'approve',
    usage: 'approve <taskId>',
    priority: 'normal',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 2,
    maxArgs: 2,
  },
  {
    name: 'reject',
    usage: 'reject <taskId> [reason]',
    priority: 'normal',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 2,
  },
  {
    name: 'input',
    usage: 'input <taskId> <text>',
    priority: 'normal',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 3,
  },
  {
    name: 'select',
    usage: 'select <taskId> <experimentId>',
    priority: 'normal',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 3,
    maxArgs: 3,
  },
  {
    name: 'fix',
    usage: 'fix <taskId> [claude|codex]',
    priority: 'normal',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 2,
    maxArgs: 3,
  },
  {
    name: 'resolve-conflict',
    usage: 'resolve-conflict <taskId> [claude|codex]',
    priority: 'normal',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 2,
    maxArgs: 3,
  },
  {
    name: 'edit',
    usage: 'edit <taskId> <newCommand>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 3,
  },
  {
    name: 'edit-executor',
    aliases: ['edit-type'],
    usage: 'edit-executor <taskId> <runnerKind> [poolMemberId]',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 3,
    maxArgs: 4,
  },
  {
    name: 'edit-agent',
    usage: 'edit-agent <taskId> <agent>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'task',
    minArgs: 3,
    maxArgs: 3,
  },
  {
    name: 'set-merge-mode',
    usage: 'set-merge-mode <workflowId> <mode>',
    priority: 'high',
    targetIndex: 1,
    targetKind: 'workflow',
    minArgs: 3,
    maxArgs: 3,
  },
] as const;

const SET_SUBCOMMAND_SPECS: readonly HeadlessExecSetSubcommandSpec[] = [
  {
    subcommand: 'command',
    usage: 'set command <taskId> <cmd>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 4,
  },
  {
    subcommand: 'prompt',
    usage: 'set prompt <taskId> <text>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 4,
  },
  {
    subcommand: 'executor',
    usage: 'set executor <taskId> <type> [poolMemberId]',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 4,
    maxArgs: 5,
  },
  {
    subcommand: 'agent',
    usage: 'set agent <taskId> <agent>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 4,
    maxArgs: 4,
  },
  {
    subcommand: 'merge-mode',
    usage: 'set merge-mode <workflowId> <mode>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'workflow',
    minArgs: 4,
    maxArgs: 4,
  },
  {
    subcommand: 'fix-prompt',
    usage: 'set fix-prompt <taskId> <text>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 4,
  },
  {
    subcommand: 'fix-context',
    usage: 'set fix-context <taskId> <text>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 4,
  },
  {
    subcommand: 'gate-policy',
    usage: 'set gate-policy <taskId> <workflowId> [depTaskId] <completed|review_ready>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 5,
    maxArgs: 6,
    validate: (args) => {
      const gatePolicy = args[args.length - 1];
      if (gatePolicy !== 'completed' && gatePolicy !== 'review_ready') {
        throw new Error(`Invalid gate policy "${String(gatePolicy)}". Expected completed|review_ready`);
      }
    },
  },
  {
    subcommand: 'workflow',
    usage: 'set workflow <workflowId> <fieldPath> <value>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'workflow',
    minArgs: 5,
  },
  {
    subcommand: 'task',
    usage: 'set task <taskId> <fieldPath> <value>',
    priority: 'high',
    targetIndex: 2,
    targetKind: 'task',
    minArgs: 5,
  },
] as const;

function looksLikeWorkflowId(target: string): boolean {
  return /^wf-[^/]+$/.test(target);
}

function parseWorkflowIdFromTaskTarget(target: string): string | null {
  const slashIndex = target.indexOf('/');
  if (slashIndex <= 0) return null;
  const workflowId = target.slice(0, slashIndex);
  return looksLikeWorkflowId(workflowId) ? workflowId : null;
}

function findStoredTaskByTarget(
  lookup: HeadlessTargetLookup,
  target: string,
): { workflowId: string; task: TaskState } | null {
  for (const workflow of lookup.listWorkflows()) {
    const task = lookup.loadTasks(workflow.id).find((candidate) => (
      candidate.id === target || candidate.id.endsWith(`/${target}`)
    ));
    if (task) {
      return { workflowId: workflow.id, task };
    }
  }
  return null;
}

function workflowExists(lookup: HeadlessTargetLookup, workflowId: string): boolean {
  return Boolean(lookup.loadWorkflow(workflowId))
    || lookup.listWorkflows().some((workflow) => workflow.id === workflowId);
}

function resolveExistingWorkflowTarget(targetArg: unknown, lookup: HeadlessTargetLookup): string | undefined {
  const target = String(targetArg ?? '');
  if (!target || !workflowExists(lookup, target)) {
    return undefined;
  }
  return target;
}

function resolveExistingTaskTarget(targetArg: unknown, lookup: HeadlessTargetLookup): string | undefined {
  const target = String(targetArg ?? '');
  if (!target) return undefined;
  const storedTask = findStoredTaskByTarget(lookup, target);
  return storedTask?.workflowId;
}

function resolveExistingQueueTarget(
  targetArg: unknown,
  targetKind: QueueTargetKind,
  lookup: HeadlessTargetLookup,
): string | undefined {
  if (targetKind === 'workflow') {
    return resolveExistingWorkflowTarget(targetArg, lookup);
  }
  if (targetKind === 'task') {
    return resolveExistingTaskTarget(targetArg, lookup);
  }
  return resolveExistingWorkflowTarget(targetArg, lookup)
    ?? resolveExistingTaskTarget(targetArg, lookup);
}

function resolveLooseQueueTarget(
  targetArg: unknown,
  targetKind: QueueTargetKind,
  lookup: HeadlessTargetLookup,
): string | undefined {
  if (targetArg === undefined) return undefined;
  if (targetKind === 'workflow') {
    return String(targetArg);
  }
  return resolveHeadlessTargetWorkflowId(targetArg, lookup);
}

function matchesCommandSpec(spec: HeadlessExecCommandSpec, command: string): boolean {
  return spec.name === command || Boolean(spec.aliases?.includes(command));
}

function findCommandSpec(command: string | undefined): HeadlessExecCommandSpec | undefined {
  if (!command) return undefined;
  return WORKFLOW_COMMAND_SPECS.find((spec) => matchesCommandSpec(spec, command));
}

function findSetSubcommandSpec(subcommand: string | undefined): HeadlessExecSetSubcommandSpec | undefined {
  if (!subcommand) return undefined;
  return SET_SUBCOMMAND_SPECS.find((spec) => spec.subcommand === subcommand);
}

function assertArity(args: string[], spec: Pick<HeadlessExecCommandSpec, 'minArgs' | 'maxArgs' | 'usage'>): void {
  if (args.length < spec.minArgs) {
    throw new Error(`Missing arguments. Usage: --headless ${spec.usage}`);
  }
  if (spec.maxArgs !== undefined && args.length > spec.maxArgs) {
    throw new Error(`Unexpected arguments. Usage: --headless ${spec.usage}`);
  }
}

function resolveSpecWorkflowId(
  args: string[],
  spec: Pick<HeadlessExecCommandSpec, 'priority' | 'targetIndex' | 'targetKind' | 'usage'>,
  lookup: HeadlessTargetLookup,
  strictQueueAdmission: boolean,
): HeadlessExecClassification {
  const targetArg = args[spec.targetIndex];
  const workflowId = strictQueueAdmission
    ? resolveExistingQueueTarget(targetArg, spec.targetKind, lookup)
    : resolveLooseQueueTarget(targetArg, spec.targetKind, lookup);
  if (strictQueueAdmission && !workflowId) {
    throw new Error(`Could not resolve existing ${spec.targetKind} target for headless.exec queue admission: "${String(targetArg ?? '')}"`);
  }
  return { workflowId, priority: spec.priority };
}

function classifySetHeadlessExecMutation(
  args: string[],
  lookup: HeadlessTargetLookup,
  strictQueueAdmission: boolean,
): HeadlessExecClassification {
  const subcommand = args[1];
  const spec = findSetSubcommandSpec(subcommand);
  if (!spec) {
    if (strictQueueAdmission) {
      throw new Error(`Unsupported no-track headless.exec set sub-command: ${subcommand ?? '<missing>'}`);
    }
    return { priority: 'normal' };
  }

  if (strictQueueAdmission) {
    assertArity(args, spec);
    spec.validate?.(args);
  } else if (args.length < spec.minArgs) {
    return { priority: spec.priority };
  }

  return resolveSpecWorkflowId(args, spec, lookup, strictQueueAdmission);
}

export function resolveHeadlessTarget(
  targetArg: unknown,
  lookup: HeadlessTargetLookup,
): HeadlessTargetResolution {
  const target = String(targetArg ?? '');
  if (!target) {
    return { kind: 'unknown', target: '' };
  }

  if (looksLikeWorkflowId(target)) {
    return { kind: 'workflow', workflowId: target };
  }

  const workflowIdFromTaskTarget = parseWorkflowIdFromTaskTarget(target);
  if (workflowIdFromTaskTarget) {
    return {
      kind: 'task',
      workflowId: workflowIdFromTaskTarget,
      taskId: target,
      resolvedTaskId: target,
    };
  }

  const workflow = lookup.loadWorkflow(target);
  if (workflow) {
    return { kind: 'workflow', workflowId: workflow.id };
  }

  const storedTask = findStoredTaskByTarget(lookup, target);
  if (storedTask) {
    return {
      kind: 'task',
      workflowId: storedTask.workflowId,
      taskId: target,
      resolvedTaskId: storedTask.task.id,
    };
  }

  return { kind: 'unknown', target };
}

export function resolveHeadlessTargetWorkflowId(
  targetArg: unknown,
  lookup: HeadlessTargetLookup,
): string {
  const resolved = resolveHeadlessTarget(targetArg, lookup);
  if (resolved.kind === 'workflow' || resolved.kind === 'task') {
    return resolved.workflowId;
  }
  const renderedTarget = resolved.target || String(targetArg ?? '');
  throw new Error(`Could not resolve headless target workflow for "${renderedTarget}"`);
}

export function classifyHeadlessExecMutation(
  payload: HeadlessExecMutationPayload,
  lookup: HeadlessTargetLookup,
  options: { strictQueueAdmission?: boolean } = {},
): HeadlessExecClassification {
  const strictQueueAdmission = options.strictQueueAdmission ?? Boolean(payload.noTrack);
  const args = payload.args;
  const command = args[0];
  if (!command) {
    if (strictQueueAdmission) {
      throw new Error('Missing delegated headless command arguments');
    }
    return { priority: 'normal' };
  }

  if (command === 'set') {
    return classifySetHeadlessExecMutation(args, lookup, strictQueueAdmission);
  }

  const spec = findCommandSpec(command);
  if (!spec) {
    if (strictQueueAdmission) {
      throw new Error(`Unsupported no-track headless.exec command: ${command}`);
    }
    return { priority: 'normal' };
  }

  if (strictQueueAdmission) {
    assertArity(args, spec);
    spec.validate?.(args);
  } else if (args.length < spec.minArgs) {
    return { priority: spec.priority };
  }

  return resolveSpecWorkflowId(args, spec, lookup, strictQueueAdmission);
}

export function isHeadlessReadOnlyCommand(args: string[]): boolean {
  const command = args[0];
  if (!command || command === '--help' || command === '-h') return true;
  return findHeadlessCommandDefinition(command)?.kind === 'read';
}

export function isHeadlessMutatingCommand(args: string[]): boolean {
  const command = args[0];
  if (!command || command === '--help' || command === '-h') return false;

  if (command === 'set') {
    return isMutatingSetSubcommand(args[1]);
  }

  return findHeadlessCommandDefinition(command)?.kind === 'write';
}
