import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  nativeImage: {
    createFromPath: vi.fn(() => ({ isEmpty: () => true })),
  },
  shell: {
    openExternal: vi.fn(),
  },
}));

describe('window lifecycle extraction', () => {
  it('keeps second-instance focus behavior wired through the current main window', async () => {
    const { registerMainWindowLifecycle } = await import('../window/window-lifecycle.js');
    const listeners = new Map<string, () => void>();
    const mainWindow = {
      isMinimized: vi.fn(() => true),
      restore: vi.fn(),
      focus: vi.fn(),
    };

    registerMainWindowLifecycle({
      app: {
        on: (event, listener) => {
          listeners.set(event, listener);
        },
      },
      dirname: '/app/dist',
      enableTestCompositor: false,
      invokerConfig: {},
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn(),
      } as any,
      recordStartupMark: vi.fn(),
      startDeferredStartupWork: vi.fn(),
      setUiInteractive: vi.fn(),
      setMainWindow: vi.fn(),
      getMainWindow: () => mainWindow as any,
    });

    listeners.get('second-instance')?.();

    expect(mainWindow.isMinimized).toHaveBeenCalledOnce();
    expect(mainWindow.restore).toHaveBeenCalledOnce();
    expect(mainWindow.focus).toHaveBeenCalledOnce();
  });
});
