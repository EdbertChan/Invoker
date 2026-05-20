import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadURL = vi.fn();
const loadFile = vi.fn(() => Promise.resolve());
const setIcon = vi.fn();
const show = vi.fn();
const focus = vi.fn();
const restore = vi.fn();
const once = vi.fn();
const on = vi.fn();
const setWindowOpenHandler = vi.fn();
const openExternal = vi.fn();
const appendSwitch = vi.fn();
const disableHardwareAcceleration = vi.fn();
const quit = vi.fn();
const browserWindows: any[] = [];

class MockBrowserWindow {
  static getAllWindows = vi.fn(() => browserWindows);

  webContents = {
    on,
    setWindowOpenHandler,
  };

  isDestroyed = vi.fn(() => false);
  isMinimized = vi.fn(() => false);
  loadURL = loadURL;
  loadFile = loadFile;
  setIcon = setIcon;
  show = show;
  focus = focus;
  restore = restore;
  once = once;
  on = on;

  constructor(public readonly options: Record<string, unknown>) {
    browserWindows.push(this);
  }
}

vi.mock('electron', () => ({
  BrowserWindow: MockBrowserWindow,
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => false })),
  },
  shell: { openExternal },
  app: {
    commandLine: { appendSwitch },
    disableHardwareAcceleration,
    quit,
  },
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
}));

describe('window lifecycle extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    browserWindows.length = 0;
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it('creates the main BrowserWindow with unchanged load and ready behavior', async () => {
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    const { createMainWindow } = await import('../window/window-lifecycle.js');
    let mainWindow: any = null;
    let uiInteractive = false;
    const recordStartupMark = vi.fn();
    const startDeferredStartupWork = vi.fn();

    const created = createMainWindow({
      dirname: '/app/dist',
      enableTestCompositor: true,
      invokerConfig: {} as any,
      logger: { info: vi.fn(), error: vi.fn() } as any,
      recordStartupMark,
      startDeferredStartupWork,
      getMainWindow: () => mainWindow,
      setMainWindow: (window) => { mainWindow = window; },
      setUiInteractive: (interactive) => { uiInteractive = interactive; },
    });

    expect(created).toBe(mainWindow);
    expect(created.options).toMatchObject({
      width: 1200,
      height: 800,
      show: false,
      title: 'Invoker',
      webPreferences: {
        preload: '/app/dist/preload.js',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    expect(loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(once).toHaveBeenCalledWith('ready-to-show', expect.any(Function));

    const readyToShow = once.mock.calls.find(([event]) => event === 'ready-to-show')?.[1] as () => void;
    readyToShow();
    expect(show).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();
    expect(uiInteractive).toBe(true);
    expect(recordStartupMark).toHaveBeenCalledWith('ui.interactive');
    expect(startDeferredStartupWork).toHaveBeenCalled();
  });

  it('focuses an existing main window and registers activate/window-all-closed behavior', async () => {
    const { focusMainWindow, registerWindowLifecycle } = await import('../window/window-lifecycle.js');
    const handlers = new Map<string, () => void>();
    const app = {
      on: vi.fn((event: string, handler: () => void) => {
        handlers.set(event, handler);
      }),
      quit,
    };
    const logger = { info: vi.fn() };
    const createWindow = vi.fn();
    const existingWindow = {
      isMinimized: vi.fn(() => true),
      restore,
      focus,
    };

    focusMainWindow(() => existingWindow as any);
    expect(restore).toHaveBeenCalled();
    expect(focus).toHaveBeenCalled();

    registerWindowLifecycle(app as any, logger as any, createWindow);
    browserWindows.length = 0;
    handlers.get('activate')?.();
    expect(createWindow).toHaveBeenCalled();

    handlers.get('window-all-closed')?.();
    if (process.platform !== 'darwin') {
      expect(quit).toHaveBeenCalled();
    }
  });
});
