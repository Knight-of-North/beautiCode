import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../..");

test("Windows file picker is launched in STA with a TopMost owner", () => {
  const source = fs.readFileSync(path.join(repo, "scripts", "wb-cdp-runner.mjs"), "utf8");
  assert.match(source, /-STA/);
  assert.match(source, /OpenFileDialog/);
  assert.match(source, /\[Console\]::OutputEncoding=\$OutputEncoding/);
  assert.match(source, /\$owner\.TopMost=\$true/);
  assert.match(source, /ShowDialog\(\$owner\)/);
  assert.doesNotMatch(source, /\$d\.ShowDialog\(\)/);
  assert.match(source, /__bcApplyBackgroundPath/);
  assert.match(source, /ensureWorkBuddyCdp/);
  assert.match(source, /--watchdog/);
  assert.match(source, /--no-launch/);
});

test("wb-setup persists env, installs a watchdog runner, and logs under LocalAppData", () => {
  const source = fs.readFileSync(path.join(repo, "scripts", "wb-setup.mjs"), "utf8");
  assert.match(source, /setx/);
  assert.match(source, /--watchdog/);
  assert.match(source, /['"]beauticode['"],\s*['"]logs['"]/);
});
