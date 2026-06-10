import { describe, expect, it, vi } from 'vitest';
import {
  createMainWindow,
  registerMainWindowActivateHandler,
  registerMainWindowSecondInstanceHandler,
} from '../window/window-lifecycle.js';

const electronMock = vi.hoisted(() => ({
  browserWindowInstances: [] as any[],
  getAllWindows: vi.fn(() => []),
  openExternal: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {
    static getAllWindows = electronMock.getAllWindows;

    options: unknown;
    webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    loadURL = vi.fn(async () => undefined);
    loadFile = vi.fn(async () => undefined);
    setIcon = vi.fn();
    isDestroyed = vi.fn(() => false);
    show = vi.fn();
    showInactive = vi.fn();
    focus = vi.fn();
    on = vi.fn();
    once = vi.fn();

    constructor(options: unknown) {
      this.options = options;
      electronMock.browserWindowInstances.push(this);
    }
  },
  nativeImage: {
    createFromPath: () => ({ isEmpty: () => true }),
  },
  shell: {
    openExternal: electronMock.openExternal,
  },
}));

describe('window-lifecycle', () => {
  it('creates the main BrowserWindow with the preserved show and lifecycle callbacks', () => {
    const previousDevServerUrl = process.env.VITE_DEV_SERVER_URL;
    process.env.VITE_DEV_SERVER_URL = 'http://localhost:5173';
    electronMock.browserWindowInstances.length = 0;

    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const recordStartupMark = vi.fn();
    const setUiInteractive = vi.fn();
    const startDeferredStartupWork = vi.fn();
    const setMainWindow = vi.fn();

    try {
      const mainWindow = createMainWindow({
        appRootDir: '/app/dist',
        invokerConfig: {},
        logger: logger as any,
        hideE2eWindow: false,
        enableTestCompositor: true,
        recordStartupMark,
        setUiInteractive,
        startDeferredStartupWork,
        setMainWindow,
      });
      const instance = electronMock.browserWindowInstances[0];

      expect(mainWindow).toBe(instance);
      expect(instance.options).toMatchObject({
        width: 1200,
        height: 800,
        show: false,
        title: 'Invoker',
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
      });
      expect(instance.loadURL).toHaveBeenCalledWith('http://localhost:5173');
      expect(setMainWindow).toHaveBeenCalledWith(instance);

      const readyToShow = instance.once.mock.calls.find(([eventName]: [string]) => eventName === 'ready-to-show')?.[1];
      readyToShow();
      expect(instance.show).toHaveBeenCalledTimes(1);
      expect(instance.focus).toHaveBeenCalledTimes(1);
      expect(setUiInteractive).toHaveBeenCalledWith(true);
      expect(startDeferredStartupWork).toHaveBeenCalledTimes(1);
      expect(recordStartupMark).toHaveBeenCalledWith('window.show');
      expect(recordStartupMark).toHaveBeenCalledWith('ui.interactive');

      const didFinishLoad = instance.webContents.on.mock.calls.find(([eventName]: [string]) => eventName === 'did-finish-load')?.[1];
      didFinishLoad();
      expect(logger.info).toHaveBeenCalledWith('main window did-finish-load', { module: 'window' });
      expect(recordStartupMark).toHaveBeenCalledWith('window.did-finish-load');

      const closed = instance.on.mock.calls.find(([eventName]: [string]) => eventName === 'closed')?.[1];
      closed();
      expect(setMainWindow).toHaveBeenCalledWith(null);
    } finally {
      if (previousDevServerUrl === undefined) {
        delete process.env.VITE_DEV_SERVER_URL;
      } else {
        process.env.VITE_DEV_SERVER_URL = previousDevServerUrl;
      }
    }
  });

  it('focuses the existing window on second-instance without changing the event name', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const window = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      focus: vi.fn(),
    };

    registerMainWindowSecondInstanceHandler({
      app: {
        on: (eventName: string, handler: (...args: unknown[]) => void) => {
          handlers.set(eventName, handler);
          return undefined as never;
        },
      },
      getMainWindow: () => window as any,
    });

    handlers.get('second-instance')?.();

    expect([...handlers.keys()]).toEqual(['second-instance']);
    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('recreates the main window on activate only when no BrowserWindow exists', () => {
    const handlers = new Map<string, (...args: unknown[]) => void>();
    const createWindow = vi.fn();
    const browserWindow = {
      getAllWindows: vi.fn(() => []),
    };

    registerMainWindowActivateHandler({
      app: {
        on: (eventName: string, handler: (...args: unknown[]) => void) => {
          handlers.set(eventName, handler);
          return undefined as never;
        },
      },
      createWindow,
      browserWindow,
    });

    handlers.get('activate')?.();
    expect(createWindow).toHaveBeenCalledTimes(1);

    browserWindow.getAllWindows.mockReturnValueOnce([{}]);
    handlers.get('activate')?.();
    expect(createWindow).toHaveBeenCalledTimes(1);
  });
});
