import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => false,
    })),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

import { createMainWindow, registerSecondInstanceFocus } from './window-lifecycle.js';

class FakeWebContents {
  handlers = new Map<string, (...args: any[]) => void>();
  windowOpenHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
  sent: Array<{ channel: string; data: unknown[] }> = [];

  on(channel: string, handler: (...args: any[]) => void): void {
    this.handlers.set(channel, handler);
  }

  setWindowOpenHandler(handler: (details: { url: string }) => { action: 'deny' }): void {
    this.windowOpenHandler = handler;
  }

  send(channel: string, ...data: unknown[]): void {
    this.sent.push({ channel, data });
  }
}

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = [];
  webContents = new FakeWebContents();
  eventHandlers = new Map<string, () => void>();
  onceHandlers = new Map<string, () => void>();
  loadURL = vi.fn();
  loadFile = vi.fn(() => Promise.resolve());
  setIcon = vi.fn();
  show = vi.fn();
  focus = vi.fn();
  restore = vi.fn();
  minimized = false;
  destroyed = false;

  constructor(public options: Record<string, unknown>) {
    FakeBrowserWindow.instances.push(this);
  }

  on(channel: string, handler: () => void): void {
    this.eventHandlers.set(channel, handler);
  }

  once(channel: string, handler: () => void): void {
    this.onceHandlers.set(channel, handler);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  isMinimized(): boolean {
    return this.minimized;
  }
}

describe('window lifecycle wiring', () => {
  beforeEach(() => {
    FakeBrowserWindow.instances.length = 0;
    vi.clearAllMocks();
  });

  it('focuses the existing window for second-instance events', () => {
    let secondInstanceHandler: (() => void) | undefined;
    const app = {
      on: vi.fn((channel: string, handler: () => void) => {
        if (channel === 'second-instance') secondInstanceHandler = handler;
      }),
    };
    const mainWindow = new FakeBrowserWindow({});
    mainWindow.minimized = true;

    registerSecondInstanceFocus(app as any, () => mainWindow as any);
    secondInstanceHandler?.();

    expect(mainWindow.restore).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
  });

  it('preserves test-mode BrowserWindow startup and close callbacks', () => {
    const recordStartupMark = vi.fn();
    const onUiInteractive = vi.fn();
    const onClosed = vi.fn();

    const mainWindow = createMainWindow({
      browserWindow: FakeBrowserWindow as any,
      dirname: '/repo/packages/app/dist',
      env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv,
      platform: 'linux',
      logger: { info: vi.fn(), error: vi.fn() } as any,
      enableTestCompositor: false,
      recordStartupMark,
      onUiInteractive,
      onClosed,
    }) as unknown as FakeBrowserWindow;

    expect(mainWindow.options).toMatchObject({
      width: 1200,
      height: 800,
      show: false,
      title: 'Invoker',
    });
    expect(mainWindow.loadFile).toHaveBeenCalledWith('/repo/packages/ui/dist/index.html');
    expect(recordStartupMark).toHaveBeenCalledWith('createWindow.begin');
    expect(onUiInteractive).toHaveBeenCalledOnce();

    mainWindow.eventHandlers.get('closed')?.();
    expect(onClosed).toHaveBeenCalledOnce();
  });
});
