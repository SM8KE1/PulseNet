import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const devUrl = process.env.TAURI_DEV_URL ?? 'http://127.0.0.1:5173';

async function probeVite() {
  try {
  const response = await fetch(devUrl, { signal: AbortSignal.timeout(1200) });
  const html = await response.text();
    return {
      available: true,
      isPulseNet: response.ok
        && html.includes('<title>PulseNet</title>')
        && html.includes('/src/renderer/main.jsx')
        && html.includes('/@vite/client'),
    };
  } catch {
    return { available: false, isPulseNet: false };
  }
}

const currentServer = await probeVite();
if (currentServer.isPulseNet) {
  console.log(`Reusing the existing PulseNet Vite server at ${devUrl}`);
  process.exit(0);
}
if (currentServer.available) {
  console.error(`Port ${new URL(devUrl).port} is serving another app. Stop it or configure the same free port in TAURI_DEV_URL and src-tauri/tauri.conf.json.`);
  process.exit(1);
}

const vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', new URL(devUrl).port || '80', '--strictPort'], {
  cwd: projectRoot,
  stdio: 'inherit',
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => vite.kill(signal));
}

vite.on('error', (error) => {
  console.error(`Could not start Vite: ${error.message}`);
  process.exitCode = 1;
});
vite.on('exit', (code, signal) => {
  if (!signal && code === 0) {
    process.exitCode = 0;
    return;
  }
  // Two `tauri dev` invocations can race before either Vite server is ready.
  // If the other process won the port and is serving this project, treat that as success.
  setTimeout(async () => {
    const winner = await probeVite();
    if (winner.isPulseNet) {
      console.log(`Reusing the PulseNet Vite server that won the startup race at ${devUrl}`);
      process.exitCode = 0;
      return;
    }
    if (winner.available) {
      console.error(`Port ${new URL(devUrl).port} is serving another app. Stop it or configure the same free port in TAURI_DEV_URL and src-tauri/tauri.conf.json.`);
    }
    process.exitCode = signal ? 1 : (code ?? 1);
  }, 300);
});
