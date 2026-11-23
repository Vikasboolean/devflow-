const assert = require("node:assert/strict");
const { spawn, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const appPath = path.join(root, "release", "win-unpacked", "DevFlow.exe");
const appData = path.join(root, "release", "smoke-userdata");
const debugPort = 9453;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function waitForTargets(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        if (targets.some(target => target.url.includes("app.asar/dist/index.html"))) return targets;
      }
    } catch { /* Electron is still starting. */ }
    await delay(250);
  }
  throw new Error("Packaged DevFlow renderer did not start");
}

function connect(target) {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); entry.resolve(message); }
  });
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve({
      call(method, params = {}) {
        const id = nextId++;
        socket.send(JSON.stringify({ id, method, params }));
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 8000);
          pending.set(id, { resolve, timer });
        });
      },
      close() { socket.close(); }
    }), { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
}

async function evaluate(cdp, expression) {
  const result = await cdp.call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.error) throw new Error(result.error.message);
  if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
  return result.result.result.value;
}

async function main() {
  assert.ok(fs.existsSync(appPath), "packaged executable exists");
  fs.mkdirSync(appData, { recursive: true });

  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html><title>Loading</title><a id="unsafe" href="file:///C:/Windows/win.ini">unsafe</a><script>if (location.pathname !== '/check') document.cookie = 'isolation=' + encodeURIComponent(location.pathname) + '; path=/; SameSite=Lax'; document.title = [typeof window.browserAPI, typeof window.ipcRenderer, typeof window.require, typeof window.process].join('|')</script>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const controlledOrigin = `http://127.0.0.1:${server.address().port}`;

  const env = { ...process.env, APPDATA: appData };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(appPath, [`--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*"], { env, windowsHide: true, stdio: "ignore" });
  let appCdp;
  let websiteCdp;
  let privateCdp;
  try {
    let targets = await waitForTargets();
    const appTarget = targets.find(target => target.url.includes("app.asar/dist/index.html"));
    appCdp = await connect(appTarget);

    let shellState;
    const appReadyDeadline = Date.now() + 15000;
    while (Date.now() < appReadyDeadline) {
      shellState = await evaluate(appCdp, "JSON.stringify({title:document.title, api:typeof window.browserAPI})");
      const state = JSON.parse(shellState);
      if (state.title === "DevFlow" && state.api === "object") break;
      await delay(250);
    }
    assert.deepEqual(JSON.parse(shellState), { title: "DevFlow", api: "object" });
    console.log("smoke: application renderer loaded");

    const payloadResult = await evaluate(appCdp, `window.browserAPI.updateSettings(JSON.parse('{"constructor":true}'))`);
    assert.equal(payloadResult.error, "Invalid IPC payload");

    const created = await evaluate(appCdp, `window.browserAPI.createTab(${JSON.stringify(`${controlledOrigin}/`)})`);
    assert.equal(typeof created, "string");

    const deadline = Date.now() + 10000;
    let webTarget;
    while (Date.now() < deadline) {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      webTarget = targets.find(target => target.url === `${controlledOrigin}/`);
      if (webTarget) break;
      await delay(200);
    }
    assert.ok(webTarget, "controlled website opened as a browser tab");
    console.log("smoke: controlled website opened");
    websiteCdp = await connect(webTarget);

    const websiteGlobals = await evaluate(websiteCdp, "document.title");
    assert.equal(websiteGlobals, "undefined|undefined|undefined|undefined");
    const normalCookie = await evaluate(websiteCdp, "document.cookie");
    assert.equal(normalCookie, "isolation=%2F");

    await evaluate(websiteCdp, "document.getElementById('unsafe').click()");
    await delay(500);
    const afterFileAttempt = await evaluate(websiteCdp, "location.href");
    assert.equal(afterFileAttempt, `${controlledOrigin}/`);

    await evaluate(appCdp, "(() => { const link = document.createElement('a'); link.href = 'file:///C:/Windows/win.ini'; document.body.appendChild(link); link.click(); })()");
    await delay(500);
    const appUrlAfterAttempt = await evaluate(appCdp, "location.href");
    assert.ok(appUrlAfterAttempt.includes("app.asar/dist/index.html"));
    console.log("smoke: unsafe navigation blocked");

    const privateTabId = await evaluate(appCdp, `window.browserAPI.createPrivateTab(${JSON.stringify(`${controlledOrigin}/private`)})`);
    const privateDeadline = Date.now() + 10000;
    let privateTarget;
    while (Date.now() < privateDeadline) {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      privateTarget = targets.find(target => target.url === `${controlledOrigin}/private`);
      if (privateTarget) break;
      await delay(200);
    }
    assert.ok(privateTarget, "private tab opened");
    privateCdp = await connect(privateTarget);
    let privateCookie = "";
    const privateCookieDeadline = Date.now() + 5000;
    while (Date.now() < privateCookieDeadline) {
      privateCookie = await evaluate(privateCdp, "document.cookie");
      if (privateCookie === "isolation=%2Fprivate") break;
      await delay(100);
    }
    assert.equal(privateCookie, "isolation=%2Fprivate");
    assert.equal(await evaluate(websiteCdp, "document.cookie"), normalCookie);
    console.log("smoke: cookies are isolated");

    console.log("smoke: closing final private tab");
    privateCdp?.close();
    privateCdp = null;
    assert.equal(await evaluate(appCdp, `window.browserAPI.closeTab(${JSON.stringify(privateTabId)})`), true);
    console.log("smoke: final private tab closed");
    const emptyPrivateTabId = await evaluate(appCdp, `window.browserAPI.createPrivateTab(${JSON.stringify(`${controlledOrigin}/check`)})`);
    const emptyPrivateDeadline = Date.now() + 10000;
    let emptyPrivateTarget;
    while (Date.now() < emptyPrivateDeadline) {
      targets = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      emptyPrivateTarget = targets.find(target => target.url === `${controlledOrigin}/check`);
      if (emptyPrivateTarget) break;
      await delay(200);
    }
    assert.ok(emptyPrivateTarget, "clean private tab reopened");
    assert.equal(typeof emptyPrivateTabId, "string");
    privateCdp?.close();
    privateCdp = await connect(emptyPrivateTarget);
    assert.equal(await evaluate(privateCdp, "document.cookie"), "");
    console.log("smoke: private storage cleared");

    console.log(JSON.stringify({
      productionTitle: JSON.parse(shellState).title,
      appPreloadAvailable: JSON.parse(shellState).api,
      websiteGlobals,
      maliciousFileNavigationBlocked: afterFileAttempt === `${controlledOrigin}/` && appUrlAfterAttempt.includes("app.asar/dist/index.html"),
      privateCookieIsolationAndCleanup: privateCookie === "isolation=%2Fprivate" && await evaluate(privateCdp, "document.cookie") === "",
      malformedPayloadRejected: payloadResult.error,
      isolatedUserDataRoot: path.join(appData, "browser-pro")
    }, null, 2));
  } finally {
    websiteCdp?.close();
    privateCdp?.close();
    appCdp?.close();
    server.close();
    if (child.pid) {
      try { execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* The app may have already exited. */ }
    }
    try { fs.rmSync(appData, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 }); } catch { /* The temporary profile can be removed manually if Windows still holds a file handle. */ }
  }
}

main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
