// Starts the hub on this machine and opens it in the browser.
// Usage: npm run demo   (builds the UI and loads the importer output on first run)
// Data stays in data/hub.sqlite on this machine. Nothing is sent anywhere.
import { existsSync } from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8787);
const url = `http://127.0.0.1:${port}`;
const importDir = join(root, 'migration', 'output');
const dbPath = join(root, 'data', 'hub.sqlite');

function run(command) {
  console.log(`> ${command}`);
  execSync(command, { cwd: root, stdio: 'inherit' });
}

if (!existsSync(join(root, 'dist', 'index.html'))) run('npm run build');

if (!existsSync(dbPath)) {
  if (!existsSync(join(importDir, 'items.json'))) {
    console.error(`No importer output found in ${importDir}. Run tools/import-release76.mjs first.`);
    process.exit(1);
  }
  run(`node server/seed.mjs "${importDir}" --db "${dbPath}"`);
}

process.env.HUB_DEV_USER ??= process.env.USERNAME || 'local-user';
const server = spawn(process.execPath, [join(root, 'server', 'index.mjs')], {
  cwd: root,
  // Loopback only: without signed-in identity locally, anyone on the network could write as the local user.
  env: { ...process.env, PORT: String(port), HUB_HOST: '127.0.0.1', HUB_DB_PATH: dbPath },
  stdio: 'inherit',
});

setTimeout(() => {
  console.log(`Opening ${url}`);
  try {
    execSync(`cmd /c start "" "${url}"`, { stdio: 'ignore' });
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}, 1500);

process.on('SIGINT', () => server.kill('SIGINT'));
server.on('exit', (code) => process.exit(code ?? 0));
