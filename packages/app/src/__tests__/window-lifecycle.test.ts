import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMainWindowLifecycle } from '../window/window-lifecycle.js';

const electronState = vi.hoisted(() => {
  const windows: any[] = [];
  const appListeners = new Map<string, (...args: any[]) => void>();

  class BrowserWindowMock {
    static getAllWindows = vi.fn(() => windows);

    options: unknown;
    destroyed = false;
    minimized = false;
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn(() => {
      this.minimized = false;
    });
    setIcon = vi.fn();
    loadURL = vi.fn(async () => {});
    loadFile = vi.fn(async () => {});
    onHandlers = new Map<string, (...args: any[]) => void>();
    onceHandlers = new Map<string, (...args: any[]) => void>();
    windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | null = null;
    webContents = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        this.onHandlers.set(event, handler);
      }),
      once: vi.fn((event: string, handler: (...args: any[]) => void) => {
        this.onceHandlers.set(event, handler);
      }),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: 'deny' }) => {
        this.windowOpenHandler = handler;
      }),
    };

    constructor(options: unknown) {
      this.options = options;
      windows.push(this);
    }

    on(event: string, handler: (...args: any[]) => void): void {
      this.onHandlers.set(event, handler);
    }

    isDestroyed(): boolean {
      return this.destroyed;
    }

    isMinimized(): boolean {
      return this.minimized;
    }
  }

  return {
    windows,
    appListeners,
    BrowserWindowMock,
    appOn: vi.fn((event: string, handler: (...args: any[]) => void) => {
      appListeners.set(event, handler);
    }),
    createFromPath: vi.fn(() => ({
      isEmpty: () => false,
    })),
    openExternal: vi.fn(async () => {}),
  };
});

vi.mock('electron', () => ({
  app: {
    on: electronState.appOn,
  },
  BrowserWindow: electronState.BrowserWindowMock,
  nativeImage: {
    createFromPath: electronState.createFromPath,
  },
  shell: {
    openExternal: electronState.openExternal,
  },
}));

describe('window-lifecycle', () => {
  beforeEach(() => {
    electronState.windows.length = 0;
    electronState.appListeners.clear();
    electronState.appOn.mockClear();
    electronState.createFromPath.mockClear();
    electronState.openExternal.mockClear();
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it('marks the UI interactive immediately in test mode without waiting to show the window', () => {
    const recordStartupMark = vi.fn();
    const startDeferredStartupWork = vi.fn();
    const setUiInteractive = vi.fn();
    let currentWindow: InstanceType<typeof electronState.BrowserWindowMock> | null = null;

    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => currentWindow as any,
      setMainWindow: (window) => {
        currentWindow = window as any;
      },
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      } as any,
      recordStartupMark,
      startDeferredStartupWork,
      setUiInteractive,
      invokerConfig: {},
      enableTestCompositor: false,
      dirname: '/tmp/app',
    });

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    lifecycle.createWindow();
    process.env.NODE_ENV = previousNodeEnv;

    expect(currentWindow).toBeTruthy();
    expect(setUiInteractive).toHaveBeenCalledWith(true);
    expect(startDeferredStartupWork).toHaveBeenCalledTimes(1);
    expect(recordStartupMark).toHaveBeenCalledWith('createWindow.begin');
    expect(recordStartupMark).toHaveBeenCalledWith('ui.interactive');
  });

  it('focuses and restores the existing window when a second instance is launched', () => {
    const window = new electronState.BrowserWindowMock({});
    window.minimized = true;

    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => window as any,
      setMainWindow: vi.fn(),
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      } as any,
      recordStartupMark: vi.fn(),
      startDeferredStartupWork: vi.fn(),
      setUiInteractive: vi.fn(),
      invokerConfig: {},
      enableTestCompositor: false,
      dirname: '/tmp/app',
    });

    lifecycle.focusMainWindowForSecondInstance();

    expect(window.restore).toHaveBeenCalledTimes(1);
    expect(window.focus).toHaveBeenCalledTimes(1);
  });

  it('binds activation to recreate the main window when no windows are open', () => {
    const setMainWindow = vi.fn();
    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => null,
      setMainWindow,
      logger: {
        info: vi.fn(),
        error: vi.fn(),
      } as any,
      recordStartupMark: vi.fn(),
      startDeferredStartupWork: vi.fn(),
      setUiInteractive: vi.fn(),
      invokerConfig: {},
      enableTestCompositor: false,
      dirname: '/tmp/app',
    });

    lifecycle.bindActivationHandler();
    electronState.windows.length = 0;
    electronState.appListeners.get('activate')?.();

    expect(setMainWindow).toHaveBeenCalledTimes(1);
  });
});
