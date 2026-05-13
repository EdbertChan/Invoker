import type { HeadlessDeps } from './headless.js';

export interface HeadlessQueryListHandlers {
  query: (args: string[], deps: HeadlessDeps) => Promise<void>;
  warnDeprecated: (oldCmd: string, newCmd: string) => void;
}

export async function handleHeadlessQueryListCommand(
  args: string[],
  deps: HeadlessDeps,
  handlers: HeadlessQueryListHandlers,
): Promise<boolean> {
  const command = args[0];
  switch (command) {
    case 'query':
      await handlers.query(args.slice(1), deps);
      return true;
    case 'list':
      handlers.warnDeprecated('list', 'query workflows');
      await handlers.query(['workflows', ...args.slice(1)], deps);
      return true;
    case 'status':
      handlers.warnDeprecated('status', 'query tasks');
      await handlers.query(['tasks', ...args.slice(1)], deps);
      return true;
    case 'task-status':
      handlers.warnDeprecated('task-status', 'query task');
      await handlers.query(['task', ...args.slice(1)], deps);
      return true;
    case 'queue':
      handlers.warnDeprecated('queue', 'query queue');
      await handlers.query(['queue', ...args.slice(1)], deps);
      return true;
    case 'audit':
      handlers.warnDeprecated('audit', 'query audit');
      await handlers.query(['audit', ...args.slice(1)], deps);
      return true;
    case 'session':
      handlers.warnDeprecated('session', 'query session');
      await handlers.query(['session', ...args.slice(1)], deps);
      return true;
    default:
      return false;
  }
}
