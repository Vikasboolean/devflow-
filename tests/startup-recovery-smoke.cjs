const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const tempRoot = path.join(root, "validation-temp", "startup-recovery");
const appData = path.join(tempRoot, "appdata");
const dataDirectory = path.join(appData, "browser-pro");
const electronExe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
const debugPort = 9463;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, label, timeout = 25000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await check();
    if (value) return value;
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function stopChild(child, tree = false) {
  if (!child?.pid) return;
  if (tree) {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* Fall back to terminating the direct child. */ }
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(2000)
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* Process may have exited between checks. */ }
  }
}

async function main() {
  assert.ok(tempRoot.startsWith(root + path.sep), "temporary data must remain in the workspace");
  assert.ok(fs.existsSync(electronExe), "Electron executable exists");
  fs.rmSync(tempRoot, { recursive: true, force: true });
  fs.mkdirSync(dataDirectory, { recursive: true });
  fs.writeFileSync(path.join(dataDirectory, "devflow-data.json"), "{ malformed", "utf8");

  const vite = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore"
  });
  let electron;
  try {
    await waitFor(async () => {
      try { return (await fetch("http://127.0.0.1:5173/")).ok; } catch { return false; }
    }, "Vite development server");

    const env = { ...process.env, APPDATA: appData };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = spawn(electronExe, [root, `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*"], {
      cwd: root,
      env,
      windowsHide: true,
      stdio: "ignore"
    });

    const targets = await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
        if (!response.ok) return null;
        const list = await response.json();
        return list.find((target) => target.url === "http://localhost:5173/") || null;
      } catch { return null; }
    }, "DevFlow application renderer");

    assert.ok(targets, "DevFlow renderer opened using the isolated profile");
    const backup = await waitFor(async () => fs.readdirSync(dataDirectory).find((name) => name.startsWith("devflow-data.json.corrupt-")), "corrupt data backup");
    assert.equal(fs.readFileSync(path.join(dataDirectory, backup), "utf8"), "{ malformed");
    console.log(JSON.stringify({
      startup: "PASS",
      malformedDataRecovery: "PASS",
      preservedCorruptBackup: backup,
      isolatedUserData: dataDirectory
    }, null, 2));
  } finally {
    await stopChild(electron, true);
    await stopChild(vite);
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); } catch { /* Isolated leftovers can be removed manually if Windows holds a lock. */ }
    try { fs.rmdirSync(path.dirname(tempRoot)); } catch { /* Keep the shared validation root if it contains other test data. */ }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
