import type { HeadlessDeps } from './headless.js';

export interface HeadlessRunResumeHandlers {
  run: (
    planPath: string,
    deps: HeadlessDeps,
    waitForApproval?: boolean,
    noTrack?: boolean,
  ) => Promise<void>;
  resume: (
    workflowId: string,
    deps: HeadlessDeps,
    waitForApproval?: boolean,
    noTrack?: boolean,
  ) => Promise<void>;
}

export async function handleHeadlessRunResumeCommand(
  args: string[],
  deps: HeadlessDeps,
  handlers: HeadlessRunResumeHandlers,
): Promise<boolean> {
  switch (args[0]) {
    case 'run':
      await handlers.run(args[1], deps, deps.waitForApproval, deps.noTrack);
      return true;
    case 'resume':
      await handlers.resume(args[1], deps, deps.waitForApproval, deps.noTrack);
      return true;
    default:
      return false;
  }
}
