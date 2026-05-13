import { BrowserWindow, nativeImage, shell, type App } from 'electron';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import type { Logger } from '@invoker/contracts';
import type { InvokerConfig } from '../config.js';

export interface WindowLifecycleDeps {
  app: App;
  dirname: string;
  getLogger: () => Logger;
  invokerConfig: InvokerConfig;
  enableTestCompositor: boolean;
  getMainWindow: () => BrowserWindow | null;
  setMainWindow: (window: BrowserWindow | null) => void;
  setUiInteractive: (interactive: boolean) => void;
  recordStartupMark: (phase: string, extra?: Record<string, unknown>) => void;
  startDeferredStartupWork: () => void;
}

export interface WindowLifecycle {
  createWindow: () => void;
  registerSecondInstanceHandler: () => void;
  registerActivateHandler: () => void;
  registerWindowAllClosedHandler: () => void;
}

export function createWindowLifecycle(deps: WindowLifecycleDeps): WindowLifecycle {
  const createWindow = (): void => {
    deps.recordStartupMark('createWindow.begin');
    const iconPath = path.join(deps.dirname, 'assets', 'icons', 'png', '256x256.png');
    const icon = nativeImage.createFromPath(iconPath);
    const mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      // Show explicitly after load/timeout rather than relying on Electron's
      // implicit initial map behavior, which has regressed on some Linux/X11
      // sessions and leaves the BrowserWindow unmapped.
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

    // BrowserWindow icons matter on Windows/Linux. macOS uses the bundle icon.
    if (process.platform !== 'darwin') {
      if (!icon.isEmpty()) mainWindow.setIcon(icon);
    }

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      mainWindow.loadURL(devUrl);
    } else {
      const packagedUiPath = path.join(deps.dirname, 'ui', 'index.html');
      const repoUiPath = path.join(deps.dirname, '..', '..', 'ui', 'dist', 'index.html');
      const uiDistPath = existsSync(packagedUiPath) ? packagedUiPath : repoUiPath;
      mainWindow.loadFile(uiDistPath).catch(() => {
        deps.getMainWindow()?.loadURL(
          `data:text/html,<html><body style="background:#1a1a2e;color:#eee;font-family:system-ui;padding:2rem"><h1>Invoker</h1><p>UI not built yet. Run: <code>pnpm --filter @invoker/ui build</code></p></body></html>`,
        );
      });
    }

    mainWindow.webContents.on('did-finish-load', () => {
      deps.getLogger().info('main window did-finish-load', { module: 'window' });
      deps.recordStartupMark('window.did-finish-load');
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
      deps.getLogger().error(
        `main window did-fail-load: code=${errorCode} desc=${errorDescription} url=${validatedURL}`,
        { module: 'window' },
      );
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      deps.getLogger().error(
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
        deps.getLogger().info('main window show()', { module: 'window' });
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
      deps.getLogger().info('main window closed', { module: 'window' });
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
            shell.openExternal(url);
          }
        }
      }
      return { action: 'deny' as const };
    });
  };

  return {
    createWindow,
    registerSecondInstanceHandler: () => {
      deps.app.on('second-instance', () => {
        const mainWindow = deps.getMainWindow();
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
        }
      });
    },
    registerActivateHandler: () => {
      deps.app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createWindow();
        }
      });
    },
    registerWindowAllClosedHandler: () => {
      deps.app.on('window-all-closed', () => {
        deps.getLogger().info('window-all-closed', { module: 'window' });
        if (process.platform !== 'darwin') {
          deps.app.quit();
        }
      });
    },
  };
}
