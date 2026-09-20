import { app, BrowserWindow, safeStorage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopRuntime } from './desktop-runtime.js';
import { SecureCredentialStore } from './credentials.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { FileSessionStore } from './session-store.js';

function forwardGoogleCallback(url: string): void {
  try {
    const parsed = new URL(url);
    const code = parsed.searchParams.get('code');
    if (!code) return;
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send('auth.google-callback', code);
  } catch {
    // Ignore unrelated protocol arguments; no credential material is logged.
  }
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', (_event, commandLine) => {
    const callback = commandLine.find((argument) => argument.startsWith('astra://'));
    if (callback) forwardGoogleCallback(callback);
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    forwardGoogleCallback(url);
  });
  app.setAsDefaultProtocolClient('astra');
}

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFile);

async function createWindow(): Promise<void> {
  const runtime = new DesktopRuntime(
    undefined,
    new SecureCredentialStore({ userDataPath: app.getPath('userData'), safeStorage }),
    new FileSessionStore(app.getPath('userData')),
  );
  await registerIpcHandlers(runtime);
  const window = new BrowserWindow({
    title: 'Astra AI',
    width: 1440,
    height: 920,
    minWidth: 1000,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(currentDirectory, 'preload.cjs'),
    },
  });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) await window.loadURL(devServerUrl);
  else await window.loadFile(join(currentDirectory, '../renderer/index.html'));
}

if (singleInstance) void app.whenReady().then(() => createWindow());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
