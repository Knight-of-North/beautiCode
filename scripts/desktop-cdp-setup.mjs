#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNNER = path.join(REPO, 'scripts', 'desktop-cdp-runner.mjs');

function parseArgs(argv) {
  const out = { command: 'install', host: '' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === 'install' || arg === 'status' || arg === 'uninstall') out.command = arg;
    else if (arg === '--host') out.host = String(argv[++i] || '').toLowerCase();
    else if (arg.startsWith('--host=')) out.host = arg.slice(7).toLowerCase();
  }
  if (out.host !== 'cursor' && out.host !== 'doubao') {
    throw new Error('用法：node desktop-cdp-setup.mjs --host cursor|doubao install|status|uninstall');
  }
  return out;
}

if (process.platform !== 'win32') throw new Error('Cursor/豆包背景守护当前仅支持 Windows。');
const args = parseArgs(process.argv.slice(2));
const dataDir = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'beauticode', 'hosts', args.host);
const pidFile = path.join(dataDir, 'runner.pid');
const logFile = path.join(dataDir, 'runner.log');
const startupDir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
const startupVbs = path.join(startupDir, `beauticode-${args.host}-runner.vbs`);
const quoteVbs = (value) => `"${String(value).replaceAll('"', '""')}"`;
const runnerArgs = [RUNNER, '--host', args.host, '--watchdog', '--pid-file', pidFile];

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  const result = spawnSync('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  return result.status === 0 && String(result.stdout).includes(`"${pid}"`);
}

function readPid() {
  try { return Number(fs.readFileSync(pidFile, 'utf8').trim()); } catch { return 0; }
}

function stopRunner() {
  const pid = readPid();
  if (pidAlive(pid)) spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  try { fs.unlinkSync(pidFile); } catch {}
}

function cleanPage() {
  spawnSync(process.execPath, [RUNNER, '--host', args.host, '--clean', '--no-repair'], {
    cwd: REPO, windowsHide: true, timeout: 10_000, stdio: 'ignore',
  });
}

async function readCdpStatus() {
  try {
    const shared = await import(pathToFileURL(path.join(REPO, 'packages', 'adapter-desktop-cdp', 'dist', 'index.js')).href);
    const adapter = await import(pathToFileURL(path.join(REPO, 'packages', `adapter-${args.host}`, 'dist', 'index.js')).href);
    const spec = args.host === 'cursor' ? adapter.CURSOR_CDP_SPEC : adapter.DOUBAO_CDP_SPEC;
    const endpoint = await shared.discoverDesktopCdp(spec);
    return endpoint
      ? { connected: true, port: endpoint.port, target: shared.safeTargetLabel(endpoint.target.url) }
      : { connected: false, port: null, target: null };
  } catch {
    return { connected: false, port: null, target: null };
  }
}

if (args.command === 'status') {
  const pid = readPid();
  process.stdout.write(JSON.stringify({
    host: args.host,
    installed: fs.existsSync(startupVbs),
    running: pidAlive(pid),
    pid: pidAlive(pid) ? pid : null,
    cdp: await readCdpStatus(),
    startup: startupVbs,
    state: path.join(dataDir, 'state.json'),
  }, null, 2) + '\n');
  process.exit(0);
}

if (args.command === 'uninstall') {
  stopRunner();
  cleanPage();
  try { fs.unlinkSync(startupVbs); } catch {}
  process.stdout.write(`${args.host} 背景守护已卸载；独立主题状态保留在 ${dataDir}\n`);
  process.exit(0);
}

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(startupDir, { recursive: true });
if (fs.existsSync(path.join(REPO, 'package-lock.json'))) {
  const compiler = path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc');
  for (const packageName of ['core', 'adapter-desktop-cdp', `adapter-${args.host}`]) {
    const config = path.join(REPO, 'packages', packageName, 'tsconfig.json');
    const result = spawnSync(process.execPath, [compiler, '-p', config], { cwd: REPO, encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error((result.stderr || result.stdout || `${packageName} build failed`).slice(-2000));
  }
}
stopRunner();
const commandLine = [process.execPath, ...runnerArgs].map((part) => `"${part}"`).join(' ');
const vbs = `CreateObject("WScript.Shell").Run ${quoteVbs(commandLine)}, 0, False\r\n`;
fs.writeFileSync(startupVbs, vbs, 'utf8');
const fd = fs.openSync(logFile, 'a');
const child = spawn(process.execPath, runnerArgs, {
  cwd: REPO, detached: true, windowsHide: true, stdio: ['ignore', fd, fd],
});
child.unref();
fs.closeSync(fd);
process.stdout.write(`${args.host} 背景守护已安装并启动（PID ${child.pid}）。\n`);
