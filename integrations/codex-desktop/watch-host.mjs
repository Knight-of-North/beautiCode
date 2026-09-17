#!/usr/bin/env node
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const CDP_PORT = 9335;
const CDP_PORTS = Object.freeze([
  9335, 9222, 9223, 9229, 9230, 9240, 9250, 9300, 9310, 9320, 9340, 9350,
]);
const LOG = path.join(here, "watch.log");

function adapterHref() {
  const vendor = path.join(here, "vendor", "adapter-codex", "index.js");
  const workspace = path.join(here, "../../packages/adapter-codex/dist/index.js");
  const file = fs.existsSync(vendor) ? vendor : workspace;
  if (!fs.existsSync(file)) {
    throw new Error("找不到 @beauticode/adapter-codex。请先在仓库根目录运行 npm run build。");
  }
  return pathToFileURL(file).href;
}

function log(message) {
  try {
    const line = `${new Date().toISOString()} ${message}\n`;
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 256 * 1024) {
      fs.writeFileSync(LOG, line);
    } else {
      fs.appendFileSync(LOG, line);
    }
  } catch {
    /* ignore */
  }
}

async function cdpUp(port = CDP_PORT) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(450),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function anyCdpPort() {
  for (const port of CDP_PORTS) {
    if (await cdpUp(port)) return port;
  }
  return 0;
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function mainCodex() {
  if (process.platform !== "win32") return null;
  const ps = [
    "$ErrorActionPreference='SilentlyContinue';",
    "$cim = @(Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -eq 'ChatGPT.exe' -and",
    "  ($null -eq $_.CommandLine -or $_.CommandLine -notmatch '--type=')",
    "});",
    "if ($cim.Count -gt 0) {",
    "  $p = $cim[0];",
    "  $path = [string]$p.ExecutablePath;",
    "  if (-not $path -or $path -match '\\\\resources\\\\') {",
    "    $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;",
    "    if ($gp) { $path = [string]$gp.Path }",
    "  }",
    "  [pscustomobject]@{ ProcessId = [int]$p.ProcessId; ExecutablePath = $path; CommandLine = [string]$p.CommandLine } | ConvertTo-Json -Compress;",
    "  exit 0",
    "}",
    "$live = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Where-Object {",
    "  -not $_.Path -or $_.Path -notmatch '\\\\resources\\\\'",
    "});",
    "if ($live.Count -eq 0) { exit 0 }",
    "[pscustomobject]@{ ProcessId = [int]$live[0].Id; ExecutablePath = [string]$live[0].Path; CommandLine = '' } | ConvertTo-Json -Compress",
  ].join(" ");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { windowsHide: true, timeout: 8000 },
    );
    const text = String(stdout || "").trim();
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

let relaunching = false;
let nextRetryAt = 0;

async function waitForCdp(ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await anyCdpPort()) return true;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  return false;
}

/**
 * Store/AppX ChatGPT ignores Node spawn() args and often single-instance
 * activates an already-running window. Match the tray: force-kill the tree,
 * then ProcessStartInfo + UseShellExecute with CDP flags on a cold start.
 */
async function relaunchWithCdp(executablePath) {
  const script = [
    "$ErrorActionPreference='SilentlyContinue';",
    "Get-CimInstance Win32_Process | Where-Object {",
    "  $_.Name -eq 'ChatGPT.exe' -and",
    "  ($null -eq $_.CommandLine -or $_.CommandLine -notmatch '--type=')",
    "} | ForEach-Object { & taskkill.exe /PID $_.ProcessId /T /F | Out-Null };",
    "Get-Process -Name ChatGPT -ErrorAction SilentlyContinue |",
    "  Where-Object { -not $_.Path -or $_.Path -notmatch '\\\\resources\\\\' } |",
    "  Stop-Process -Force -ErrorAction SilentlyContinue;",
    "$deadline = (Get-Date).AddSeconds(12);",
    "do {",
    "  $left = @(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue |",
    "    Where-Object { -not $_.Path -or $_.Path -notmatch '\\\\resources\\\\' });",
    "  if ($left.Count -eq 0) { break };",
    "  Start-Sleep -Milliseconds 250;",
    "} while ((Get-Date) -lt $deadline);",
    `$exe = ${psQuote(executablePath)};`,
    `$port = ${CDP_PORT};`,
    "if (-not (Test-Path -LiteralPath $exe)) { throw 'Codex executable missing' };",
    "$psi = New-Object System.Diagnostics.ProcessStartInfo;",
    "$psi.FileName = $exe;",
    '$psi.Arguments = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=$port";',
    "$psi.WorkingDirectory = Split-Path -Parent $exe;",
    "$psi.UseShellExecute = $true;",
    "[void][System.Diagnostics.Process]::Start($psi);",
  ].join(" ");
  await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    { windowsHide: true, timeout: 28_000 },
  );
}

async function ensureCodexCdp() {
  if (relaunching || Date.now() < nextRetryAt) return;
  if (await anyCdpPort()) return;
  const proc = await mainCodex();
  if (!proc?.ProcessId) return;
  relaunching = true;
  try {
    if (await anyCdpPort()) return;
    const cmd = String(proc.CommandLine || "");
    const flagged = /remote-debugging-port/i.test(cmd);
    const unknownCmd = !cmd.trim();
    if (flagged || unknownCmd) {
      log(
        `chatgpt pid ${proc.ProcessId} ${flagged ? "already has debug flag" : "command line unknown"}; waiting for CDP`,
      );
      if (await waitForCdp(18_000)) {
        log(`cdp ready without relaunch`);
        nextRetryAt = Date.now() + 8_000;
        return;
      }
      log(`chatgpt pid ${proc.ProcessId} still has no CDP; relaunching once`);
    }
    const exe = String(proc.ExecutablePath || "").trim();
    if (!exe) {
      log(`chatgpt pid ${proc.ProcessId} has no executable path; cannot relaunch`);
      nextRetryAt = Date.now() + 12_000;
      return;
    }
    nextRetryAt = Date.now() + 30_000;
    log(`relaunch chatgpt pid ${proc.ProcessId} with CDP :${CDP_PORT}`);
    await relaunchWithCdp(exe);
    if (await waitForCdp(20_000)) {
      log(`cdp ready after relaunch`);
    } else {
      log(`cdp still down after relaunch`);
    }
  } catch (error) {
    nextRetryAt = Date.now() + 15_000;
    log(`relaunch failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    relaunching = false;
  }
}

const { BeautiSession } = await import(adapterHref());
const session = new BeautiSession({
  autoDiscover: true,
  deferHostConnect: true,
});

try {
  await session.start();
  log("watch started");
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/injector|lock|another/i.test(message)) {
    console.error("beautiCode 已在运行（托盘或其它注入进程）。本次 watch 退出。");
    process.exit(0);
  }
  throw error;
}

setInterval(() => {}, 60_000);
setInterval(() => {
  void ensureCodexCdp();
}, 2_000);
void ensureCodexCdp();
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    void session.stop().finally(() => process.exit(0));
  });
}
