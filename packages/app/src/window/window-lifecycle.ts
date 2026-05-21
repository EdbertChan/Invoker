import { BrowserWindow, nativeImage, shell, type App } from 'electron';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from '@invoker/contracts';
import type { InvokerConfig } from '../config.js';

export interface MainWindowCreationOptions {
  dirname: string;
  platform: NodeJS.Platform;
  nodeEnv: string | undefined;
  enableTestCompositor: boolean;
  invokerConfig: InvokerConfig;
  logger: Logger;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  setMainWindow: (window: BrowserWindow | null) => void;
  setUiInteractive: (interactive: boolean) => void;
  startDeferredStartupWork: () => void;
}

export function createInvokerMainWindow({
  dirname,
  platform,
  nodeEnv,
  enableTestCompositor,
  invokerConfig,
  logger,
  recordStartupMark,
  setMainWindow,
  setUiInteractive,
  startDeferredStartupWork,
}: MainWindowCreationOptions): BrowserWindow {
  recordStartupMark('createWindow.begin');
  const iconPath = path.join(dirname, 'assets', 'icons', 'png', '256x256.png');
  const icon = nativeImage.createFromPath(iconPath);
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    webPreferences: {
      preload: path.join(dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: !icon.isEmpty() && platform !== 'darwin' ? icon : undefined,
    title: 'Invoker',
  });
  setMainWindow(mainWindow);

  if (platform !== 'darwin') {
    if (!icon.isEmpty()) mainWindow.setIcon(icon);
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const packagedUiPath = path.join(dirname, 'ui', 'index.html');
    const repoUiPath = path.join(dirname, '..', '..', 'ui', 'dist', 'index.html');
    const uiDistPath = existsSync(packagedUiPath) ? packagedUiPath : repoUiPath;
    mainWindow.loadFile(uiDistPath).catch(() => {
      mainWindow.loadURL(
        'data:text/html,<html><body style="background:#1a1a2e;color:#eee;font-family:system-ui;padding:2rem"><h1>Invoker</h1><p>UI not built yet. Run: <code>pnpm --filter @invoker/ui build</code></p></body></html>',
      );
    });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('main window did-finish-load', { module: 'window' });
    recordStartupMark('window.did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    logger.error(
      `main window did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}`,
      { module: 'window' },
    );
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logger.error(
      `main window render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`,
      { module: 'window' },
    );
  });

  const shouldShowWindow = nodeEnv !== 'test' || enableTestCompositor;
  if (shouldShowWindow) {
    let showTriggered = false;
    const showWindow = (): void => {
      if (mainWindow.isDestroyed() || showTriggered) return;
      showTriggered = true;
      logger.info('main window show()', { module: 'window' });
      recordStartupMark('window.show');
      mainWindow.show();
      mainWindow.focus();
      setUiInteractive(true);
      recordStartupMark('ui.interactive');
      startDeferredStartupWork();
    };

    mainWindow.once('ready-to-show', showWindow);
    setTimeout(showWindow, 1500).unref?.();
  } else {
    setUiInteractive(true);
    recordStartupMark('ui.interactive');
    startDeferredStartupWork();
  }

  mainWindow.on('closed', () => {
    logger.info('main window closed', { module: 'window' });
    setMainWindow(null);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      const browserCmd = invokerConfig.browser;
      if (browserCmd) {
        spawn(browserCmd, [url], { detached: true, stdio: 'ignore' }).unref();
      } else {
        const chromeCmd: [string, string[]] = platform === 'darwin'
          ? ['open', ['-a', 'Google Chrome', url]]
          : platform === 'win32'
            ? ['cmd', ['/c', 'start', 'chrome', url]]
            : ['google-chrome', [url]];
        try {
          spawn(chromeCmd[0], chromeCmd[1], { detached: true, stdio: 'ignore' }).unref();
        } catch {
          shell.openExternal(url);
        }
      }
    }
    return { action: 'deny' as const };
  });

  return mainWindow;
}

export interface WindowLifecycleOptions {
  app: App;
  platform: NodeJS.Platform;
  logger: Logger;
  getMainWindow: () => BrowserWindow | null;
  createWindow: () => void;
}

export function registerMainWindowLifecycle({
  app,
  platform,
  logger,
  getMainWindow,
  createWindow,
}: WindowLifecycleOptions): void {
  app.on('second-instance', () => {
    const mainWindow = getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    logger.info('window-all-closed', { module: 'window' });
    if (platform !== 'darwin') {
      app.quit();
    }
  });
}
