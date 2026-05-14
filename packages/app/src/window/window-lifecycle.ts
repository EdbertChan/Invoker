import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { app, BrowserWindow, nativeImage, shell } from 'electron';
import type { Logger } from '@invoker/contracts';
import type { InvokerConfig } from '../config.js';

export interface MainWindowLifecycleDeps {
  getMainWindow: () => BrowserWindow | null;
  setMainWindow: (window: BrowserWindow | null) => void;
  logger: Logger;
  recordStartupMark: (name: string, data?: Record<string, unknown>) => void;
  startDeferredStartupWork: () => void;
  setUiInteractive: (interactive: boolean) => void;
  invokerConfig: Pick<InvokerConfig, 'browser'>;
  enableTestCompositor: boolean;
  dirname: string;
}

export interface MainWindowLifecycle {
  focusMainWindowForSecondInstance: () => void;
  createWindow: () => void;
  bindActivationHandler: () => void;
}

export function createMainWindowLifecycle(deps: MainWindowLifecycleDeps): MainWindowLifecycle {
  const focusMainWindowForSecondInstance = (): void => {
    const mainWindow = deps.getMainWindow();
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  };

  const createWindow = (): void => {
    deps.recordStartupMark('createWindow.begin');
    const iconPath = path.join(deps.dirname, 'assets', 'icons', 'png', '256x256.png');
    const icon = nativeImage.createFromPath(iconPath);
    const mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
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
    deps.setMainWindow(mainWindow);

    if (process.platform !== 'darwin') {
      if (!icon.isEmpty()) mainWindow.setIcon(icon);
    }

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      void mainWindow.loadURL(devUrl);
    } else {
      const packagedUiPath = path.join(deps.dirname, 'ui', 'index.html');
      const repoUiPath = path.join(deps.dirname, '..', '..', 'ui', 'dist', 'index.html');
      const uiDistPath = existsSync(packagedUiPath) ? packagedUiPath : repoUiPath;
      void mainWindow.loadFile(uiDistPath).catch(() => {
        void deps.getMainWindow()?.loadURL(
          `data:text/html,<html><body style="background:#1a1a2e;color:#eee;font-family:system-ui;padding:2rem"><h1>Invoker</h1><p>UI not built yet. Run: <code>pnpm --filter @invoker/ui build</code></p></body></html>`,
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
        const currentWindow = deps.getMainWindow();
        if (!currentWindow || currentWindow.isDestroyed() || showTriggered) return;
        showTriggered = true;
        deps.logger.info('main window show()', { module: 'window' });
        deps.recordStartupMark('window.show');
        currentWindow.show();
        currentWindow.focus();
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
      deps.setMainWindow(null);
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('https://') || url.startsWith('http://')) {
        const browserCmd = deps.invokerConfig.browser;
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
            void shell.openExternal(url);
          }
        }
      }
      return { action: 'deny' as const };
    });
  };

  const bindActivationHandler = (): void => {
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  };

  return {
    focusMainWindowForSecondInstance,
    createWindow,
    bindActivationHandler,
  };
}
