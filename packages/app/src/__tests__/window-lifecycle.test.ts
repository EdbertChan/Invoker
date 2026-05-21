import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const appHandlers = new Map<string, (...args: any[]) => void>();
  const browserWindowInstances: any[] = [];
  const shellOpenExternal = vi.fn();

  class MockBrowserWindow {
    static getAllWindows = vi.fn(() => browserWindowInstances);

    webContents = {
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };
    loadURL = vi.fn();
    loadFile = vi.fn(() => Promise.resolve());
    setIcon = vi.fn();
    once = vi.fn();
    on = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    restore = vi.fn();
    isDestroyed = vi.fn(() => false);
    isMinimized = vi.fn(() => false);
    options: Record<string, unknown>;

    constructor(options: Record<string, unknown>) {
      this.options = options;
      browserWindowInstances.push(this);
    }
  }

  return {
    appHandlers,
    browserWindowInstances,
    shellOpenExternal,
    MockBrowserWindow,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: mocks.MockBrowserWindow,
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => false })),
  },
  shell: {
    openExternal: mocks.shellOpenExternal,
  },
}));

import {
  createInvokerMainWindow,
  registerMainWindowLifecycle,
} from '../window/window-lifecycle.js';

function createApp() {
  return {
    on: vi.fn((event, handler) => {
      mocks.appHandlers.set(event, handler);
    }),
    quit: vi.fn(),
  };
}

function createWindowOptions(overrides: Record<string, unknown> = {}) {
  return {
    dirname: '/app/dist',
    platform: 'linux' as NodeJS.Platform,
    nodeEnv: 'test',
    enableTestCompositor: false,
    invokerConfig: {},
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
    recordStartupMark: vi.fn(),
    setMainWindow: vi.fn(),
    setUiInteractive: vi.fn(),
    startDeferredStartupWork: vi.fn(),
    ...overrides,
  };
}

describe('window lifecycle', () => {
  beforeEach(() => {
    mocks.appHandlers.clear();
    mocks.browserWindowInstances.length = 0;
    mocks.shellOpenExternal.mockClear();
    mocks.MockBrowserWindow.getAllWindows.mockReturnValue(mocks.browserWindowInstances);
    vi.clearAllMocks();
  });

  it('creates the main BrowserWindow and starts deferred work in hidden test mode', () => {
    const options = createWindowOptions();

    const window = createInvokerMainWindow(options as any);

    expect(window).toBe(mocks.browserWindowInstances[0]);
    expect(options.setMainWindow).toHaveBeenCalledWith(window);
    expect(options.setUiInteractive).toHaveBeenCalledWith(true);
    expect(options.startDeferredStartupWork).toHaveBeenCalled();
    expect(window.options).toMatchObject({
      width: 1200,
      height: 800,
      show: false,
      title: 'Invoker',
    });
    expect(window.webContents.setWindowOpenHandler).toHaveBeenCalled();
  });

  it('registers second-instance, activate, and window-all-closed behavior', () => {
    const app = createApp();
    const focusedWindow = new mocks.MockBrowserWindow({});
    focusedWindow.isMinimized.mockReturnValue(true);
    const createWindow = vi.fn();

    registerMainWindowLifecycle({
      app: app as any,
      platform: 'linux',
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any,
      getMainWindow: () => focusedWindow as any,
      createWindow,
    });

    mocks.appHandlers.get('second-instance')?.();
    expect(focusedWindow.restore).toHaveBeenCalled();
    expect(focusedWindow.focus).toHaveBeenCalled();

    mocks.MockBrowserWindow.getAllWindows.mockReturnValue([]);
    mocks.appHandlers.get('activate')?.();
    expect(createWindow).toHaveBeenCalled();

    mocks.appHandlers.get('window-all-closed')?.();
    expect(app.quit).toHaveBeenCalled();
  });
});
