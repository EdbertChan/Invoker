import { BrowserWindow, nativeImage, shell, type App } from 'electron';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from '@invoker/contracts';

export interface MainWindowLifecycleDeps {
  dirname: string;
  enableTestCompositor: boolean;
  browserCommand?: string;
  logger: Logger;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  setUiInteractive: (interactive: boolean) => void;
  startDeferredStartupWork: () => void;
  onClosed: () => void;
}

export function createInvokerMainWindow(deps: MainWindowLifecycleDeps): BrowserWindow {
  deps.recordStartupMark('createWindow.begin');
  const iconPath = path.join(deps.dirname, 'assets', 'icons', 'png', '256x256.png');
  const icon = nativeImage.createFromPath(iconPath);
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Show explicitly after load/timeout; some Linux/X11 sessions have left
    // Electron's implicit initial map unmapped.
    show: false,
    webPreferences: {
      preload: path.join(deps.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: !icon.isEmpty() && process.platform !== 'darwin' ? icon : undefined,
    title: 'Invoker',
  });

  if (process.platform !== 'darwin' && !icon.isEmpty()) {
    mainWindow.setIcon(icon);
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const packagedUiPath = path.join(deps.dirname, 'ui', 'index.html');
    const repoUiPath = path.join(deps.dirname, '..', '..', 'ui', 'dist', 'index.html');
    const uiDistPath = existsSync(packagedUiPath) ? packagedUiPath : repoUiPath;
    mainWindow.loadFile(uiDistPath).catch(() => {
      if (mainWindow.isDestroyed()) return;
      mainWindow.loadURL(
        'data:text/html,<html><body style="background:#1a1a2e;color:#eee;font-family:system-ui;padding:2rem"><h1>Invoker</h1><p>UI not built yet. Run: <code>pnpm --filter @invoker/ui build</code></p></body></html>',
      );
    });
  }

  mainWindow.webContents.on('did-finish-load', () => {
    deps.logger.info('main window did-finish-load', { module: 'window' });
    deps.recordStartupMark('window.did-finish-load');
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    deps.logger.error(
      `main window did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}`,
      { module: 'window' },
    );
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    deps.logger.error(
      `main window render-process-gone: reason=${details.reason} exitCode=${details.exitCode}`,
      { module: 'window' },
    );
  });

  const shouldShowWindow = process.env.NODE_ENV !== 'test' || deps.enableTestCompositor;
  if (shouldShowWindow) {
    let showTriggered = false;
    const showWindow = (): void => {
      if (mainWindow.isDestroyed() || showTriggered) return;
      showTriggered = true;
      deps.logger.info('main window show()', { module: 'window' });
      deps.recordStartupMark('window.show');
      mainWindow.show();
      mainWindow.focus();
      deps.setUiInteractive(true);
      deps.recordStartupMark('ui.interactive');
      deps.startDeferredStartupWork();
    };

    mainWindow.once('ready-to-show', showWindow);
    setTimeout(showWindow, 1500).unref?.();
  } else {
    deps.setUiInteractive(true);
    deps.recordStartupMark('ui.interactive');
    deps.startDeferredStartupWork();
  }

  mainWindow.on('closed', () => {
    deps.logger.info('main window closed', { module: 'window' });
    deps.onClosed();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      openExternalUrl(url, deps.browserCommand);
    }
    return { action: 'deny' as const };
  });

  return mainWindow;
}

export function focusExistingMainWindow(mainWindow: BrowserWindow | null): void {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

export function registerMainWindowAppLifecycleHandlers(deps: {
  app: App;
  logger: Logger;
  getMainWindow: () => BrowserWindow | null;
  createWindow: () => void;
}): void {
  deps.app.on('second-instance', () => {
    focusExistingMainWindow(deps.getMainWindow());
  });

  deps.app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      deps.createWindow();
    }
  });

  deps.app.on('window-all-closed', () => {
    deps.logger.info('window-all-closed', { module: 'window' });
    if (process.platform !== 'darwin') {
      deps.app.quit();
    }
  });
}

function openExternalUrl(url: string, browserCommand?: string): void {
  if (browserCommand) {
    spawn(browserCommand, [url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  const chromeCmd: [string, string[]] = process.platform === 'darwin'
    ? ['open', ['-a', 'Google Chrome', url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', 'chrome', url]]
      : ['google-chrome', [url]];
  try {
    spawn(chromeCmd[0], chromeCmd[1], { detached: true, stdio: 'ignore' }).unref();
  } catch {
    shell.openExternal(url);
  }
}
