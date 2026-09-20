import { app, BrowserWindow, safeStorage } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DesktopRuntime } from './desktop-runtime.js';
import { SecureCredentialStore } from './credentials.js';
import { registerIpcHandlers } from './ipc-handlers.js';

const currentFile = fileURLToPath(import.meta.url);
const currentDirectory = dirname(currentFile);

async function createWindow(): Promise<void> {
  const runtime = new DesktopRuntime(
    undefined,
    new SecureCredentialStore({ userDataPath: app.getPath('userData'), safeStorage }),
  );
  await registerIpcHandlers(runtime);
  const window = new BrowserWindow({
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

void app.whenReady().then(() => createWindow());
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
