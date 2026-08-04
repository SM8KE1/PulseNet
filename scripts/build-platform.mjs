import { spawnSync } from 'node:child_process';
import { copyFileSync } from 'node:fs';

if (process.platform === 'win32') {
  const result = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'native/windows-firewall/build.ps1', '-Configuration', 'Release'],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  copyFileSync(
    'native/windows-firewall/out/Release/PulseNetNetworkControl.exe',
    'native/windows-firewall/out/Release/PulseNetNetworkControl-x86_64-pc-windows-msvc.exe',
  );
}

const tauriArguments = ['node_modules/@tauri-apps/cli/tauri.js', 'build'];
if (process.platform === 'win32') {
  tauriArguments.push('--config', JSON.stringify({
    bundle: {
      externalBin: ['../native/windows-firewall/out/Release/PulseNetNetworkControl'],
    },
  }));
}
const tauri = spawnSync(process.execPath, tauriArguments, {
  stdio: 'inherit',
});
if (tauri.error) throw tauri.error;
process.exit(tauri.status ?? 1);
