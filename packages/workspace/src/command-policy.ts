import { win32 } from 'node:path';

export type CommandRisk = 'safe' | 'sensitive' | 'destructive' | 'prohibited';

export interface CommandRequest {
  executable: string;
  args: string[];
  cwdRelative: string;
  approved?: boolean;
}

const safeExecutables = new Set([
  'node',
  'npm',
  'npx',
  'pnpm',
  'yarn',
  'python',
  'pytest',
  'cargo',
  'dotnet',
]);
const prohibitedExecutables = new Set([
  'format',
  'format.com',
  'shutdown',
  'shutdown.exe',
  'reg',
  'reg.exe',
  'rmdir',
  'del',
  'rm',
  'diskpart',
  'diskpart.exe',
]);
const destructiveCommandPattern =
  /\b(rm|rmdir|del|erase|format(?:\.com)?|shutdown(?:\.exe)?|reg(?:\.exe)?)\b/i;
const credentialAccessPattern =
  /(?:^|[\\/\s._-])(?:\.env(?:\.[\w-]+)?|id_rsa|id_dsa|known_hosts|credentials?|passwords?|tokens?|secrets?)\b/i;
const powershellCredentialPattern =
  /\b(?:get-credential|get-secret|convertto-securestring|cmdkey|vaultcmd)\b/i;
const powershellDestructivePattern =
  /\b(?:remove-item|clear-content|stop-computer|restart-computer|format-volume|set-itemproperty|new-itemproperty)\b/i;
const credentialDumpingPattern =
  /\b(?:mimikatz|sekurlsa|lsadump|pypykatz|nanodump|procdump|comsvcs\.dll)\b/i;

function isWindowsPath(value: string): boolean {
  return (
    win32.isAbsolute(value) ||
    /^[a-zA-Z]:/.test(value) ||
    value.startsWith('\\\\') ||
    value.startsWith('\\\\?\\') ||
    value.startsWith('\\\\.\\')
  );
}

function containsTraversal(value: string): boolean {
  return value.split(/[\\/]+/).includes('..');
}

export function classifyCommand(request: CommandRequest): CommandRisk {
  if (isWindowsPath(request.executable) || containsTraversal(request.executable))
    return 'prohibited';
  const executable = win32.basename(request.executable).toLowerCase();
  const commandText = [executable, ...request.args].join(' ').toLowerCase();
  if (prohibitedExecutables.has(executable)) return 'prohibited';
  if (
    executable === 'git' &&
    (commandText.includes('reset --hard') || commandText.includes('clean -'))
  )
    return 'prohibited';
  if (destructiveCommandPattern.test(commandText)) return 'prohibited';
  if (credentialDumpingPattern.test(commandText)) return 'prohibited';
  if (
    (executable === 'powershell' ||
      executable === 'powershell.exe' ||
      executable === 'pwsh' ||
      executable === 'pwsh.exe') &&
    /(invoke-webrequest|\biwr\b|downloadstring|\biex\b|invoke-expression|curl\s+https?:)/i.test(
      commandText,
    )
  ) {
    return 'prohibited';
  }
  if (
    (executable === 'powershell' ||
      executable === 'powershell.exe' ||
      executable === 'pwsh' ||
      executable === 'pwsh.exe') &&
    (powershellDestructivePattern.test(commandText) ||
      powershellCredentialPattern.test(commandText))
  ) {
    return 'prohibited';
  }
  if (credentialAccessPattern.test(commandText)) return 'prohibited';
  if (isWindowsPath(request.cwdRelative) || request.cwdRelative.split(/[\\/]+/).includes('..'))
    return 'prohibited';
  if (request.args.some((arg) => isWindowsPath(arg) || containsTraversal(arg))) return 'prohibited';
  if (request.args.some((arg) => /[&|<>^()%!\r\n]/.test(arg))) return 'prohibited';
  if (executable === 'git') {
    return /\b(status|diff|rev-parse|ls-files|log)\b/.test(commandText) ? 'safe' : 'sensitive';
  }
  if (safeExecutables.has(executable)) {
    return /\b(install|publish|push|deploy|remove|uninstall)\b/.test(commandText)
      ? 'sensitive'
      : 'safe';
  }
  if (executable === 'cmd' || executable === 'cmd.exe') return 'sensitive';
  return 'sensitive';
}
