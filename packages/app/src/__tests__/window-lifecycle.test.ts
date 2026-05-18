import { describe, expect, it, vi } from 'vitest';
import {
  createMainWindowLifecycle,
  registerSecondInstanceWindowFocus,
} from '../window/window-lifecycle.js';

describe('window lifecycle extraction', () => {
  it('creates the main window and starts deferred work immediately in test mode', () => {
    let currentWindow: any = null;
    const window = makeWindow();
    const startDeferredStartupWork = vi.fn();
    const marks: string[] = [];

    createMainWindowLifecycle({
      dirname: '/app/dist',
      platform: 'linux',
      env: { NODE_ENV: 'test', VITE_DEV_SERVER_URL: 'http://localhost:5173' },
      enableTestCompositor: false,
      logger: makeLogger(),
      recordStartupMark: (phase) => marks.push(phase),
      startDeferredStartupWork,
      setUiInteractive: vi.fn(),
      setMainWindow: (nextWindow) => { currentWindow = nextWindow; },
      createBrowserWindow: vi.fn(() => window as any),
      createNativeImageFromPath: () => ({ isEmpty: () => true }),
      spawnDetached: vi.fn(),
      openExternal: vi.fn(),
    });

    expect(currentWindow).toBe(window);
    expect(window.loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(marks).toContain('createWindow.begin');
    expect(marks).toContain('ui.interactive');
    expect(startDeferredStartupWork).toHaveBeenCalledOnce();

    window.emit('closed');

    expect(currentWindow).toBeNull();
  });

  it('keeps second-instance focus behavior unchanged', () => {
    let secondInstanceHandler: (() => void) | undefined;
    const window = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      focus: vi.fn(),
    };

    registerSecondInstanceWindowFocus({
      app: {
        on: (_channel, listener) => { secondInstanceHandler = listener; },
      },
      getMainWindow: () => window as any,
    });

    secondInstanceHandler?.();

    expect(window.restore).toHaveBeenCalledOnce();
    expect(window.focus).toHaveBeenCalledOnce();
  });
});

function makeLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger as any;
}

function makeWindow() {
  const handlers = new Map<string, (...args: any[]) => void>();
  const onceHandlers = new Map<string, (...args: any[]) => void>();
  const window = {
    webContents: {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        handlers.set(`web:${event}`, handler);
      }),
      setWindowOpenHandler: vi.fn(),
    },
    loadURL: vi.fn(),
    loadFile: vi.fn(() => Promise.resolve()),
    setIcon: vi.fn(),
    isDestroyed: vi.fn(() => false),
    show: vi.fn(),
    focus: vi.fn(),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      handlers.set(event, handler);
    }),
    once: vi.fn((event: string, handler: (...args: any[]) => void) => {
      onceHandlers.set(event, handler);
    }),
    emit: (event: string, ...args: any[]) => {
      handlers.get(event)?.(...args);
      const onceHandler = onceHandlers.get(event);
      onceHandlers.delete(event);
      onceHandler?.(...args);
    },
  };
  return window;
}
