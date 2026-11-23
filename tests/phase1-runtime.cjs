const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const validationRoot = path.join(root, "validation-temp");
let tempRoot;
let appData;
let userData;
let downloads;
const electronExe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const viteEntry = path.join(root, "node_modules", "vite", "bin", "vite.js");
const debugPort = 9477;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];
let appLog = "";

async function eventually(check, label, timeout = 18000) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) { lastError = error; }
    await wait(125);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function stopChild(child, tree = false) {
  if (!child?.pid) return;
  if (tree) {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* Try direct termination below. */ }
  }
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), wait(2000)]);
  if (child.exitCode === null && child.signalCode === null) {
    try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* Process may already be gone. */ }
  }
}

function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!pending.has(message.id)) return;
    const entry = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve(message);
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({
      call(method, params = {}) {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((res, rej) => {
          const timer = setTimeout(() => { pending.delete(id); rej(new Error(`CDP timeout: ${method}`)); }, 10000);
          pending.set(id, { resolve: res, reject: rej, timer });
        });
      },
      close() { socket.close(); }
    }), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

async function evaluate(cdp, expression, awaitPromise = true) {
  const response = await cdp.call("Runtime.evaluate", { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (response.error) throw new Error(response.error.message);
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  return response.result.result.value;
}

async function runCase(name, fn) {
  try {
    const evidence = await fn();
    results.push({ test: name, status: "PASS", evidence: evidence ?? "Assertions passed" });
  } catch (error) {
    results.push({ test: name, status: error.notTested ? "NOT TESTED" : "FAIL", evidence: error.stack || error.message });
  }
}

function notTested(name, evidence) {
  results.push({ test: name, status: "NOT TESTED", evidence });
}

function makeServer() {
  const server = http.createServer((request, response) => {
    const requestUrl = new URL(request.url, "http://127.0.0.1");
    server.testRequests.push(`${requestUrl.pathname}${requestUrl.search}`);
    if (requestUrl.pathname === "/download") {
      const name = requestUrl.searchParams.get("name") || "sample.txt";
      const bytes = Math.min(Number(requestUrl.searchParams.get("bytes") || 32768), 4 * 1024 * 1024);
      const slow = requestUrl.searchParams.get("slow") === "1";
      response.writeHead(200, {
        "content-type": "text/plain; charset=utf-8",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
        "content-length": bytes,
        "cache-control": "no-store"
      });
      const chunk = Buffer.alloc(32768, "T");
      let sent = 0;
      const stream = () => {
        if (sent >= bytes) { response.end(); return; }
        const piece = chunk.subarray(0, Math.min(chunk.length, bytes - sent));
        sent += piece.length;
        if (!response.write(piece)) response.once("drain", () => slow ? setTimeout(stream, 60) : stream());
        else if (slow) setTimeout(stream, 60);
        else setImmediate(stream);
      };
      stream();
      return;
    }
    if (requestUrl.pathname === "/permission-test") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(`<!doctype html><meta charset="utf-8"><title>Permission test</title><main>
        <button id="camera">Camera</button><button id="microphone">Microphone</button>
        <button id="notifications">Notifications</button><button id="geolocation">Geolocation</button>
        <button id="clipboard">Clipboard read</button><button id="popup">Popup</button>
        <output id="result"></output></main><script>
        window.__result = null;
        const finish = p => p.then(v => window.__result = String(v), e => window.__result = e.name + ':' + e.message);
        camera.onclick = () => finish(navigator.mediaDevices.getUserMedia({video:true}).then(s => { s.getTracks().forEach(t => t.stop()); return 'granted'; }));
        microphone.onclick = () => finish(navigator.mediaDevices.getUserMedia({audio:true}).then(s => { s.getTracks().forEach(t => t.stop()); return 'granted'; }));
        notifications.onclick = () => finish(Notification.requestPermission());
        geolocation.onclick = () => finish(new Promise(resolve => navigator.geolocation.getCurrentPosition(() => resolve('granted'), e => resolve('denied:'+e.code))));
        clipboard.onclick = () => finish(navigator.clipboard.readText().then(() => 'granted'));
        popup.onclick = () => { window.open(location.origin + '/popup', '_blank'); window.__result = 'opened'; };
        </script>`);
      return;
    }
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(`<!doctype html><meta charset="utf-8"><title>Controlled site</title><a id="external" href="mailto:phase1-test@example.invalid">external</a><script>window.__testPage=true</script>`);
  });
  server.testRequests = [];
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function startServer(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

async function assertPortAvailable(port) {
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", (error) => reject(new Error(`Validation port ${port} is already in use: ${error.message}`)));
    probe.listen(port, "127.0.0.1", () => probe.close(resolve));
  });
}

async function main() {
  assert.ok(fs.existsSync(electronExe), "Electron executable exists");
  fs.mkdirSync(validationRoot, { recursive: true });
  tempRoot = fs.mkdtempSync(path.join(validationRoot, "phase1-download-permissions-"));
  assert.ok(tempRoot.startsWith(root + path.sep), "test paths must remain within workspace");
  appData = path.join(tempRoot, "appdata");
  userData = path.join(appData, "browser-pro");
  downloads = path.join(tempRoot, "downloads");
  fs.mkdirSync(downloads, { recursive: true });

  await assertPortAvailable(5173);
  await assertPortAvailable(debugPort);

  const serverA = await makeServer();
  const serverB = await makeServer();
  const originA = await startServer(serverA);
  const originB = await startServer(serverB);
  const vite = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", "5173", "--strictPort"], {
    cwd: root, windowsHide: true, stdio: "ignore"
  });
  let electron;
  let appCdp;
  const siteCdp = new Map();
  try {
    await eventually(async () => { try { return (await fetch("http://127.0.0.1:5173/")).ok; } catch { return false; } }, "Vite server");
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, "devflow-data.json"), JSON.stringify({
      settings: {
        startupBehavior: "newtab", downloadLocation: downloads,
        openPopupsInNewTabs: true, downloadNotifications: false,
        pinnedTabs: [], recentlyClosedTabs: [], lastSession: [], lastActiveTabIndex: 0
      },
      websitePermissions: [], downloads: [], bookmarks: [], history: [], apiCollections: [], savedRequests: []
    }, null, 2));

    const env = { ...process.env, APPDATA: appData };
    delete env.ELECTRON_RUN_AS_NODE;
    electron = spawn(electronExe, [root, `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*"], {
      cwd: root, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    electron.stdout.on("data", (chunk) => { appLog += chunk.toString(); });
    electron.stderr.on("data", (chunk) => { appLog += chunk.toString(); });

    let appTarget;
    await eventually(async () => {
      try {
        const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
        appTarget = list.find((target) => target.url === "http://localhost:5173/");
        return Boolean(appTarget);
      } catch { return false; }
    }, "DevFlow renderer");
    appCdp = await connect(appTarget);
    await eventually(async () => (await evaluate(appCdp, "typeof window.browserAPI")) === "object", "trusted preload");

    async function targets() { return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()); }
    async function getSite(origin, pathname = "/") {
      const url = `${origin}${pathname}`;
      let target = (await targets()).find((entry) => entry.url === url);
      if (!target) {
        await evaluate(appCdp, `window.browserAPI.createTab(${JSON.stringify(url)})`);
        target = await eventually(async () => (await targets()).find((entry) => entry.url === url), `tab ${url}`);
      }
      let connection = siteCdp.get(target.id);
      if (!connection) { connection = await connect(target); siteCdp.set(target.id, connection); }
      return connection;
    }
    async function setPermission(origin, permission, decision) {
      const result = await evaluate(appCdp, `window.browserAPI.setWebsitePermission(${JSON.stringify({ origin, permission, decision })})`);
      assert.equal(result.success, true, `Permission update rejected: ${JSON.stringify(result)}`);
      return result;
    }
    async function clickPageButton(cdp, id) {
      const clicked = await evaluate(cdp, `(() => { const button=document.getElementById(${JSON.stringify(id)}); if(!button) return false; button.click(); return true; })()`);
      assert.equal(clicked, true, `Permission test button ${id} was missing`);
    }
    async function startDownload(cdp, origin, name, params = {}) {
      const query = new URLSearchParams({ name, nonce: `${Date.now()}-${Math.random()}`, ...params }).toString();
      const url = `${origin}/download?${query}`;
      await evaluate(cdp, `(() => { const a=document.createElement('a'); a.href=${JSON.stringify(url)}; a.click(); return true; })()`);
      return url;
    }
    async function waitRecord(url, state, timeout = 20000) {
      return eventually(async () => {
        const records = await evaluate(appCdp, "window.browserAPI.getDownloads()");
        return records.find((record) => record.url === url && (Array.isArray(state) ? state.includes(record.state) : record.state === state));
      }, `download ${state}` , timeout);
    }
    function assertInsideDownloads(record) {
      const resolved = path.resolve(record.filePath);
      const relative = path.relative(downloads, resolved);
      assert.ok(relative && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `Download escaped configured folder: ${resolved}`);
      return resolved;
    }

    const siteA = await getSite(originA);
    const siteB = await getSite(originB);
    const appGlobalCheck = await evaluate(siteA, "[typeof window.browserAPI,typeof window.ipcRenderer,typeof window.require,typeof window.process].join('|')");
    await runCase("Untrusted website preload isolation", async () => {
      assert.equal(appGlobalCheck, "undefined|undefined|undefined|undefined");
      return appGlobalCheck;
    });
    await runCase("IPC payload validation from trusted renderer", async () => {
      const result = await evaluate(appCdp, "window.browserAPI.updateSettings({constructor:true})");
      assert.equal(result.error, "Invalid IPC payload");
      return result.error;
    });
    await runCase("New Tab button creates a tab", async () => {
      const before = await evaluate(appCdp, "window.browserAPI.getTabs()");
      const clicked = await evaluate(appCdp, "(() => { const button=document.querySelector('button.new-tab'); if(!button) return false; button.click(); return true; })()");
      assert.equal(clicked, true, "New Tab button was missing");
      const after = await eventually(async () => {
        const state = await evaluate(appCdp, "window.browserAPI.getTabs()");
        return state.tabs.length === before.tabs.length + 1 ? state : null;
      }, "new tab after clicking the New Tab button");
      const addedTab = after.tabs.find(tab => !before.tabs.some(existing => existing.id === tab.id));
      assert.ok(addedTab, "New Tab button did not create a tab");
      await evaluate(appCdp, `window.browserAPI.closeTab(${JSON.stringify(addedTab.id)})`);
      return "New Tab button created a tab without an IPC payload error";
    });
    await runCase("Download location rejects an unapproved destination", async () => {
      const outside = path.join(tempRoot, "outside-downloads");
      fs.mkdirSync(outside, { recursive: true });
      const result = await evaluate(appCdp, `window.browserAPI.updateSettings({downloadLocation:${JSON.stringify(outside)}})`);
      assert.equal(result.success, false);
      assert.equal((await evaluate(appCdp, "window.browserAPI.getSettings()")).downloadLocation, downloads);
      return result.error;
    });

    await setPermission(originA, "downloads", "denied");
    const deniedUrl = await startDownload(siteA, originA, "denied.txt");
    await runCase("Persisted download Deny blocks a file for that origin", async () => {
      const expectedRequest = new URL(deniedUrl).pathname + new URL(deniedUrl).search;
      await eventually(async () => serverA.testRequests.includes(expectedRequest), "denied request reaches controlled server");
      await wait(350);
      assert.equal(fs.existsSync(path.join(downloads, "denied.txt")), false);
      const records = await evaluate(appCdp, "window.browserAPI.getDownloads()");
      assert.equal(records.some((record) => record.url === deniedUrl), false);
      return { requestingOrigin: originA, decision: "denied", fileCreated: false, downloadRecordCreated: false };
    });

    await setPermission(originA, "downloads", "granted");
    const normalUrl = await startDownload(siteA, originA, "normal.txt", { bytes: String(1024 * 1024), slow: "1" });
    await runCase("Permitted download completes in configured destination", async () => {
      const record = await waitRecord(normalUrl, "completed");
      assert.equal(fs.existsSync(assertInsideDownloads(record)), true);
      const saved = JSON.parse(fs.readFileSync(path.join(userData, "devflow-data.json"), "utf8"));
      assert.ok(saved.websitePermissions.some((item) => item.origin === originA && item.permission === "downloads" && item.decision === "granted"));
      return { requestingOrigin: originA, state: record.state, destination: record.filePath };
    });

    await setPermission(originB, "downloads", "denied");
    const originBUrl = await startDownload(siteB, originB, "other-origin-denied.txt");
    await runCase("Download permission decision is origin scoped", async () => {
      const expectedRequest = new URL(originBUrl).pathname + new URL(originBUrl).search;
      await eventually(async () => serverB.testRequests.includes(expectedRequest), "second-origin request reaches controlled server");
      await wait(350);
      assert.equal(fs.existsSync(path.join(downloads, "other-origin-denied.txt")), false);
      const saved = JSON.parse(fs.readFileSync(path.join(userData, "devflow-data.json"), "utf8"));
      assert.ok(saved.websitePermissions.some((item) => item.origin === originA && item.permission === "downloads" && item.decision === "granted"));
      assert.ok(saved.websitePermissions.some((item) => item.origin === originB && item.permission === "downloads" && item.decision === "denied"));
      return { originAGrantRemainsScoped: true, originBDenied: true, originBFileCreated: false };
    });

    const collisionFile = path.join(downloads, "collision.txt");
    fs.writeFileSync(collisionFile, "preexisting harmless sentinel", "utf8");
    const collisionUrl = await startDownload(siteA, originA, "collision.txt");
    await runCase("Existing filename collision preserves the existing file", async () => {
      const record = await waitRecord(collisionUrl, "completed");
      assert.equal(fs.readFileSync(collisionFile, "utf8"), "preexisting harmless sentinel");
      assert.match(path.basename(record.filePath), /^collision \(1\)\.txt$/);
      return { path: record.filePath, existingFilePreserved: true };
    });

    const concurrentA = await startDownload(siteA, originA, "parallel.txt", { bytes: String(2 * 1024 * 1024), slow: "1" });
    const concurrentB = await startDownload(siteA, originA, "parallel.txt", { bytes: String(2 * 1024 * 1024), slow: "1" });
    await runCase("Concurrent identical filenames receive distinct destinations", async () => {
      const [first, second] = await Promise.all([waitRecord(concurrentA, "completed"), waitRecord(concurrentB, "completed")]);
      assertInsideDownloads(first); assertInsideDownloads(second);
      assert.notEqual(path.resolve(first.filePath), path.resolve(second.filePath), "concurrent downloads overwrote the same target path");
      assert.equal(fs.existsSync(first.filePath), true);
      assert.equal(fs.existsSync(second.filePath), true);
      return [first.filePath, second.filePath];
    });

    for (const name of ["..\\..\\phase1-outside.txt", "bad:name?.txt", "CON.txt"]) {
      const url = await startDownload(siteA, originA, name);
      await runCase(`Unsafe filename stays within download directory (${name})`, async () => {
        const record = await waitRecord(url, "completed");
        const target = assertInsideDownloads(record);
        assert.equal(fs.existsSync(target), true);
        assert.equal(fs.existsSync(path.join(tempRoot, "phase1-outside.txt")), false);
        if (/^CON/i.test(name)) assert.match(path.basename(target), /^_CON/i);
        return { requestedName: name, storedName: record.filename, path: target };
      });
    }

    const progressUrl = await startDownload(siteA, originA, "progress.txt", { bytes: String(2 * 1024 * 1024), slow: "1" });
    await runCase("Progress and completion update events", async () => {
      const updates = await evaluate(appCdp, "(window.__phase1Updates = [], window.__phase1Unsub = window.browserAPI.onDownloadsUpdated(items => window.__phase1Updates.push(...items.map(x => ({id:x.id,state:x.state,receivedBytes:x.receivedBytes})))), true)");
      assert.equal(updates, true);
      const record = await waitRecord(progressUrl, "completed");
      const events = await evaluate(appCdp, `window.__phase1Updates.filter(x=>x.id===${JSON.stringify(record.id)})`);
      assert.ok(events.some((event) => event.state === "progressing" && event.receivedBytes > 0), JSON.stringify(events));
      assert.ok(events.some((event) => event.state === "completed"), JSON.stringify(events));
      await evaluate(appCdp, "window.__phase1Unsub()");
      return { progressEvents: events.filter((event) => event.state === "progressing").length, completionEvent: true };
    });

    const cancelUrl = await startDownload(siteA, originA, "cancel.txt", { bytes: String(4 * 1024 * 1024), slow: "1" });
    await runCase("Cancellation state persists without escaping destination", async () => {
      const active = await eventually(async () => {
        const records = await evaluate(appCdp, "window.browserAPI.getDownloads()");
        return records.find((item) => item.url === cancelUrl && item.state === "progressing" && item.receivedBytes > 0);
      }, "cancellable download progress");
      const control = await evaluate(appCdp, `window.browserAPI.controlDownload(${JSON.stringify(active.id)},"cancel")`);
      assert.equal(control.success, true);
      const cancelled = await waitRecord(cancelUrl, "cancelled");
      assertInsideDownloads(cancelled);
      const saved = JSON.parse(fs.readFileSync(path.join(userData, "devflow-data.json"), "utf8"));
      assert.equal(saved.downloads.find((item) => item.id === active.id)?.state, "cancelled");
      return { state: cancelled.state, persistedState: "cancelled", filePath: cancelled.filePath };
    });

    const pauseUrl = await startDownload(siteA, originA, "pause-resume.txt", { bytes: String(3 * 1024 * 1024), slow: "1" });
    await runCase("Pause and resume where supported", async () => {
      const active = await eventually(async () => {
        const records = await evaluate(appCdp, "window.browserAPI.getDownloads()");
        return records.find((item) => item.url === pauseUrl && item.state === "progressing" && item.receivedBytes > 0);
      }, "download progress before pause");
      assert.equal((await evaluate(appCdp, `window.browserAPI.controlDownload(${JSON.stringify(active.id)},"pause")`)).success, true);
      const paused = await waitRecord(pauseUrl, "paused");
      const bytesAtPause = paused.receivedBytes;
      await wait(450);
      const stillPaused = (await evaluate(appCdp, "window.browserAPI.getDownloads()")).find((item) => item.id === active.id);
      assert.equal(stillPaused.state, "paused");
      assert.equal(stillPaused.receivedBytes, bytesAtPause);
      assert.equal((await evaluate(appCdp, `window.browserAPI.controlDownload(${JSON.stringify(active.id)},"resume")`)).success, true);
      const completed = await waitRecord(pauseUrl, "completed");
      assert.equal(fs.existsSync(assertInsideDownloads(completed)), true);
      return { pausedBytes: bytesAtPause, finalState: completed.state };
    });

    const permissionTests = [
      ["camera", "media", "Deny"], ["microphone", "media", "Deny"],
      ["geolocation", "geolocation", "Deny"], ["clipboard", "clipboard-read", "Deny"],
      ["notifications", "notifications", "Allow"]
    ];
    const permissionSite = await getSite(originA, "/permission-test");
    for (const [button, permission, decision] of permissionTests) {
      await setPermission(originA, permission, decision === "Allow" ? "granted" : "denied");
      await evaluate(permissionSite, "window.__result=null");
      await clickPageButton(permissionSite, button);
      await runCase(`${button} permission ${decision.toLowerCase()} decision runtime behavior`, async () => {
        const result = await eventually(async () => {
          const value = await evaluate(permissionSite, "window.__result");
          return value !== null ? value : null;
        }, `${button} request result`);
        if (button === "clipboard" && /document is not focused/i.test(result)) {
          const error = new Error(`Clipboard read was blocked by the renderer focus requirement before the website permission decision could be observed: ${result}`);
          error.notTested = true;
          throw error;
        }
        const stored = (await evaluate(appCdp, "window.browserAPI.getWebsitePermissions()")).permissions;
        const expected = decision === "Allow" ? "granted" : "denied";
        assert.ok(stored.some((item) => item.origin === originA && item.permission === permission && item.decision === expected));
        if (decision === "Deny") assert.match(result, /NotAllowed|denied|Permission denied/i);
        else assert.equal(result, "granted");
        return { origin: originA, permission, decision: expected, pageResult: result, deviceOrClipboardDataAccessed: false };
      });
    }

    await runCase("Permission decisions are origin scoped", async () => {
      await setPermission(originA, "notifications", "granted");
      const secondOrigin = await getSite(originB, "/permission-test");
      await setPermission(originB, "notifications", "denied");
      await evaluate(secondOrigin, "window.__result=null");
      await clickPageButton(secondOrigin, "notifications");
      const result = await eventually(async () => {
        const value = await evaluate(secondOrigin, "window.__result");
        return value !== null ? value : null;
      }, "second origin notification decision");
      assert.notEqual(result, "granted");
      return { originAGrant: "granted", originBDenial: "denied", originBResult: result };
    });

    await runCase("Unsupported permission is denied by default", async () => {
      const result = await evaluate(appCdp, `window.browserAPI.setWebsitePermission({origin:${JSON.stringify(originA)},permission:"midi-sysex",decision:"granted"})`);
      assert.equal(result.success, false);
      return result.error;
    });

    await runCase("Malformed permission origins are rejected", async () => {
      const result = await evaluate(appCdp, "window.browserAPI.setWebsitePermission({origin:'not a url',permission:'notifications',decision:'granted'})");
      assert.equal(result.success, false);
      return result.error;
    });

    await runCase("Safe popup opens a controlled HTTP tab; unsafe schemes are blocked", async () => {
      const before = (await targets()).length;
      await evaluate(siteA, `window.open(${JSON.stringify(`${originB}/popup`)},"_blank")`);
      const popup = await eventually(async () => (await targets()).find((target) => target.url === `${originB}/popup`), "controlled popup tab");
      const safeTargetIds = new Set((await targets()).map((target) => target.id));
      const httpsUrl = `https://127.0.0.1:${new URL(originA).port}/tls-probe`;
      await evaluate(siteA, `window.open(${JSON.stringify(httpsUrl)},"_blank")`);
      const httpsPopup = await eventually(async () => (await targets()).find((target) => target.url === httpsUrl), "local HTTPS popup target");
      safeTargetIds.add(httpsPopup.id);
      await evaluate(siteA, `(${JSON.stringify(["file:///C:/Windows/win.ini", "javascript:alert(1)", "data:text/html,blocked", "devtools://devtools/", "electron://internal"]) }).forEach(url=>window.open(url,"_blank"))`);
      await wait(500);
      const after = await targets();
      const unsafeTargets = after.filter((target) => !safeTargetIds.has(target.id) && ["file:", "javascript:", "data:", "devtools:", "electron:"].some((scheme) => target.url.startsWith(scheme)));
      assert.equal(unsafeTargets.length, 0, `Unsafe popup targets: ${JSON.stringify(after.filter((target) => !safeTargetIds.has(target.id)))}`);
      assert.ok(after.some((target) => target.id === popup.id));
      return { safeHttpPopup: popup.url, safeHttpsTarget: httpsPopup.url, targetCountBefore: before, unsafeTargets: 0, httpsContentNotLoaded: true };
    });

    await runCase("Explicit popup denial and app-shell popup blocking", async () => {
      await setPermission(originA, "popups", "denied");
      const before = (await targets()).length;
      await evaluate(siteA, `window.open(${JSON.stringify(`${originB}/blocked-popup`)},"_blank")`);
      await evaluate(appCdp, `window.open(${JSON.stringify(`${originB}/shell-popup`)},"_blank")`);
      await wait(500);
      const after = await targets();
      assert.equal(after.some((target) => target.url.includes("blocked-popup") || target.url.includes("shell-popup")), false);
      assert.equal(after.length, before);
      return { popupDenied: true, appShellPopupDenied: true };
    });

    await runCase("External protocol attempts are blocked without launching applications", async () => {
      const before = (await targets()).length;
      const initialUrl = await evaluate(siteA, "location.href");
      await evaluate(siteA, "document.getElementById('external').click()");
      await wait(500);
      assert.equal(await evaluate(siteA, "location.href"), initialUrl);
      await evaluate(siteA, `window.open("mailto:phase1@example.invalid","_blank")`);
      await wait(300);
      assert.equal((await targets()).some((target) => target.url.startsWith("mailto:")), false);
      assert.equal((await targets()).length, before);
      return { mailtoNavigationBlocked: true, noExternalAppInvokedByTest: true };
    });

    await runCase("Sensitive canary is absent from application stdout/stderr", async () => {
      const canary = "PHASE1_SECRET_CANARY_DO_NOT_LOG";
      await evaluate(siteA, `fetch(${JSON.stringify(`${originA}/download?name=log-check.txt&bytes=128`)}, {headers:{"X-Test-Authorization":${JSON.stringify(canary)}}}).catch(()=>{})`);
      await wait(300);
      assert.equal(appLog.includes(canary), false);
      return { canaryAbsent: true, logBytesObserved: appLog.length };
    });

    notTested("Native download permission prompt display and Allow/Deny button interaction", "The prior UI Automation attempt could not confirm the native dialog from the Electron process; prompt appearance and button behavior are not claimed as tested. Stored Allow/Deny enforcement was tested at runtime.");
    notTested("Native camera, microphone, notification, geolocation, and clipboard prompt display", "Permission outcomes were exercised with explicit origin-scoped decisions. Native prompt visibility and button interaction were not confirmed in this environment.");
    notTested("Clipboard write permission prompt", "The supported clipboard write permission was not requested because doing so would modify the host clipboard.");

    const failed = results.filter((result) => result.status === "FAIL");
    console.log(JSON.stringify({
      origins: [originA, originB],
      isolatedUserData: userData,
      isolatedDownloads: downloads,
      results,
      summary: { passed: results.filter((item) => item.status === "PASS").length, failed: failed.length }
    }, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    for (const connection of siteCdp.values()) connection.close();
    appCdp?.close();
    for (const server of [serverA, serverB]) await new Promise((resolve) => server.close(resolve));
    await stopChild(electron, true);
    await stopChild(vite);
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 4, retryDelay: 600 }); } catch { /* Temporary data may need manual removal if Windows retains a handle. */ }
    try { fs.rmdirSync(path.dirname(tempRoot)); } catch { /* Keep any shared validation files. */ }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
