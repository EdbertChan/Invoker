import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import type { Logger } from '@invoker/contracts';
import * as path from 'node:path';
import { existsSync } from 'node:fs';

interface NativeImageLike {
  isEmpty(): boolean;
}

export interface MainWindowLifecycleOptions {
  dirname: string;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  enableTestCompositor: boolean;
  browserCommand?: string;
  logger: Logger;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  startDeferredStartupWork: () => void;
  setUiInteractive: (interactive: boolean) => void;
  setMainWindow: (window: BrowserWindow | null) => void;
  createBrowserWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow;
  createNativeImageFromPath: (path: string) => NativeImageLike;
  spawnDetached: (command: string, args: string[]) => void;
  openExternal: (url: string) => void;
}

export function createMainWindowLifecycle(options: MainWindowLifecycleOptions): BrowserWindow {
  options.recordStartupMark('createWindow.begin');
  const iconPath = path.join(options.dirname, 'assets', 'icons', 'png', '256x256.png');
  const icon = options.createNativeImageFromPath(iconPath);
  const mainWindow = options.createBrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(options.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: !icon.isEmpty() && options.platform !== 'darwin' ? icon as BrowserWindowConstructorOptions['icon'] : undefined,
    title: 'Invoker',
  });
  options.setMainWindow(mainWindow);

  if (options.platform !== 'darwin' && !icon.isEmpty()) {
    mainWindow.setIcon(icon as Parameters<BrowserWindow['setIcon']>[0]);
  }

  const devUrl = options.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const packagedUiPath = path.join(options.dirname, 'ui', 'index.html');
    const repoUiPath = path.join(options.dirname, '..', '..', 'ui', 'dist', 'index.html');
    const uiDistPath = existsSync(packagedUiPath) ? packagedUiPath : repoUiPath;
    mainWindow.loadFile(uiDistPath).catch(() => {
      mainWindow.loadURL(
        'data:text/html,<html><body style="background:#1a1a2e;color:#eee;font-family:system-ui;padding:2rem"><h1>Invoker</h1><p>UI not built yet. Run: <code>pnpm --filter @invoker/ui build</code></p></body></html>',
      );
    });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    options.logger.info('main window did-finish-load', { module: 'window' });
    options.recordStartupMark('window.did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    options.logger.error(
      `main window did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}`,
      { module: 'window' },
    );
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    options.logger.error(
      `main window render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`,
      { module: 'window' },
    );
  });

  const shouldShowWindow = options.env.NODE_ENV !== 'test' || options.enableTestCompositor;
  if (shouldShowWindow) {
    let showTriggered = false;
    const showWindow = (): void => {
      if (mainWindow.isDestroyed() || showTriggered) return;
      showTriggered = true;
      options.logger.info('main window show()', { module: 'window' });
      options.recordStartupMark('window.show');
      mainWindow.show();
      mainWindow.focus();
      options.setUiInteractive(true);
      options.recordStartupMark('ui.interactive');
      options.startDeferredStartupWork();
    };

    mainWindow.once('ready-to-show', showWindow);
    setTimeout(showWindow, 1500).unref?.();
  } else {
    options.setUiInteractive(true);
    options.recordStartupMark('ui.interactive');
    options.startDeferredStartupWork();
  }

  mainWindow.on('closed', () => {
    options.logger.info('main window closed', { module: 'window' });
    options.setMainWindow(null);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      if (options.browserCommand) {
        options.spawnDetached(options.browserCommand, [url]);
      } else {
        const chromeCmd: [string, string[]] = options.platform === 'darwin'
          ? ['open', ['-a', 'Google Chrome', url]]
          : options.platform === 'win32'
            ? ['cmd', ['/c', 'start', 'chrome', url]]
            : ['google-chrome', [url]];
        try {
          options.spawnDetached(chromeCmd[0], chromeCmd[1]);
        } catch {
          options.openExternal(url);
        }
      }
    }
    return { action: 'deny' as const };
  });

  return mainWindow;
}

export interface SecondInstanceFocusOptions {
  app: { on(channel: 'second-instance', listener: () => void): void };
  getMainWindow: () => BrowserWindow | null;
}

export function registerSecondInstanceWindowFocus(options: SecondInstanceFocusOptions): void {
  options.app.on('second-instance', () => {
    const mainWindow = options.getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}
