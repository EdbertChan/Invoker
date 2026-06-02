import type { App, BrowserWindow } from 'electron';

export type GuiBootstrapMode = 'owner' | 'follower';

export interface InitializeGuiBootstrapOptions {
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  initOwnerServices: () => Promise<void>;
  initFollowerServices: () => Promise<void>;
  setOwnerMode: (ownerMode: boolean) => void;
  onFatalStartupError: (message: string) => void;
}

export async function initializeGuiBootstrap(
  options: InitializeGuiBootstrapOptions,
): Promise<GuiBootstrapMode | 'quit'> {
  const {
    recordStartupMark,
    initOwnerServices,
    initFollowerServices,
    setOwnerMode,
    onFatalStartupError,
  } = options;

  recordStartupMark('app.whenReady');
  setOwnerMode(true);
  try {
    recordStartupMark('initServices.start');
    await initOwnerServices();
    recordStartupMark('initServices.end', { ownerMode: true });
    return 'owner';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('[db-writer-lock]')) {
      onFatalStartupError(message);
      return 'quit';
    }
    recordStartupMark('initServices.readOnly.start');
    await initFollowerServices();
    setOwnerMode(false);
    recordStartupMark('initServices.readOnly.end', { ownerMode: false });
    return 'follower';
  }
}

export interface RegisterGuiActivateHandlerOptions {
  app: App;
  BrowserWindow: {
    getAllWindows: () => BrowserWindow[];
  };
  createWindow: () => void;
}

export function registerGuiActivateHandler(options: RegisterGuiActivateHandlerOptions): void {
  options.app.on('activate', () => {
    if (options.BrowserWindow.getAllWindows().length === 0) {
      options.createWindow();
    }
  });
}
