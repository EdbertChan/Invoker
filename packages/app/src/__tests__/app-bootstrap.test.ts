import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadBootstrapWithMockApp(appMock: Record<string, unknown>) {
  vi.resetModules();
  vi.doMock('electron', () => ({ app: appMock }));
  return import('../bootstrap/app-bootstrap.js');
}

afterEach(() => {
  vi.doUnmock('electron');
  vi.resetModules();
});

describe('app bootstrap extraction', () => {
  it('starts headless mode only after Electron is ready', async () => {
    const calls: string[] = [];
    const appMock = {
      whenReady: vi.fn(() => {
        calls.push('whenReady');
        return Promise.resolve().then(() => calls.push('ready'));
      }),
      requestSingleInstanceLock: vi.fn(),
      quit: vi.fn(),
    };
    const { startAppBootstrap } = await loadBootstrapWithMockApp(appMock);
    const runHeadless = vi.fn(async () => {
      calls.push('runHeadless');
    });

    startAppBootstrap({
      isHeadless: true,
      runHeadless,
      setupGuiMode: vi.fn(),
      onFatalError: vi.fn(),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(['whenReady', 'ready', 'runHeadless']);
    expect(appMock.requestSingleInstanceLock).not.toHaveBeenCalled();
  });

  it('keeps GUI single-instance lock before setup in non-test mode', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const calls: string[] = [];
    const appMock = {
      requestSingleInstanceLock: vi.fn(() => {
        calls.push('lock');
        return true;
      }),
      quit: vi.fn(),
      whenReady: vi.fn(),
    };
    const { startAppBootstrap } = await loadBootstrapWithMockApp(appMock);

    try {
      startAppBootstrap({
        isHeadless: false,
        runHeadless: vi.fn(),
        setupGuiMode: () => calls.push('setupGuiMode'),
        onFatalError: vi.fn(),
      });
    } finally {
      process.env.NODE_ENV = previousNodeEnv;
    }

    expect(calls).toEqual(['lock', 'setupGuiMode']);
    expect(appMock.whenReady).not.toHaveBeenCalled();
  });
});
