import { beforeEach, describe, expect, it, vi } from 'vitest';

const appHandlers = new Map<string, (...args: any[]) => void>();
const windowInstances: any[] = [];

class FakeBrowserWindow {
  static getAllWindows = vi.fn(() => []);

  webContents = {
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  };
  setIcon = vi.fn();
  loadURL = vi.fn(() => Promise.resolve());
  loadFile = vi.fn(() => Promise.resolve());
  once = vi.fn();
  on = vi.fn((event: string, handler: (...args: any[]) => void) => {
    if (event === 'closed') this.closedHandler = handler;
  });
  show = vi.fn();
  focus = vi.fn();
  restore = vi.fn();
  isMinimized = vi.fn(() => false);
  isDestroyed = vi.fn(() => false);
  closedHandler?: () => void;

  constructor(public options: Record<string, unknown>) {
    windowInstances.push(this);
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeBrowserWindow,
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => true })),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

describe('window lifecycle extraction', () => {
  beforeEach(() => {
    appHandlers.clear();
    windowInstances.length = 0;
    FakeBrowserWindow.getAllWindows.mockReturnValue([]);
    process.env.NODE_ENV = 'test';
    delete process.env.VITE_DEV_SERVER_URL;
  });

  it('creates the main window and preserves lifecycle event behavior', async () => {
    let mainWindow: any = null;
    let uiInteractive = false;
    const marks: string[] = [];
    const startDeferredStartupWork = vi.fn();
    const app = {
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        appHandlers.set(event, handler);
      }),
      quit: vi.fn(),
    };

    const { createWindowLifecycle } = await import('../window/window-lifecycle.js');
    const lifecycle = createWindowLifecycle({
      app: app as any,
      dirname: '/app/dist',
      getLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(),
      } as any),
      invokerConfig: {} as any,
      enableTestCompositor: false,
      getMainWindow: () => mainWindow,
      setMainWindow: (window) => {
        mainWindow = window;
      },
      setUiInteractive: (interactive) => {
        uiInteractive = interactive;
      },
      recordStartupMark: (phase) => {
        marks.push(phase);
      },
      startDeferredStartupWork,
    });

    lifecycle.registerSecondInstanceHandler();
    lifecycle.registerActivateHandler();
    lifecycle.registerWindowAllClosedHandler();
    lifecycle.createWindow();

    expect(mainWindow).toBe(windowInstances[0]);
    expect(mainWindow.options).toMatchObject({
      width: 1200,
      height: 800,
      show: false,
      title: 'Invoker',
    });
    expect(mainWindow.loadFile).toHaveBeenCalledWith('/ui/dist/index.html');
    expect(uiInteractive).toBe(true);
    expect(startDeferredStartupWork).toHaveBeenCalledOnce();
    expect(marks).toEqual(['createWindow.begin', 'ui.interactive']);

    mainWindow.isMinimized.mockReturnValueOnce(true);
    appHandlers.get('second-instance')?.();
    expect(mainWindow.restore).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();

    FakeBrowserWindow.getAllWindows.mockReturnValueOnce([]);
    appHandlers.get('activate')?.();
    expect(windowInstances).toHaveLength(2);

    appHandlers.get('window-all-closed')?.();
    if (process.platform !== 'darwin') {
      expect(app.quit).toHaveBeenCalledOnce();
    }
  });
});
