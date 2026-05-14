import { BrowserWindow, nativeImage, shell } from 'electron';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from '@invoker/contracts';
import type { InvokerConfig } from '../config.js';

export interface ElectronAppWindowLifecycle {
  on(event: 'second-instance', listener: () => void): void;
}

export interface MainWindowLifecycleOptions {
  app: ElectronAppWindowLifecycle;
  dirname: string;
  enableTestCompositor: boolean;
  invokerConfig: InvokerConfig;
  logger: Logger;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  startDeferredStartupWork: () => void;
  setUiInteractive: (interactive: boolean) => void;
  setMainWindow: (window: BrowserWindow | null) => void;
  getMainWindow: () => BrowserWindow | null;
}

export function registerMainWindowLifecycle(options: MainWindowLifecycleOptions): {
  createWindow: () => void;
} {
  options.app.on('second-instance', () => {
    const mainWindow = options.getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  return {
    createWindow: () => createMainWindow(options),
  };
}

function createMainWindow(options: MainWindowLifecycleOptions): void {
  options.recordStartupMark('createWindow.begin');
  const iconPath = path.join(options.dirname, 'assets', 'icons', 'png', '256x256.png');
  const icon = nativeImage.createFromPath(iconPath);
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    // Show explicitly after load/timeout rather than relying on Electron's
    // implicit initial map behavior, which has regressed on some Linux/X11
    // sessions and leaves the BrowserWindow unmapped.
    show: false,
    webPreferences: {
      preload: path.join(options.dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: !icon.isEmpty() && process.platform !== 'darwin' ? icon : undefined,
    title: 'Invoker',
  });
  options.setMainWindow(mainWindow);

  // BrowserWindow icons matter on Windows/Linux. macOS uses the bundle icon.
  if (process.platform !== 'darwin') {
    if (!icon.isEmpty()) mainWindow.setIcon(icon);
  }

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    const packagedUiPath = path.join(options.dirname, 'ui', 'index.html');
    const repoUiPath = path.join(options.dirname, '..', '..', 'ui', 'dist', 'index.html');
    const uiDistPath = existsSync(packagedUiPath) ? packagedUiPath : repoUiPath;
    mainWindow.loadFile(uiDistPath).catch(() => {
      options.getMainWindow()?.loadURL(
        `data:text/html,<html><body style="background:#1a1a2e;color:#eee;font-family:system-ui;padding:2rem"><h1>Invoker</h1><p>UI not built yet. Run: <code>pnpm --filter @invoker/ui build</code></p></body></html>`,
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

  const makeUiInteractive = (): void => {
    options.setUiInteractive(true);
    options.recordStartupMark('ui.interactive');
    options.startDeferredStartupWork();
  };

  const shouldShowWindow = process.env.NODE_ENV !== 'test' || options.enableTestCompositor;
  if (shouldShowWindow) {
    let showTriggered = false;
    const showWindow = (): void => {
      const currentWindow = options.getMainWindow();
      if (!currentWindow || currentWindow.isDestroyed() || showTriggered) return;
      showTriggered = true;
      options.logger.info('main window show()', { module: 'window' });
      options.recordStartupMark('window.show');
      currentWindow.show();
      currentWindow.focus();
      makeUiInteractive();
    };

    mainWindow.once('ready-to-show', showWindow);
    setTimeout(showWindow, 1500).unref?.();
  } else {
    makeUiInteractive();
  }

  mainWindow.on('closed', () => {
    options.logger.info('main window closed', { module: 'window' });
    options.setMainWindow(null);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      const browserCmd = options.invokerConfig.browser;
      if (browserCmd) {
        spawn(browserCmd, [url], { detached: true, stdio: 'ignore' }).unref();
      } else {
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
    }
    return { action: 'deny' as const };
  });
}
