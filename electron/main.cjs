const {
    app,
    BrowserWindow,
    WebContentsView,
    screen,
    ipcMain,
    safeStorage,
    session,
    shell,
    net,
    dialog
} = require("electron");

const path = require("path");
const fs = require("fs");
const { randomUUID } = require("crypto");
const { fileURLToPath } = require("url");
const { isSafeUrl, shouldBlockWebsiteNavigation } = require("./url-policy.cjs");
const { safeDownloadFilename } = require("./download-policy.cjs");

// Keep the existing browser-pro userData directory stable across the product rename.
const appDataDirectory = process.platform === "win32" && process.env.APPDATA
    ? process.env.APPDATA
    : app.getPath("appData");
app.setPath("userData", path.join(appDataDirectory, "browser-pro"));
app.setName("DevFlow");
if (process.platform === "win32") app.setAppUserModelId("com.devflow.browser");

const database = require("./database.cjs");
const { isValidIpcArguments } = require("./ipc-payload.cjs");

let mainWindow;
let toolsWindow = null;
let toolsWindowReady = false;
let toolsWindowRequested = false;
let activeTool = "";
let tabs = new Map();
let activeTabId = null;
let responsiveModeActive = false;
let responsiveViewBounds = null;
let sessionSaveTimer = null;
let viewBounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
};
let networkMonitoringInitialized = false;
const networkRequests = new Map();
const blockedRequestUrls = new Set();
const MAX_NETWORK_REQUESTS = 500;
// Download Manager
const downloads = new Map();
const configuredDownloadSessions = new WeakSet();
const reservedDownloadPaths = new Set();
const MAX_DOWNLOAD_HISTORY = 200;
const NEW_TAB_URL = "devflow://newtab";
const closedTabs = (Array.isArray(database.getSettings().recentlyClosedTabs) ? database.getSettings().recentlyClosedTabs : [])
    .filter(item => item && isSafeUrl(item.url) && !item.isPrivate)
    .slice(0, 10);
const privatePermissionDecisions = new Map();
const approvedDownloadLocations = new Set();
const SUPPORTED_SITE_PERMISSIONS = new Set(["media", "geolocation", "notifications", "clipboard-read", "clipboard-sanitized-write", "popups", "downloads"]);

function isWithinDirectory(directory, candidate) {
    const root = path.resolve(directory);
    const resolved = path.resolve(candidate);
    const relative = path.relative(root, resolved);
    return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function getDownloadDirectory() {
    const configured = database.getSettings().downloadLocation;
    if (typeof configured === "string" && configured && path.isAbsolute(configured)) {
        try { if (fs.statSync(configured).isDirectory()) return path.resolve(configured); } catch { /* Use the OS default when the saved folder is unavailable. */ }
    }
    return app.getPath("downloads");
}

const toolsOnlyChannels = new Set(["tools:select", "tools:close-menu", "tools:get-theme"]);
function isTrustedToolsRenderer(event) {
    if (!toolsWindow || toolsWindow.isDestroyed() || event.sender !== toolsWindow.webContents || event.senderFrame !== event.sender.mainFrame) return false;
    try { return fileURLToPath(event.senderFrame.url) === path.join(__dirname, "tools-menu.html"); } catch { return false; }
}
function isDevFlowAppUrl(value) {
    try {
        const parsed = new URL(value);
        if (!app.isPackaged) return parsed.origin === "http://localhost:5173" && parsed.pathname === "/";
        return parsed.protocol === "file:" && fileURLToPath(parsed) === path.join(__dirname, "../dist/index.html");
    } catch { return false; }
}
function secureHandle(channel, handler) {
    ipcMain.handle(channel, (event, ...args) => {
        const trusted = toolsOnlyChannels.has(channel) ? isTrustedToolsRenderer(event) : isTrustedRenderer(event);
        if (!trusted) return { success: false, error: "Unauthorized request" };
        if (!isValidIpcArguments(args)) return { success: false, error: "Invalid IPC payload" };
        return handler(event, ...args);
    });
}
function secureOn(channel, handler) {
    ipcMain.on(channel, (event, ...args) => {
        const trusted = toolsOnlyChannels.has(channel) ? isTrustedToolsRenderer(event) : isTrustedRenderer(event);
        if (!trusted) return;
        if (!isValidIpcArguments(args)) return;
        handler(event, ...args);
    });
}

function browserShortcutForInput(input) {
    if (!input || input.type !== "keyDown") return null;
    const key = String(input.key || "").toLowerCase();
    const control = Boolean(input.control || input.meta);
    const shift = Boolean(input.shift);
    if (control) {
        if (key === "t" && !shift) return "new-tab";
        if (key === "w" && !shift) return "close-tab";
        if (key === "t" && shift) return "reopen-tab";
        if (key === "l" && !shift) return "focus-address";
        if (key === "r") return shift ? "hard-reload" : "reload";
        if (key === "f" && !shift) return "find";
        if (key === "h" && !shift) return "history";
        if (key === "j" && !shift) return "downloads";
        if (key === "d" && !shift) return "bookmark";
        if (key === "tab") return shift ? "previous-tab" : "next-tab";
        if (/^[1-9]$/.test(key)) return `tab-${key}`;
    }
    if (input.alt && ["left", "arrowleft"].includes(key)) return "back";
    if (input.alt && ["right", "arrowright"].includes(key)) return "forward";
    if (key === "escape") return "escape";
    return null;
}

function forwardBrowserShortcuts(webContents) {
    webContents.on("before-input-event", (event, input) => {
        const action = browserShortcutForInput(input);
        if (!action || !mainWindow || mainWindow.isDestroyed()) return;
        event.preventDefault();
        mainWindow.webContents.send("browser:shortcut", action);
    });
}


function saveCurrentHistory(tab) {
    // Never save private browsing history.
    if (tab?.isPrivate) return;

    if (!tab || !tab.url || !isSafeUrl(tab.url)) return;

    try {
        database.addHistory(tab.title || "Untitled", tab.url);
    } catch (error) {
        console.error("History save error:", error);
    }
}



function getTabData() {
    return [...tabs.values()].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))).map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        loading: tab.loading,
        isPrivate: tab.isPrivate || false,
        pinned: Boolean(tab.pinned),
        muted: Boolean(tab.view.webContents.isAudioMuted?.()),
        audible: Boolean(tab.audible || tab.view.webContents.isCurrentlyAudible?.()),
        loadError: tab.loadError || null
    }));
}

function publishTabs() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send("browser:tabs-updated", {
        tabs: getTabData(),
        activeTabId,
        closedTabCount: closedTabs.length
    });
    if (database.getSettings().startupBehavior === "continue") {
        clearTimeout(sessionSaveTimer);
        sessionSaveTimer = setTimeout(() => {
            try {
                const openTabs = [...tabs.values()].filter(tab => !tab.isPrivate && (isSafeUrl(tab.url) || tab.url === NEW_TAB_URL));
                database.updateSettings({
                    lastSession: openTabs.map(tab => ({ url: tab.url, title: tab.title, pinned: Boolean(tab.pinned) })),
                    lastActiveTabIndex: openTabs.findIndex(tab => tab.id === activeTabId)
                });
            } catch (error) { console.error("Session snapshot save error:", error.message); }
        }, 800);
    }
}


function getTabIdFromWebContents(webContentsId) {
    for (const tab of tabs.values()) {
        if (tab.view.webContents.id === webContentsId) {
            return tab.id;
        }
    }

    return null;
}

function sanitizeHeaders(headers = {}) {
    const safeHeaders = {};

    for (const [key, value] of Object.entries(headers)) {
        if (/^(authorization|proxy-authorization|cookie|set-cookie)$/i.test(key)) {
            safeHeaders[key] = ["[REDACTED]"];
        } else {
            safeHeaders[key] = Array.isArray(value)
                ? value
                : [String(value)];
        }
    }

    return safeHeaders;
}


function extractRequestBody(uploadData = []) {
    if (!Array.isArray(uploadData) || uploadData.length === 0) {
        return null;
    }

    const chunks = [];

    for (const item of uploadData) {
        if (item.bytes) {
            chunks.push(Buffer.from(item.bytes));
        }
    }

    if (chunks.length === 0) {
        return null;
    }

    const buffer = Buffer.concat(chunks);

    return {
        text: buffer.subarray(0, 64 * 1024).toString("utf8"),
        truncated: buffer.length > 64 * 1024,
        size: buffer.length
    };
}



function getTimingDuration(start, end) {
    if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        start < 0 ||
        end < 0 ||
        end < start
    ) {
        return null;
    }

    return Number((end - start).toFixed(2));
}

function getTimingDuration(start, end) {
    if (
        typeof start !== "number" ||
        typeof end !== "number" ||
        start < 0 ||
        end < 0 ||
        end < start
    ) {
        return null;
    }

    return Number((end - start).toFixed(2));
}

function attachResponsePreview(webContents, tabId) {
    const debuggerSession = webContents.debugger;

    if (debuggerSession.isAttached()) {
        console.log("Debugger already attached for tab:", tabId);
        return;
    }

    const cdpRequests = new Map();

    function findNetworkEntry(request) {
        const candidates = [...networkRequests.values()].filter(item =>
            item.tabId === tabId &&
            item.url === request.url &&
            item.method === request.method &&
            !item.cdpRequestId
        );

        if (!candidates.length) return null;

        // CDP wallTime is Unix time in seconds.
        const requestWallTime = request.wallTime
            ? request.wallTime * 1000
            : Date.now();

        candidates.sort((a, b) =>
            Math.abs(a.startedAt - requestWallTime) -
            Math.abs(b.startedAt - requestWallTime)
        );

        return candidates[0];
    }

    try {
        debuggerSession.attach("1.3");

        debuggerSession.sendCommand("Network.enable", {
            maxTotalBufferSize: 5 * 1024 * 1024,
            maxResourceBufferSize: 2 * 1024 * 1024
        });

        debuggerSession.on("message", async (_event, method, params) => {
            if (method === "Network.requestWillBeSent") {
                const request = {
                    url: params.request.url,
                    method: params.request.method,
                    mimeType: "",
                    status: null,
                    requestTimestamp: params.timestamp,
                    wallTime: params.wallTime,
                    responseTimestamp: null,
                    timing: null,
                    entryKey: null
                };

                const entry = findNetworkEntry({
                    url: request.url,
                    method: request.method,
                    wallTime: params.wallTime
                });

                if (entry) {
                    request.entryKey = entry.id;
                    entry.cdpRequestId = params.requestId;
                }

                cdpRequests.set(params.requestId, request);
            }

            if (method === "Network.responseReceived") {
                const request = cdpRequests.get(params.requestId);

                if (!request) return;

                request.mimeType = params.response.mimeType || "";
                request.status = params.response.status;
                request.responseTimestamp = params.timestamp;

                const rawTiming = params.response.timing;

                if (rawTiming) {
                    request.timing = {
                        dns: getTimingDuration(
                            rawTiming.dnsStart,
                            rawTiming.dnsEnd
                        ),
                        tcp: getTimingDuration(
                            rawTiming.connectStart,
                            rawTiming.connectEnd
                        ),
                        ssl: getTimingDuration(
                            rawTiming.sslStart,
                            rawTiming.sslEnd
                        ),
                        send: getTimingDuration(
                            rawTiming.sendStart,
                            rawTiming.sendEnd
                        ),
                        ttfb: getTimingDuration(
                            rawTiming.sendEnd,
                            rawTiming.receiveHeadersEnd
                        ),
                        responseTransfer: null,
                        total: null
                    };
                }

                if (!request.entryKey) {
                    const matchedEntry = findNetworkEntry({
                        url: request.url,
                        method: request.method,
                        wallTime: request.wallTime
                    });

                    if (matchedEntry) {
                        request.entryKey = matchedEntry.id;
                        matchedEntry.cdpRequestId = params.requestId;
                    }
                }

                if (!request.entryKey) {
                    const matchedEntry = findNetworkEntry({
                        url: request.url,
                        method: request.method,
                        wallTime: request.wallTime
                    });

                    if (matchedEntry) {
                        request.entryKey = matchedEntry.id;
                        matchedEntry.cdpRequestId = params.requestId;
                    }
                }

                const entry = request.entryKey
                    ? networkRequests.get(request.entryKey)
                    : null;

                if (entry) {
                    entry.timing = request.timing;
                    entry.protocol = params.response.protocol || null;
                    entry.connectionReused =
                        params.response.connectionReused ?? null;

                    publishNetworkUpdate(entry);
                }
            }

            if (method === "Network.loadingFinished") {
                const request = cdpRequests.get(params.requestId);

                if (!request) return;

                let entry = request.entryKey
                    ? networkRequests.get(request.entryKey)
                    : null;

                // Retry matching when the initial CDP request
                // could not be linked to a webRequest entry.
                if (!entry) {
                    entry = findNetworkEntry({
                        url: request.url,
                        method: request.method,
                        wallTime: request.wallTime
                    });

                    if (entry) {
                        request.entryKey = entry.id;
                        entry.cdpRequestId = params.requestId;
                    }
                }

                if (entry) {
                    if (!request.timing) {
                        request.timing = {
                            dns: null,
                            tcp: null,
                            ssl: null,
                            send: null,
                            ttfb: null,
                            responseTransfer: null,
                            total: null
                        };
                    }

                    if (request.responseTimestamp !== null) {
                        request.timing.responseTransfer = Number(
                            Math.max(
                                0,
                                (params.timestamp - request.responseTimestamp) * 1000
                            ).toFixed(2)
                        );
                    }

                    if (typeof request.requestTimestamp === "number") {
                        request.timing.total = Number(
                            Math.max(
                                0,
                                (params.timestamp - request.requestTimestamp) * 1000
                            ).toFixed(2)
                        );
                    }

                    entry.timing = request.timing;
                    entry.transferSize =
                        Number.isFinite(params.encodedDataLength) &&
                            params.encodedDataLength >= 0
                            ? params.encodedDataLength
                            : null;

                    publishNetworkUpdate(entry);
                }

                try {
                    const contentType = request.mimeType.toLowerCase();

                    const isTextResponse =
                        contentType.includes("json") ||
                        contentType.includes("text") ||
                        contentType.includes("javascript") ||
                        contentType.includes("xml") ||
                        contentType.includes("html") ||
                        contentType.includes("svg");

                    if (!isTextResponse) {
                        cdpRequests.delete(params.requestId);
                        return;
                    }

                    const result = await debuggerSession.sendCommand(
                        "Network.getResponseBody",
                        { requestId: params.requestId }
                    );

                    let bodyBuffer = result.base64Encoded
                        ? Buffer.from(result.body, "base64")
                        : Buffer.from(result.body, "utf8");

                    const MAX_PREVIEW_SIZE = 256 * 1024;
                    const truncated = bodyBuffer.length > MAX_PREVIEW_SIZE;

                    if (truncated) {
                        bodyBuffer = bodyBuffer.subarray(0, MAX_PREVIEW_SIZE);
                    }

                    const responseText = bodyBuffer.toString("utf8");

                    if (entry) {
                        entry.responseBody = {
                            text: responseText,
                            mimeType: request.mimeType,
                            size: result.base64Encoded
                                ? Buffer.from(result.body, "base64").length
                                : Buffer.byteLength(result.body, "utf8"),
                            truncated,
                            base64Encoded: false
                        };

                        publishNetworkUpdate(entry);
                    }
                } catch (error) {
                    console.warn(
                        "Response preview unavailable:",
                        error.message
                    );
                } finally {
                    cdpRequests.delete(params.requestId);
                }
            }

            if (method === "Network.loadingFailed") {
                const request = cdpRequests.get(params.requestId);

                if (request?.entryKey) {
                    const entry = networkRequests.get(request.entryKey);

                    if (entry) {
                        entry.timingError = params.errorText || "Request failed";
                        publishNetworkUpdate(entry);
                    }
                }

                cdpRequests.delete(params.requestId);
            }
        });

        debuggerSession.on("detach", () => {
            cdpRequests.clear();
        });

        console.log("Network timing and response preview enabled for tab:", tabId);

    } catch (error) {
        console.error(
            "Unable to attach response preview:",
            error.message
        );
    }
}

function publishNetworkUpdate(entry) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send("browser:network-updated", {
        ...entry
    });
}

function getDownloadSnapshot(download) {
    const item = download.item;

    let receivedBytes = download.receivedBytes || 0;
    let totalBytes = download.totalBytes || 0;
    let filePath = download.filePath || "";

    try {
        receivedBytes = item.getReceivedBytes();
        totalBytes = item.getTotalBytes();
        filePath = item.getSavePath() || filePath;
    } catch {
        // DownloadItem may no longer be available.
    }

    const percent = totalBytes > 0
        ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
        : null;

    return {
        id: download.id,
        filename: download.filename,
        url: download.url,
        mimeType: download.mimeType,
        tabId: download.tabId,
        state: download.state,
        receivedBytes,
        totalBytes,
        percent,
        speed: download.speed || 0,
        paused: download.paused || false,
        canResume: download.canResume || false,
        filePath,
        downloadDirectory: download.downloadDirectory || app.getPath("downloads"),
        isPrivate: Boolean(download.isPrivate),
        startedAt: download.startedAt,
        completedAt: download.completedAt ?? null,
        error: download.error || null
    };
}

function publishDownloads() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const privateVisible = Boolean(tabs.get(activeTabId)?.isPrivate);
    const items = [...downloads.values()]
        .filter(download => !download.isPrivate || privateVisible)
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(getDownloadSnapshot);

    mainWindow.webContents.send("downloads:updated", items);
}

function setupDownloadManager(downloadSession = session.defaultSession, isPrivate = false) {
    if (configuredDownloadSessions.has(downloadSession)) return;
    configuredDownloadSessions.add(downloadSession);

    downloadSession.setDownloadPath(getDownloadDirectory());

    downloadSession.on("will-download", (event, item, webContents) => {

        if (!isSafeUrl(item.getURL())) { event.preventDefault(); return; }

        const sourceUrl = webContents?.getURL() || "";
        const sourceOrigin = isSafeUrl(sourceUrl) ? new URL(sourceUrl).origin : null;
        const downloadDecision = sourceOrigin && (isPrivate
            ? privatePermissionDecisions.get(`${sourceOrigin}|downloads`)
            : database.getWebsitePermissions().find(entry => entry.origin === sourceOrigin && entry.permission === "downloads")?.decision);
        if (downloadDecision === "denied") {
            event.preventDefault();
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:popup-blocked", { tabId: getTabIdFromWebContents(webContents?.id), origin: sourceOrigin, kind: "download" });
            return;
        }
        if (isPrivate && downloadDecision !== "granted" && sourceOrigin) {
            if (!mainWindow || mainWindow.isDestroyed()) { event.preventDefault(); return; }
            item.pause();
            dialog.showMessageBox(mainWindow, {
                type: "question",
                title: "Allow private download?",
                message: `${sourceOrigin} wants to download a file in this private session.`,
                detail: "This choice will not be saved. The downloaded file will remain on disk after the private session closes.",
                buttons: ["Block", "Allow once"],
                defaultId: 0,
                cancelId: 0,
                noLink: true
            }).then(result => result.response === 1 ? item.resume() : item.cancel()).catch(() => item.cancel());
        } else if (!isPrivate && downloadDecision !== "granted" && sourceOrigin) {
            if (!mainWindow || mainWindow.isDestroyed()) { event.preventDefault(); return; }
            item.pause();
            dialog.showMessageBox(mainWindow, {
                type: "question",
                title: "Allow website download?",
                message: `${sourceOrigin} wants to download a file.`,
                detail: item.getFilename(),
                buttons: ["Block once", "Allow once", "Always allow", "Always block"],
                defaultId: 0,
                cancelId: 0,
                noLink: true
            }).then(result => {
                if (result.response === 2) database.setWebsitePermission(sourceOrigin, "downloads", "granted");
                if (result.response === 3) database.setWebsitePermission(sourceOrigin, "downloads", "denied");
                if (result.response === 1 || result.response === 2) item.resume();
                else item.cancel();
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("permissions:updated", database.getWebsitePermissions());
            }).catch(() => item.cancel());
        } else if (!sourceOrigin) {
            event.preventDefault();
            return;
        }

        // Automatically save downloads without showing Save As dialog
        const downloadsFolder = getDownloadDirectory();

        const originalName = safeDownloadFilename(item.getFilename());
        const parsedName = path.parse(originalName);

        let savePath = path.join(downloadsFolder, originalName);
        let counter = 1;

        while (require("fs").existsSync(savePath) || reservedDownloadPaths.has(path.resolve(savePath))) {
            savePath = path.join(
                downloadsFolder,
                `${parsedName.name} (${counter})${parsedName.ext}`
            );
            counter++;
        }

        item.setSavePath(savePath);
        reservedDownloadPaths.add(path.resolve(savePath));


        const id = randomUUID();
        const now = Date.now();

        const download = {
            id,
            item,
            filename: originalName,
            url: item.getURL(),
            mimeType: item.getMimeType(),
            tabId: webContents
                ? getTabIdFromWebContents(webContents.id)
                : null,
            state: "progressing",
            receivedBytes: 0,
            totalBytes: item.getTotalBytes(),
            speed: 0,
            lastBytes: 0,
            lastUpdate: now,
            paused: false,
            canResume: false,
            filePath: "",
            downloadDirectory: downloadsFolder,
            isPrivate,
            startedAt: now,
            completedAt: null,
            error: null
        };

        downloads.set(id, download);

        if (!isPrivate) database.saveDownload(getDownloadSnapshot(download));

        publishDownloads();

        item.on("updated", (_, state) => {
            const currentTime = Date.now();
            const received = item.getReceivedBytes();

            const elapsedSeconds = (currentTime - download.lastUpdate) / 1000;

            if (elapsedSeconds > 0) {
                download.speed = Math.max(
                    0,
                    Math.round((received - download.lastBytes) / elapsedSeconds)
                );
            }

            download.receivedBytes = received;
            download.totalBytes = item.getTotalBytes();
            download.lastBytes = received;
            download.lastUpdate = currentTime;
            download.filePath = item.getSavePath() || download.filePath;
            download.paused = item.isPaused();
            download.canResume = item.canResume();

            if (state === "interrupted") {
                download.state = "interrupted";
            } else {
                download.state = download.paused ? "paused" : "progressing";
            }

            publishDownloads();
        });


        item.once("done", (_, state) => {
            reservedDownloadPaths.delete(path.resolve(savePath));
            download.state = state;
            download.receivedBytes = item.getReceivedBytes();
            download.totalBytes = item.getTotalBytes();
            download.filePath = item.getSavePath() || download.filePath;
            download.paused = false;
            download.canResume = item.canResume();
            download.completedAt = Date.now();

            if (state === "interrupted") {
                download.error = "Download interrupted";
            }

            if (!isPrivate) database.saveDownload(getDownloadSnapshot(download));
            publishDownloads();

            if (isPrivate) return;

            // Native desktop notification
            const { Notification, shell } = require("electron");

            if (Notification.isSupported()) {
                let title = "";
                let body = "";

                if (state === "completed") {
                    title = "Download Completed";
                    body = `${download.filename} has been downloaded successfully.`;
                } else if (state === "interrupted") {
                    title = "Download Failed";
                    body = `${download.filename} could not be downloaded.`;
                }

                if (title) {
                    if (database.getSettings().downloadNotifications === false) return;
                    const notification = new Notification({
                        title,
                        body,
                        silent: false
                    });

                    notification.on("click", () => {
                        if (state === "completed" && download.filePath && isWithinDirectory(download.downloadDirectory || app.getPath("downloads"), download.filePath)) {
                            shell.openPath(download.filePath);
                        }
                    });

                    notification.show();
                }
            }
        });

    });
}

function setupNetworkMonitoring() {
    if (networkMonitoringInitialized) return;

    networkMonitoringInitialized = true;

    const webRequest = session.defaultSession.webRequest;

    // 1. Capture new requests
    webRequest.onBeforeRequest(
        { urls: ["<all_urls>"] },
        (details, callback) => {
            if (blockedRequestUrls.has(details.url)) {
                callback({ cancel: true });
                return;
            }
            const tabId = getTabIdFromWebContents(details.webContentsId);

            if (tabId) {
                const key = `${details.webContentsId}:${details.id}`;

                const entry = {
                    id: key,
                    tabId,
                    url: details.url,
                    method: details.method,
                    resourceType: details.resourceType,
                    requestBody: extractRequestBody(details.uploadData),
                    status: "Pending",
                    statusText: "",
                    requestHeaders: {},
                    responseHeaders: {},
                    startedAt: Date.now(),
                    duration: null,
                    error: null
                };

                networkRequests.set(key, entry);

                while (networkRequests.size > MAX_NETWORK_REQUESTS) {
                    const oldestKey = networkRequests.keys().next().value;
                    networkRequests.delete(oldestKey);
                }

                publishNetworkUpdate(entry);
            }

            callback({ cancel: false });
        }
    );

    // 2. Capture request headers
    webRequest.onBeforeSendHeaders(
        { urls: ["<all_urls>"] },
        (details, callback) => {
            const key = `${details.webContentsId}:${details.id}`;
            const entry = networkRequests.get(key);

            if (entry) {
                entry.requestHeaders = sanitizeHeaders(
                    details.requestHeaders
                );

                publishNetworkUpdate(entry);
            }

            callback({
                requestHeaders: details.requestHeaders
            });
        }
    );

    // 3. Capture response headers
    webRequest.onHeadersReceived(
        { urls: ["<all_urls>"] },
        (details, callback) => {
            const key = `${details.webContentsId}:${details.id}`;
            const entry = networkRequests.get(key);

            if (entry) {
                entry.responseHeaders = sanitizeHeaders(
                    details.responseHeaders
                );

                entry.status = details.statusCode;
                entry.statusText = details.statusLine || "";

                publishNetworkUpdate(entry);
            }

            callback({
                responseHeaders: details.responseHeaders
            });
        }
    );

    // 4. Capture completed requests
    webRequest.onCompleted(
        { urls: ["<all_urls>"] },
        (details) => {
            const key = `${details.webContentsId}:${details.id}`;
            const entry = networkRequests.get(key);

            if (!entry) return;

            entry.status = details.statusCode;
            entry.statusText = details.statusLine || "";
            entry.duration = Math.max(
                0,
                Date.now() - entry.startedAt
            );
            entry.responseHeaders = sanitizeHeaders(
                details.responseHeaders
            );
            entry.state = "completed";

            publishNetworkUpdate(entry);
        }
    );

    // 5. Capture failed requests
    webRequest.onErrorOccurred(
        { urls: ["<all_urls>"] },
        (details) => {
            const key = `${details.webContentsId}:${details.id}`;
            const entry = networkRequests.get(key);

            if (!entry) return;

            entry.status = "Failed";
            entry.error = details.error;
            entry.duration = Math.max(
                0,
                Date.now() - entry.startedAt
            );
            entry.state = "failed";

            publishNetworkUpdate(entry);
        }
    );
}


function publishConsoleMessage(tab, message) {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const level = typeof message.level === "number"
        ? ({ 0: "log", 1: "warning", 2: "error", 3: "verbose" }[message.level] || "log")
        : String(message.level || "log").toLowerCase();

    mainWindow.webContents.send("browser:console-message", {
        tabId: tab.id,
        level,
        message: String(message.message || "").slice(0, 10000),
        source: String(message.sourceId || "").slice(0, 2000),
        lineNumber: Number(message.lineNumber) || 0,
        timestamp: new Date().toISOString()
    });
}

function updateActiveBounds() {
    const activeTab = tabs.get(activeTabId);
    if (activeTab) {
        activeTab.view.setBounds(
            responsiveModeActive && responsiveViewBounds
                ? responsiveViewBounds
                : viewBounds
        );
    }
}

function createTab(url = null, isPrivate = false, options = {}) {
    const settings = database.getSettings();

    const homepage = isSafeUrl(settings.homepage)
        ? settings.homepage
        : "https://www.google.com";

    const targetUrl = url === NEW_TAB_URL || url === null ? NEW_TAB_URL : (isSafeUrl(url) ? url : homepage);

    const id = randomUUID();
    const view = new WebContentsView({
        webPreferences: {
            ...(isPrivate ? { partition: "incognito" } : {}),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    const tab = {
        id,
        view,
        title: "New Tab",
        url: targetUrl,
        loading: targetUrl !== NEW_TAB_URL,
        isPrivate,
        pinned: Boolean(options.pinned && !isPrivate),
        audible: false
    };

    tabs.set(id, tab);
    if (isPrivate) {
        const privateSession = session.fromPartition("incognito");
        configurePermissionSession(privateSession, true);
        setupDownloadManager(privateSession, true);
    }
    attachResponsePreview(tab.view.webContents, id);

    if (activeTabId) {
        const previous = tabs.get(activeTabId);
        if (previous) {
            mainWindow.contentView.removeChildView(previous.view);
        }
    }

    activeTabId = id;
    mainWindow.contentView.addChildView(view);
    updateActiveBounds();

    const wc = view.webContents;
    forwardBrowserShortcuts(wc);

    wc.on("will-navigate", (event, destination, _isInPlace, legacyIsMainFrame) => {
        if (shouldBlockWebsiteNavigation(event.url || destination, event.isMainFrame ?? legacyIsMainFrame)) event.preventDefault();
    });
    wc.on("will-redirect", (event, destination, _isInPlace, legacyIsMainFrame) => {
        if (shouldBlockWebsiteNavigation(event.url || destination, event.isMainFrame ?? legacyIsMainFrame)) event.preventDefault();
    });

    // Capture webpage console messages
    wc.on("console-message", (event) => {
        publishConsoleMessage(tab, {
            level: event.level,
            message: event.message,
            sourceId: event.sourceId,
            lineNumber: event.lineNumber
        });
    });

    wc.setWindowOpenHandler(({ url }) => {
        if (!isSafeUrl(url)) return { action: "deny" };
        const currentUrl = wc.getURL() || tab.url;
        if (!isSafeUrl(currentUrl)) return { action: "deny" };
        const origin = new URL(currentUrl).origin;
        const storedDecision = isPrivate
            ? privatePermissionDecisions.get(`${origin}|popups`)
            : database.getWebsitePermissions().find(item => item.origin === origin && item.permission === "popups")?.decision;
        const allowed = storedDecision ? storedDecision === "granted" : database.getSettings().openPopupsInNewTabs !== false;
        if (allowed) {
            createTab(url, isPrivate);
        } else if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("browser:popup-blocked", { tabId: tab.id, origin, url });
        }

        return { action: "deny" };
    });

    wc.on("page-title-updated", (_, title) => {
        tab.title = title || "Untitled";
        publishTabs();
    });

    wc.on("audio-state-changed", (_, state) => {
        tab.audible = Boolean(state?.audible);
        publishTabs();
    });

    wc.on("found-in-page", (_, result) => {
        if (tab.findRequestId !== result.requestId || !mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send("browser:find-result", {
            tabId: tab.id,
            activeMatchOrdinal: result.activeMatchOrdinal,
            matches: result.matches,
            finalUpdate: result.finalUpdate
        });
    });

    wc.on("did-start-loading", () => {
        tab.loading = true;
        tab.loadError = null;
        publishTabs();
    });

    wc.on("did-stop-loading", () => {
        tab.loading = false;
        tab.url = wc.getURL();
        tab.title = wc.getTitle() || tab.title;

        publishTabs();
    });

    // Handle webpage loading errors

    wc.on("did-fail-load", (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;

        // Ignore aborted navigation
        if (errorCode === -3) {
            if (!wc.isLoading()) { tab.loading = false; publishTabs(); }
            return;
        }

        tab.loading = false;

        tab.loadError = {
            code: errorCode,
            description: errorDescription,
            url: validatedURL
        };

        console.error("Page failed to load:", { errorCode, errorDescription });

        publishTabs();
    });

    wc.on("render-process-gone", (_, details) => {
        tab.loading = false;
        tab.loadError = {
            code: "RENDER_PROCESS_GONE",
            description: details?.reason ? `The page process exited (${details.reason}).` : "The page process exited unexpectedly.",
            url: wc.getURL()
        };
        publishTabs();
    });


    wc.on("did-navigate", (_, url) => {
        tab.url = url;
        saveCurrentHistory(tab);
        publishTabs();
    });

    wc.on("did-navigate-in-page", (_, url) => {
        tab.url = url;
        saveCurrentHistory(tab);
        publishTabs();
    });

    if (targetUrl !== NEW_TAB_URL) {
        const startLoad = () => { if (!wc.isDestroyed()) wc.loadURL(targetUrl).catch(() => console.error("Page loading error")); };
        if (Number.isFinite(options.loadDelay) && options.loadDelay > 0) setTimeout(startLoad, options.loadDelay);
        else startLoad();
    }

    publishTabs();
    return id;
}

function configurePermissionSession(targetSession, isPrivate = false) {
    if (targetSession.__devflowPermissionsConfigured) return;
    targetSession.__devflowPermissionsConfigured = true;
    const resolve = (origin, permission) => {
        if (!SUPPORTED_SITE_PERMISSIONS.has(permission)) return "denied";
        if (isPrivate) return privatePermissionDecisions.get(`${origin}|${permission}`) || "ask";
        return database.getWebsitePermissions().find(item => item.origin === origin && item.permission === permission)?.decision || "ask";
    };
    targetSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
        try { return isSafeUrl(requestingOrigin) && new URL(requestingOrigin).origin === requestingOrigin && resolve(requestingOrigin, permission) === "granted"; }
        catch { return false; }
    });
    targetSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
        const requestingUrl = details?.requestingUrl || wc.getURL();
        let origin;
        try {
            const requesting = new URL(requestingUrl);
            if (!isSafeUrl(requestingUrl)) { callback(false); return; }
            origin = requesting.origin;
        } catch { callback(false); return; }
        const decision = resolve(origin, permission);
        if (decision !== "ask") { callback(decision === "granted"); return; }
        if (!SUPPORTED_SITE_PERMISSIONS.has(permission) || !mainWindow || mainWindow.isDestroyed()) { callback(false); return; }
        let result;
        try { result = await dialog.showMessageBox(mainWindow, {
            type: "question",
            title: "Website permission request",
            message: `${origin} wants to access ${permission}.`,
            detail: isPrivate ? "Private session: this choice will not be saved." : "Choose Allow to grant this permission for this site. You can change it later in Site Permissions.",
            buttons: ["Deny", "Allow"],
            defaultId: 0,
            cancelId: 0,
            noLink: true
        }); } catch { callback(false); return; }
        const chosen = result.response === 1 ? "granted" : "denied";
        if (isPrivate) privatePermissionDecisions.set(`${origin}|${permission}`, chosen);
        else database.setWebsitePermission(origin, permission, chosen);
        callback(chosen === "granted");
        if (!isPrivate) mainWindow.webContents.send("permissions:updated", database.getWebsitePermissions());
    });
}

function switchTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;

    const previous = tabs.get(activeTabId);

    if (previous && previous.id !== id) {
        mainWindow.contentView.removeChildView(previous.view);
    }

    activeTabId = id;
    mainWindow.contentView.addChildView(tab.view);
    updateActiveBounds();

    publishTabs();
    publishDownloads();
}


async function closeTab(id, explicitlyClosePinned = false) {
    const tab = tabs.get(id);
    if (!tab || (tab.pinned && !explicitlyClosePinned)) return false;

    const activeTabDownloads = [...downloads.values()].filter(item => item.tabId === id && ["progressing", "paused"].includes(item.state));
    if (activeTabDownloads.length && mainWindow && !mainWindow.isDestroyed()) {
        const confirmation = await dialog.showMessageBox(mainWindow, {
            type: "warning",
            message: "This tab has active downloads.",
            detail: "Closing the tab will not cancel them. Continue?",
            buttons: ["Keep tab open", "Close tab"],
            defaultId: 0,
            cancelId: 0,
            noLink: true
        });
        if (confirmation.response !== 1) return false;
    }

    const wasActive = activeTabId === id;
    const wasPrivate = tab.isPrivate;
    if (!wasPrivate && isSafeUrl(tab.url)) {
        closedTabs.unshift({ url: tab.url, title: tab.title, pinned: Boolean(tab.pinned) });
        closedTabs.splice(10);
        database.updateSettings({ recentlyClosedTabs: closedTabs });
    }

    if (wasActive) {
        mainWindow.contentView.removeChildView(tab.view);
    }

    tab.view.webContents.close();
    tabs.delete(id);

    // Clear private session when the last private tab is closed
    if (wasPrivate) {
        const hasPrivateTabs = [...tabs.values()].some(
            (item) => item.isPrivate
        );

        if (!hasPrivateTabs) {
            privatePermissionDecisions.clear();
            for (const [downloadId, download] of downloads.entries()) {
                if (!download.isPrivate) continue;
                if (["progressing", "paused"].includes(download.state)) {
                    try { download.item?.cancel(); } catch { /* The private download may already have stopped. */ }
                }
                downloads.delete(downloadId);
            }
            try {
                const privateSession = session.fromPartition("incognito");

                await privateSession.clearStorageData();
                await privateSession.clearCache();

                console.log("Incognito session data cleared");
            } catch (error) {
                console.error("Incognito cleanup error:", error);
            }
            publishDownloads();
        }
    }

    if (tabs.size === 0) {
        createTab();
        return true;
    }

    if (wasActive) {
        const nextId = [...tabs.keys()][0];
        switchTab(nextId);
    } else {
        publishTabs();
    publishDownloads();
    }
    return true;
}

async function closeOtherTabs(keepId) {
    if (!tabs.has(keepId)) return;
    for (const id of [...tabs.keys()]) {
        if (id !== keepId && !tabs.get(id)?.pinned) await closeTab(id);
    }
}

async function closeTabsToRight(targetId) {
    const orderedTabs = getTabData();
    const index = orderedTabs.findIndex(tab => tab.id === targetId);
    if (index < 0) return;
    for (const item of orderedTabs.slice(index + 1)) {
        if (!tabs.get(item.id)?.pinned) await closeTab(item.id);
    }
}

function reloadTab(id) {
    const tab = tabs.get(id);
    const wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    wc.reload();
    return true;
}

function setTabMuted(id, muted) {
    const tab = tabs.get(id);
    const wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed()) return false;
    wc.setAudioMuted(muted);
    publishTabs();
    return true;
}


function createWindow() {
    configurePermissionSession(session.defaultSession, false);
    const initialTheme = database.getSettings().theme === "light" ? "light" : "dark";
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1000,
        minHeight: 650,
        title: "DevFlow",
        backgroundColor: initialTheme === "light" ? "#f5f7fb" : "#0d1117",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            additionalArguments: [`--devflow-theme=${initialTheme}`],
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            webviewTag: false
        }
    });

    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url, _isInPlace, legacyIsMainFrame) => {
        if ((event.isMainFrame ?? legacyIsMainFrame) && !isDevFlowAppUrl(event.url || url)) event.preventDefault();
    });
    mainWindow.webContents.on("will-redirect", (event, url, _isInPlace, legacyIsMainFrame) => {
        if ((event.isMainFrame ?? legacyIsMainFrame) && !isDevFlowAppUrl(event.url || url)) event.preventDefault();
    });

    createToolsMenuWindow();


    mainWindow.on("close", () => {
        const settings = database.getSettings();
        const openTabs = Array.from(tabs.values()).filter(tab => !tab.isPrivate && (isSafeUrl(tab.url) || tab.url === NEW_TAB_URL));
        const activeIndex = openTabs.findIndex(tab => tab.id === activeTabId);
        database.updateSettings({
            pinnedTabs: [...new Map(openTabs.filter(tab => tab.pinned && isSafeUrl(tab.url)).map(tab => [tab.url, { url: tab.url, title: tab.title }])).values()],
            ...(settings.startupBehavior === "continue" ? {
                lastSession: openTabs.map(tab => ({ url: tab.url, title: tab.title, pinned: Boolean(tab.pinned) })),
                lastActiveTabIndex: activeIndex
            } : {})
        });
    });


    mainWindow.on("resize", () => {
        if (!responsiveModeActive) {
            const contentBounds = mainWindow.getContentBounds();

            viewBounds.width = Math.max(
                0,
                contentBounds.width - viewBounds.x
            );

            viewBounds.height = Math.max(
                0,
                contentBounds.height - viewBounds.y
            );
        }

        updateActiveBounds();

        mainWindow.webContents.send("browser:window-resized");
    });


    if (!app.isPackaged) {
        mainWindow.loadURL("http://localhost:5173");
    } else {
        mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }

    mainWindow.webContents.on("did-finish-load", () => {
        publishTabs();
    });

    const settings = database.getSettings();

    const pinnedTabs = Array.isArray(settings.pinnedTabs) ? settings.pinnedTabs.filter(item => item && isSafeUrl(item.url)).slice(0, 8) : [];
    const pinnedIdsByUrl = new Map();
    for (const [index, item] of pinnedTabs.entries()) {
        if (!pinnedIdsByUrl.has(item.url)) pinnedIdsByUrl.set(item.url, createTab(item.url, false, { pinned: true, loadDelay: index * 220 }));
    }

    if (
        settings.startupBehavior === "continue" &&
        Array.isArray(settings.lastSession) &&
        settings.lastSession.length > 0
    ) {
        const restoredIds = [];
        const restoredByUrl = new Map();
        for (const saved of settings.lastSession.slice(0, 15)) {
            const url = typeof saved === "string" ? saved : saved?.url;
            if (!(isSafeUrl(url) || url === NEW_TAB_URL)) { restoredIds.push(null); continue; }
            if (pinnedIdsByUrl.has(url)) { restoredIds.push(pinnedIdsByUrl.get(url)); continue; }
            if (restoredByUrl.has(url)) { restoredIds.push(restoredByUrl.get(url)); continue; }
            const id = createTab(url, false, { pinned: Boolean(typeof saved === "object" && saved.pinned), loadDelay: (pinnedTabs.length + restoredIds.length) * 220 });
            restoredByUrl.set(url, id);
            restoredIds.push(id);
        }
        const lastActive = Number.isInteger(settings.lastActiveTabIndex) ? restoredIds[settings.lastActiveTabIndex] : null;
        if (lastActive && tabs.has(lastActive)) switchTab(lastActive);
        else if (restoredIds.some(Boolean)) switchTab([...restoredIds].reverse().find(Boolean));
        else createTab(NEW_TAB_URL);
    } else if (settings.startupBehavior === "newtab") {
        createTab(NEW_TAB_URL);
    } else {
        const homepage = isSafeUrl(settings.homepage)
            ? settings.homepage
            : "https://www.google.com";

        createTab(homepage);
    }
    mainWindow.on("closed", () => {
        mainWindow = null;
        tabs.clear();
        activeTabId = null;
    });
}

function encryptAuthConfig(config) {
    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure credential storage is unavailable");
    }

    return safeStorage
        .encryptString(JSON.stringify(config))
        .toString("base64");
}

function decryptAuthConfig(encrypted) {
    if (!encrypted) return {};

    if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Secure credential storage is unavailable");
    }

    const buffer = Buffer.from(encrypted, "base64");

    return JSON.parse(safeStorage.decryptString(buffer));
}

// Browser IPC

secureHandle("browser:create-tab", (event, url) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request" };
    return createTab(url == null ? NEW_TAB_URL : (isSafeUrl(url) ? url : NEW_TAB_URL));
});

secureHandle("browser:duplicate-tab", (event, id) => {
    if (!isTrustedRenderer(event) || typeof id !== "string") return { success: false, error: "Invalid tab" };
    const tab = tabs.get(id);
    if (!tab) return { success: false, error: "Tab no longer exists" };
    return { success: true, id: createTab(tab.url === NEW_TAB_URL ? NEW_TAB_URL : tab.url, tab.isPrivate) };
});

secureHandle("browser:open-blocked-popup", (event, data) => {
    if (!isTrustedRenderer(event) || !data || typeof data.tabId !== "string" || typeof data.url !== "string" || data.url.length > 2048 || !isSafeUrl(data.url)) return { success: false, error: "Invalid popup destination" };
    const source = tabs.get(data.tabId);
    if (!source) return { success: false, error: "Source tab no longer exists" };
    return { success: true, id: createTab(data.url, Boolean(source.isPrivate)) };
});

secureHandle("browser:reopen-closed-tab", (event) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request" };
    const item = closedTabs.shift();
    database.updateSettings({ recentlyClosedTabs: closedTabs });
    return item ? { success: true, id: createTab(item.url, false, { pinned: item.pinned }) } : { success: false, error: "No recently closed tab" };
});

secureHandle("browser:set-tab-pinned", (event, data) => {
    if (!isTrustedRenderer(event) || !data || typeof data.id !== "string" || typeof data.pinned !== "boolean") return { success: false, error: "Invalid pin request" };
    const tab = tabs.get(data.id);
    if (!tab) return { success: false, error: "Tab no longer exists" };
    if (data.pinned && (tab.isPrivate || !isSafeUrl(tab.url))) return { success: false, error: "Only normal website tabs can be pinned" };
    tab.pinned = data.pinned;
    const pinnedTabs = [...new Map([...tabs.values()].filter(item => item.pinned && !item.isPrivate && isSafeUrl(item.url)).map(item => [item.url, { url: item.url, title: item.title }])).values()];
    database.updateSettings({ pinnedTabs });
    publishTabs();
    return { success: true };
});

secureHandle("browser:close-pinned-tab", async (event, id) => {
    if (!isTrustedRenderer(event) || typeof id !== "string" || !tabs.get(id)?.pinned) return { success: false, error: "Invalid pinned tab" };
    return { success: await closeTab(id, true) };
});

secureHandle("browser:close-other-tabs", async (event, id) => {
    if (!isTrustedRenderer(event) || typeof id !== "string" || !tabs.has(id)) return { success: false, error: "Invalid tab" };
    await closeOtherTabs(id);
    return { success: true };
});

secureHandle("browser:close-tabs-right", async (event, id) => {
    if (!isTrustedRenderer(event) || typeof id !== "string" || !tabs.has(id)) return { success: false, error: "Invalid tab" };
    await closeTabsToRight(id);
    return { success: true };
});

secureHandle("browser:reload-tab", (event, id) => {
    if (!isTrustedRenderer(event) || typeof id !== "string") return { success: false, error: "Invalid tab" };
    return reloadTab(id) ? { success: true } : { success: false, error: "Tab no longer exists" };
});

secureHandle("browser:toggle-tab-mute", (event, id) => {
    if (!isTrustedRenderer(event) || typeof id !== "string") return { success: false, error: "Invalid tab" };
    const tab = tabs.get(id);
    const wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed()) return { success: false, error: "Tab no longer exists" };
    const muted = !wc.isAudioMuted();
    return { success: setTabMuted(id, muted), muted };
});

secureHandle("browser:search-suggestions", async (event, data) => {
    if (!isTrustedRenderer(event) || !data || typeof data.query !== "string" || data.query.length > 100 || !["google", "bing", "duckduckgo"].includes(data.engine)) return { success: false, error: "Invalid suggestion request", suggestions: [] };
    const query = data.query.trim();
    if (!query) return { success: true, suggestions: [] };
    const endpoints = {
        google: `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`,
        bing: `https://api.bing.com/osjson.aspx?query=${encodeURIComponent(query)}`,
        duckduckgo: `https://duckduckgo.com/ac/?q=${encodeURIComponent(query)}&type=list`
    };
    try {
        const response = await net.fetch(endpoints[data.engine]);
        if (!response.ok) throw new Error("Suggestion service unavailable");
        const body = await response.json();
        const values = data.engine === "duckduckgo" ? body.map(item => item.phrase) : body[1];
        return { success: true, suggestions: (Array.isArray(values) ? values : []).filter(value => typeof value === "string").slice(0, 8) };
    } catch { return { success: false, suggestions: [], error: "Search suggestions are unavailable." }; }
});

secureHandle("browser:create-private-tab", (_, url) => {
    return createTab(
        isSafeUrl(url) ? url : "https://www.google.com",
        true
    );
});

secureHandle("db:add-bookmark", (_, data) => {
    if (
        !data ||
        typeof data.title !== "string" ||
        typeof data.url !== "string" ||
        data.title.length > 500 ||
        data.url.length > 2048 ||
        !isSafeUrl(data.url)
    ) return { success: false };

    try {
        database.addBookmark(data.title, data.url);
        return { success: true };
    } catch (error) {
        console.error("Bookmark save error:", error);
        return { success: false };
    }
});

secureHandle("db:get-bookmarks", () => database.getBookmarks());

secureHandle("db:delete-bookmark", (_, id) => {
    if (!Number.isSafeInteger(id) || id < 1) return false;

    database.deleteBookmark(id);
    return true;
});

secureHandle("db:get-history", () => database.getHistory());

secureHandle("db:clear-history", () => {
    database.clearHistory();
    return true;
});

secureHandle("browser:clear-data", async (event, data) => {
    if (!isTrustedRenderer(event) || !data || typeof data !== "object" || Array.isArray(data)) return { success: false, error: "Invalid clear-data request" };
    const validRanges = new Set(["hour", "day", "week", "4weeks", "all"]);
    const validTypes = new Set(["history", "downloads", "cookies", "cache", "permissions", "siteData"]);
    if (!validRanges.has(data.range) || !data.types || typeof data.types !== "object" || Array.isArray(data.types)) return { success: false, error: "Invalid clear-data options" };
    for (const [key, value] of Object.entries(data.types)) {
        if (!validTypes.has(key) || typeof value !== "boolean") return { success: false, error: "Invalid clear-data selection" };
    }
    if (!Object.values(data.types).some(Boolean)) return { success: false, error: "Select at least one data type" };
    const durations = { hour: 60 * 60 * 1000, day: 24 * 60 * 60 * 1000, week: 7 * 24 * 60 * 60 * 1000, "4weeks": 28 * 24 * 60 * 60 * 1000, all: Infinity };
    const cutoff = data.range === "all" ? 0 : Date.now() - durations[data.range];
    try {
        if (data.types.history) {
            if (data.range === "all") database.clearHistory();
            else database.clearHistoryBefore(cutoff);
        }
        if (data.types.downloads) {
            if (data.range === "all") database.clearDownloads();
            else database.clearDownloadsBefore(cutoff);
            for (const [id, item] of downloads) {
                if (!['progressing', 'paused'].includes(item.state) && item.startedAt < cutoff) downloads.delete(id);
            }
            publishDownloads();
        }
        if (data.types.permissions) database.clearWebsitePermissions();
        const storages = [];
        if (data.types.cookies) storages.push("cookies");
        if (data.types.siteData) storages.push("localstorage", "indexdb", "serviceworkers", "cachestorage", "filesystem");
        if (storages.length) await session.defaultSession.clearStorageData({ storages });
        if (data.types.cache) await session.defaultSession.clearCache();
        if (data.types.permissions && mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("permissions:updated", database.getWebsitePermissions());
        return { success: true, limitations: "The selected time range applies to history and download history. Cookies, cache, saved site data, and permission decisions are cleared for all time using Electron session APIs. Private-session data is cleared automatically when its last private tab closes." };
    } catch (error) {
        console.error("Clear browsing data error:", error);
        return { success: false, error: "Could not clear all selected browsing data" };
    }
});

secureHandle("browser:switch-tab", (_, id) => {
    switchTab(id);
});

secureHandle("browser:close-tab", (event, id) => {
    if (!isTrustedRenderer(event) || typeof id !== "string") return { success: false, error: "Invalid tab" };
    return closeTab(id);
});

secureHandle("browser:get-tabs", () => ({
    tabs: getTabData(),
    activeTabId,
    closedTabCount: closedTabs.length
}));

secureHandle("permissions:get", (event) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request", permissions: [] };
    return { success: true, permissions: database.getWebsitePermissions() };
});

secureHandle("permissions:set", (event, data) => {
    if (!isTrustedRenderer(event) || !data || typeof data.origin !== "string" || typeof data.permission !== "string" || !SUPPORTED_SITE_PERMISSIONS.has(data.permission) || !["granted", "denied", "ask"].includes(data.decision)) return { success: false, error: "Invalid permission setting" };
    let parsed;
    try { parsed = new URL(data.origin); } catch { return { success: false, error: "Invalid website origin" }; }
    if (!isSafeUrl(parsed.href) || parsed.origin !== data.origin || data.origin.length > 300) return { success: false, error: "Invalid website origin" };
    if (data.decision === "ask") database.removeWebsitePermission(data.origin, data.permission);
    else database.setWebsitePermission(data.origin, data.permission, data.decision);
    return { success: true, permissions: database.getWebsitePermissions() };
});

secureHandle("permissions:reset-origin", (event, origin) => {
    if (!isTrustedRenderer(event) || typeof origin !== "string" || origin.length > 300) return { success: false, error: "Invalid website origin" };
    let parsed;
    try { parsed = new URL(origin); } catch { return { success: false, error: "Invalid website origin" }; }
    if (!isSafeUrl(parsed.href) || parsed.origin !== origin) return { success: false, error: "Invalid website origin" };
    database.removeWebsitePermissions(origin);
    return { success: true, permissions: database.getWebsitePermissions() };
});

// Browser Settings IPC

secureHandle("settings:get", (event) => {
    if (!isTrustedRenderer(event)) return null;

    return database.getSettings();
});

secureHandle("settings:update", (event, newSettings) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (!newSettings || typeof newSettings !== "object" || Array.isArray(newSettings)) {
        return { success: false, error: "Invalid settings" };
    }
    for (const key of ["openPopupsInNewTabs", "downloadNotifications"]) {
        if (Object.prototype.hasOwnProperty.call(newSettings, key) && typeof newSettings[key] !== "boolean") {
            return { success: false, error: `Invalid ${key} setting` };
        }
    }

    if (Object.prototype.hasOwnProperty.call(newSettings, "newTabBackground")) {
        const config = newSettings.newTabBackground;
        const choices = {
            animation: ["none", "leaves", "water", "clouds", "snow", "particles", "waves", "stars", "aurora", "rain", "wind"],
            speed: ["slow", "normal", "fast"],
            intensity: ["low", "medium", "high"],
            staticBackground: ["default", "midnight", "dawn"]
        };
        const numeric = { opacity: [0.1, 1], blur: [0, 14] };
        if (!config || typeof config !== "object" || Array.isArray(config)) return { success: false, error: "Invalid New Tab background settings" };
        for (const [key, value] of Object.entries(config)) {
            if (key === "enabled" || key === "lowPerformance") {
                if (typeof value !== "boolean") return { success: false, error: `Invalid New Tab ${key} setting` };
            } else if (Object.prototype.hasOwnProperty.call(choices, key)) {
                if (!choices[key].includes(value)) return { success: false, error: `Invalid New Tab ${key} setting` };
            } else if (Object.prototype.hasOwnProperty.call(numeric, key)) {
                if (typeof value !== "number" || !Number.isFinite(value) || value < numeric[key][0] || value > numeric[key][1]) return { success: false, error: `Invalid New Tab ${key} setting` };
            } else return { success: false, error: "Unknown New Tab background setting" };
        }
    }

    const allowedKeys = [
        "searchEngine",
        "homepage",
        "startupBehavior",
        "theme",
        "downloadLocation",
        "openPopupsInNewTabs",
        "downloadNotifications",
        "newTabBackground"
    ];

    const safeSettings = {};

    for (const key of allowedKeys) {
        if (Object.prototype.hasOwnProperty.call(newSettings, key)) {
            safeSettings[key] = newSettings[key];
        }
    }

    if (Object.prototype.hasOwnProperty.call(safeSettings, "downloadLocation")) {
        const location = safeSettings.downloadLocation;
        if (typeof location !== "string" || location.length > 2048) return { success: false, error: "Invalid download location" };
        if (location) {
            try {
                if (!path.isAbsolute(location) || !fs.statSync(location).isDirectory()) return { success: false, error: "Choose an existing folder for downloads" };
                const normalized = path.resolve(location);
                const persisted = database.getSettings().downloadLocation;
                if (normalized !== (persisted ? path.resolve(persisted) : "") && !approvedDownloadLocations.has(normalized)) {
                    return { success: false, error: "Choose the download folder using the folder picker" };
                }
                safeSettings.downloadLocation = normalized;
            } catch { return { success: false, error: "Choose an existing folder for downloads" }; }
        } else safeSettings.downloadLocation = "";
    }

    if (Object.prototype.hasOwnProperty.call(safeSettings, "newTabBackground")) {
        safeSettings.newTabBackground = { ...(database.getSettings().newTabBackground || {}), ...safeSettings.newTabBackground };
    }

    try {
        database.updateSettings(safeSettings);

        if (Object.prototype.hasOwnProperty.call(safeSettings, "downloadLocation")) {
            approvedDownloadLocations.delete(safeSettings.downloadLocation);
            session.defaultSession.setDownloadPath(getDownloadDirectory());
            session.fromPartition("incognito").setDownloadPath(getDownloadDirectory());
        }

        if (Object.prototype.hasOwnProperty.call(safeSettings, "theme") && mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.setBackgroundColor(safeSettings.theme === "light" ? "#f5f7fb" : "#0d1117");
        }
        if (Object.prototype.hasOwnProperty.call(safeSettings, "theme") && toolsWindow && !toolsWindow.isDestroyed()) {
            toolsWindow.setBackgroundColor(safeSettings.theme === "light" ? "#edf0f5" : "#191b22");
            toolsWindow.webContents.send("tools:theme", safeSettings.theme);
        }

        return { success: true, settings: database.getSettings() };
    } catch (error) {
        console.error("Settings update error:", error);
        return { success: false, error: "Could not save settings" };
    }
});

secureHandle("browser:get-network-requests", (_, tabId) => {
    if (typeof tabId !== "string") return [];

    return [...networkRequests.values()]
        .filter(item => item.tabId === tabId);
});

secureHandle("browser:clear-network-requests", (_, tabId) => {
    if (typeof tabId !== "string") return false;

    for (const [key, item] of networkRequests.entries()) {
        if (item.tabId === tabId) {
            networkRequests.delete(key);
        }
    }

    return true;
});

secureHandle("browser:set-request-blocked", (event, data) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request" };
    if (!data || typeof data.url !== "string" || data.url.length > 4096 || typeof data.blocked !== "boolean" || !isSafeUrl(data.url)) return { success: false, error: "Invalid request blocking rule" };
    if (data.blocked) blockedRequestUrls.add(data.url);
    else blockedRequestUrls.delete(data.url);
    return { success: true };
});

secureHandle("browser:navigate", async (_, url) => {
    if (!isSafeUrl(url)) return;

    const tab = tabs.get(activeTabId);
    if (tab) await tab.view.webContents.loadURL(url);
});

secureHandle("browser:back", () => {
    const wc = tabs.get(activeTabId)?.view.webContents;
    if (wc?.canGoBack()) wc.goBack();
});

secureHandle("browser:forward", () => {
    const wc = tabs.get(activeTabId)?.view.webContents;
    if (wc?.canGoForward()) wc.goForward();
});

secureHandle("browser:reload", () => {
    const tab = tabs.get(activeTabId);
    const wc = tab?.view.webContents;

    if (!wc || wc.isDestroyed()) return;

    const currentUrl = wc.getURL();
    const isCompletedDownloadUrl = [...downloads.values()].some((download) =>
        download.tabId === activeTabId &&
        download.state === "completed" &&
        download.url === currentUrl
    );

    // Reloading a direct file URL starts a fresh download in Chromium.
    // Keep the completed file from being downloaded again by the reload button.
    if (isCompletedDownloadUrl) return;

    wc.reload();
});

secureHandle("browser:hard-reload", (event) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request" };
    const tab = tabs.get(activeTabId);
    const wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed()) return { success: false, error: "Tab no longer exists" };
    wc.reloadIgnoringCache();
    return { success: true };
});

secureHandle("browser:find-in-page", (event, data) => {
    if (!isTrustedRenderer(event) || !data || typeof data !== "object" || typeof data.query !== "string" || data.query.length > 500 || !["start", "next", "previous"].includes(data.action)) return { success: false, error: "Invalid find request" };
    const targetId = typeof data.tabId === "string" ? data.tabId : activeTabId;
    if (targetId !== activeTabId) return { success: false, error: "Find in Page only works in the active tab" };
    const tab = tabs.get(targetId);
    const wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed() || !isSafeUrl(tab.url)) return { success: false, error: "Find is unavailable for this tab" };
    if (!data.query.trim()) {
        wc.stopFindInPage("clearSelection");
        tab.findRequestId = null;
        return { success: true, requestId: null };
    }
    const result = wc.findInPage(data.query, {
        forward: data.action !== "previous",
        findNext: data.action !== "start"
    });
    tab.findRequestId = result;
    return { success: true, requestId: result };
});

secureHandle("browser:stop-find-in-page", (event, tabId) => {
    if (!isTrustedRenderer(event) || (tabId != null && typeof tabId !== "string")) return { success: false, error: "Invalid find request" };
    const tab = tabs.get(tabId || activeTabId);
    const wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed()) return { success: false, error: "Tab no longer exists" };
    wc.stopFindInPage("clearSelection");
    tab.findRequestId = null;
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("browser:find-result", { tabId: tab.id, activeMatchOrdinal: 0, matches: 0, finalUpdate: true });
    return { success: true };
});

secureHandle("browser:stop-loading", (event) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request" };
    const tab = tabs.get(activeTabId);
    const wc = tab?.view.webContents;
    if (!wc || wc.isDestroyed() || !wc.isLoading()) return { success: false, error: "The active page is not loading" };
    wc.stop();
    if (!wc.isLoading()) { tab.loading = false; publishTabs(); }
    return { success: true };
});

secureHandle("browser:retry", (event) => {
    if (!isTrustedRenderer(event)) {
        return { success: false };
    }

    const tab = tabs.get(activeTabId);
    const wc = tab?.view.webContents;

    if (!wc || wc.isDestroyed()) {
        return { success: false };
    }

    wc.reload();

    return { success: true };
});

// ==========================================
// JAVASCRIPT EXECUTOR
// ==========================================

secureHandle("browser:execute-js", async (event, code) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
        return {
            success: false,
            error: "Unauthorized request"
        };
    }

    if (
        typeof code !== "string" ||
        !code.trim() ||
        code.length > 20000
    ) {
        return {
            success: false,
            error: "Invalid JavaScript code (maximum 20,000 characters)"
        };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return {
            success: false,
            error: "No active browser tab"
        };
    }

    if (!isSafeUrl(tab.view.webContents.getURL())) {
        return {
            success: false,
            error: "JavaScript execution is only allowed on HTTP/HTTPS pages"
        };
    }

    try {
        const wrappedCode = `(() => eval(${JSON.stringify(code)}))()`;

        const result = await tab.view.webContents.executeJavaScript(
            code,
            true
        );

        return {
            success: true,
            result
        };

    } catch (error) {
        return {
            success: false,
            error: error.message || "JavaScript execution failed",
            stack: String(error.stack || "").slice(0, 10000)
        };
    }
});


// ==========================================
// API COLLECTION IPC HANDLERS
// ==========================================

secureHandle("api:add-collection", (_, name) => {
    if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 100
    ) {
        return { success: false, error: "Invalid collection name" };
    }

    try {
        const result = database.addCollection(name.trim());

        return {
            success: true,
            id: Number(result.lastInsertRowid)
        };
    } catch (error) {
        return {
            success: false,
            error: "Collection already exists or could not be created"
        };
    }
});

secureHandle("api:get-collections", () => {
    return database.getCollections();
});

secureHandle("api:delete-collection", (_, id) => {
    if (!Number.isSafeInteger(id) || id < 1) {
        return { success: false };
    }

    try {
        database.deleteCollection(id);
        return { success: true };
    } catch (error) {
        return { success: false };
    }
});

// ==========================================
// SAVED API REQUEST IPC HANDLERS
// ==========================================

secureHandle("api:save-request", (_, data) => {
    try {
        if (
            !data ||
            !Number.isSafeInteger(data.collectionId) ||
            data.collectionId < 1 ||
            typeof data.name !== "string" ||
            !data.name.trim() ||
            data.name.length > 150 ||
            !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(data.method) ||
            typeof data.url !== "string" ||
            data.url.length > 2048 ||
            typeof data.body !== "string" ||
            data.body.length > 1024 * 1024
        ) {
            return { success: false, error: "Invalid request fields" };
        }

        const parsedUrl = new URL(data.url);

        if (
            !["http:", "https:"].includes(parsedUrl.protocol) ||
            parsedUrl.username ||
            parsedUrl.password
        ) {
            return { success: false, error: "Invalid URL" };
        }

        const authTypes = ["none", "bearer", "basic", "apikey"];

        if (!authTypes.includes(data.authType || "none")) {
            return { success: false, error: "Invalid authentication type" };
        }

        const collections = database.getCollections();

        if (!collections.some(c => c.id === data.collectionId)) {
            return { success: false, error: "Collection not found" };
        }

        const headers = data.headers || {};

        if (
            typeof headers !== "object" ||
            Array.isArray(headers)
        ) {
            return { success: false, error: "Invalid headers" };
        }

        const safeHeaders = {};

        for (const [key, value] of Object.entries(headers)) {
            if (
                typeof value !== "string" ||
                key.length > 256 ||
                value.length > 8192 ||
                /[\r\n]/.test(key + value)
            ) {
                return { success: false, error: "Invalid header" };
            }

            if (/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key)$/i.test(key)) {
                continue;
            }

            safeHeaders[key] = value;
        }

        // Encrypt authentication configuration before saving.
        const encryptedAuth = encryptAuthConfig(
            data.authConfig || {}
        );

        database.saveRequest({
            collectionId: data.collectionId,
            name: data.name.trim(),
            method: data.method,
            url: parsedUrl.href,
            headers: safeHeaders,
            body: data.body,
            authType: data.authType || "none",
            authConfig: encryptedAuth
        });

        return { success: true };

    } catch (error) {
        console.error("Save API request error:", error);

        return {
            success: false,
            error: error.message || "Unable to save request"
        };
    }
});

secureHandle("api:get-saved-requests", (_, collectionId) => {
    if (!Number.isSafeInteger(collectionId) || collectionId < 1) {
        return [];
    }

    try {
        return database.getSavedRequests(collectionId).map(item => {
            const publicItem = { ...item };
            delete publicItem.auth_config;
            return {
                ...publicItem,
                headers: JSON.parse(item.headers || "{}"),
                authConfig: {}
            };
        });
    } catch (error) {
        console.error("Retrieve saved requests error:", error);
        return [];
    }
});

secureHandle("api:get-saved-request", (_, id) => {
    if (!Number.isSafeInteger(id) || id < 1) return { success: false, error: "Invalid request ID" };
    try {
        const item = database.getSavedRequest(id);
        if (!item) return { success: false, error: "Saved request not found" };
        const encrypted = JSON.parse(item.auth_config || '\"\"');
        return {
            success: true,
            request: {
                id: item.id,
                collection_id: item.collection_id,
                name: item.name,
                method: item.method,
                url: item.url,
                body: item.body,
                auth_type: item.auth_type,
                headers: JSON.parse(item.headers || "{}"),
                authConfig: decryptAuthConfig(encrypted)
            }
        };
    } catch {
        return { success: false, error: "Could not load saved credentials" };
    }
});

secureHandle("api:delete-saved-request", (_, id) => {
    if (!Number.isSafeInteger(id) || id < 1) {
        return { success: false };
    }

    try {
        database.deleteSavedRequest(id);
        return { success: true };
    } catch (error) {
        return { success: false };
    }
});



const allowedMethods = [
    "GET",
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
    "HEAD"
];

secureHandle("api:send-request", async (_, data) => {
    if (!data || typeof data !== "object") {
        return { error: "Invalid request data" };
    }

    const method = String(data.method || "").toUpperCase();

    if (!allowedMethods.includes(method)) {
        return { error: "Unsupported HTTP method" };
    }

    if (typeof data.url !== "string" || data.url.length > 2048) {
        return { error: "Invalid URL" };
    }

    let parsedUrl;

    try {
        parsedUrl = new URL(data.url);

        if (!["http:", "https:"].includes(parsedUrl.protocol)) {
            return { error: "Only HTTP and HTTPS URLs are allowed" };
        }

        if (parsedUrl.username || parsedUrl.password) {
            return { error: "Credentials in URL are not supported" };
        }
    } catch {
        return { error: "Please enter a valid URL" };
    }

    const requestHeaders = data.headers || {};

    if (
        typeof requestHeaders !== "object" ||
        Array.isArray(requestHeaders)
    ) {
        return { error: "Headers must be an object" };
    }

    const headers = {};

    for (const [key, value] of Object.entries(requestHeaders)) {
        if (
            typeof value !== "string" ||
            key.length > 256 ||
            value.length > 8192 ||
            /[\r\n]/.test(key + value)
        ) {
            return { error: "Invalid request header" };
        }

        headers[key] = value;
    }

    if (data.body !== undefined && (typeof data.body !== "string" || data.body.length > 1024 * 1024)) {
        return { error: "Request body must be text" };
    }

    // Apply authentication before sending request
    const authType = data.authType || "none";
    const auth = data.authConfig || {};

    if (!["none", "bearer", "basic", "apikey"].includes(authType)) {
        return { error: "Invalid authentication type" };
    }

    if (authType === "bearer") {
        if (typeof auth.token !== "string" || !auth.token.trim()) {
            return { error: "Bearer token is required" };
        }

        headers.Authorization = `Bearer ${auth.token}`;
    }

    if (authType === "basic") {
        if (
            typeof auth.username !== "string" ||
            typeof auth.password !== "string"
        ) {
            return { error: "Username and password are required" };
        }

        const credentials = Buffer.from(
            `${auth.username}:${auth.password}`
        ).toString("base64");

        headers.Authorization = `Basic ${credentials}`;
    }

    if (authType === "apikey") {
        if (
            typeof auth.key !== "string" ||
            typeof auth.value !== "string" ||
            !auth.key.trim() ||
            /[\r\n]/.test(auth.key + auth.value)
        ) {
            return { error: "Valid API key and value are required" };
        }

        if (auth.location === "query") {
            parsedUrl.searchParams.set(auth.key, auth.value);
        } else {
            headers[auth.key] = auth.value;
        }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const startTime = Date.now();

    try {
        const result = await fetch(parsedUrl.href, {
            method,
            headers,
            body: ["GET", "HEAD"].includes(method)
                ? undefined
                : (data.body || undefined),
            signal: controller.signal,
            redirect: "follow"
        });

        const responseLimit = 1024 * 1024;
        const responseChunks = [];
        let responseBytes = 0;
        let truncated = false;
        if (method !== "HEAD" && result.body) {
            const reader = result.body.getReader();
            while (responseBytes <= responseLimit) {
                const { done, value } = await reader.read();
                if (done) break;
                const remaining = responseLimit - responseBytes;
                const accepted = value.byteLength > remaining ? value.subarray(0, remaining) : value;
                if (accepted.byteLength) responseChunks.push(accepted);
                responseBytes += accepted.byteLength;
                if (accepted.byteLength < value.byteLength || responseBytes === responseLimit) {
                    truncated = true;
                    await reader.cancel();
                    break;
                }
            }
        }
        const joined = new Uint8Array(responseBytes);
        let offset = 0;
        for (const chunk of responseChunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
        const responseText = new TextDecoder().decode(joined);

        const duration = Date.now() - startTime;

        return {
            status: result.status,
            statusText: result.statusText,
            duration,
            size: responseBytes,
            headers: Object.fromEntries(result.headers.entries()),
            body: responseText.slice(0, 1024 * 1024),
            truncated
        };
    } catch (error) {
        return {
            error: error.name === "AbortError"
                ? "Request timed out after 30 seconds"
                : "Network request failed"
        };
    } finally {
        clearTimeout(timeout);
    }
});



secureOn("browser:resize", (_, bounds) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    if (
        !bounds ||
        ![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    ) {
        return;
    }

    // Do not overwrite responsive preview bounds.
    if (responsiveModeActive) return;

    viewBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(0, Math.round(bounds.width)),
        height: Math.max(0, Math.round(bounds.height))
    };

    updateActiveBounds();
});


secureOn("browser:set-visible", (_, visible) => {
    const tab = tabs.get(activeTabId);

    if (!tab || !mainWindow || mainWindow.isDestroyed()) return;

    try {
        if (visible === true) {
            mainWindow.contentView.addChildView(tab.view);

            // Restore whichever viewport belongs to the currently open panel.
            tab.view.setBounds(
                responsiveModeActive && responsiveViewBounds
                    ? responsiveViewBounds
                    : viewBounds
            );
        } else {
            // Hide the native Chromium view completely.
            tab.view.setBounds({
                x: 0,
                y: 0,
                width: 0,
                height: 0
            });

            mainWindow.contentView.removeChildView(tab.view);
        }
    } catch (error) {
        console.error("Browser visibility error:", error);
    }
});


secureHandle("browser:responsive-mode", async (event, settings) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    const tab = tabs.get(activeTabId);
    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const { bounds, width, height, dpr, touch } = settings || {};

    if (
        !bounds ||
        ![bounds.x, bounds.y, bounds.width, bounds.height,
            width, height, dpr].every(Number.isFinite) ||
        bounds.width <= 0 ||
        bounds.height <= 0 ||
        width < 200 || width > 3840 ||
        height < 200 || height > 3840 ||
        dpr < 1 || dpr > 3 ||
        typeof touch !== "boolean"
    ) {
        return { success: false, error: "Invalid device settings" };
    }

    try {
        const wc = tab.view.webContents;

        responsiveViewBounds = {
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
            width: Math.round(bounds.width),
            height: Math.round(bounds.height)
        };
        responsiveModeActive = true;

        // Attach and size the native view before awaiting CDP. This avoids
        // leaving a zero-sized/old-sized view visible while emulation starts.
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (!mainWindow.contentView.children.includes(tab.view)) {
                mainWindow.contentView.addChildView(tab.view);
            }
        }
        tab.view.setBounds(responsiveViewBounds);

        // Debugger attachment is normally established when the tab is
        // created. Attach here as a fallback so responsive emulation also
        // works for tabs created before that setup completed.
        if (!wc.debugger.isAttached()) {
            wc.debugger.attach("1.3");
        }

        await wc.debugger.sendCommand(
            "Emulation.setDeviceMetricsOverride",
            {
                width: Math.round(width),
                height: Math.round(height),
                deviceScaleFactor: dpr,
                mobile: true
            }
        );

        await wc.debugger.sendCommand(
            "Emulation.setTouchEmulationEnabled",
            {
                enabled: touch,
                maxTouchPoints: touch ? 5 : 1
            }
        );

        return { success: true };
    } catch (error) {
        console.error("Responsive emulation error:", error);

        return {
            success: false,
            error: error.message
        };
    }
});


secureHandle("browser:responsive-reset", async (event) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    // Restore normal browser layout FIRST.
    responsiveModeActive = false;
    responsiveViewBounds = null;

    try {
        tab.view.setBounds(viewBounds);

        if (mainWindow && !mainWindow.isDestroyed()) {
            if (!mainWindow.contentView.children.includes(tab.view)) {
                mainWindow.contentView.addChildView(tab.view);
            }
        }

        // Then clear device emulation.
        if (wc.debugger.isAttached()) {
            await wc.debugger.sendCommand(
                "Emulation.clearDeviceMetricsOverride"
            );

            await wc.debugger.sendCommand(
                "Emulation.setTouchEmulationEnabled",
                { enabled: false }
            );
        }

        // Reapply normal bounds after emulation reset.
        tab.view.setBounds(viewBounds);

        return { success: true };
    } catch (error) {
        console.error("Responsive reset error:", error);

        // Never leave the browser stuck in responsive bounds.
        responsiveModeActive = false;
        responsiveViewBounds = null;
        tab.view.setBounds(viewBounds);

        return {
            success: false,
            error: error.message
        };
    }
});


// ==========================================
// ELEMENT INSPECTOR
// ==========================================

const inspectorPollers = new Map();
const inspectorHistory = new Map();

function getInspectorHistory(tabId) {
    if (!inspectorHistory.has(tabId)) inspectorHistory.set(tabId, { undo: [], redo: [] });
    return inspectorHistory.get(tabId);
}

secureHandle("inspector:mutate-dom", async (event, data) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request" };
    const { operation, selector, tagName, name, value } = data || {};
    if (typeof operation !== "string" || !["add", "duplicate", "delete", "text", "attribute", "remove-attribute", "add-class", "remove-class", "reset"].includes(operation) || (selector !== undefined && (typeof selector !== "string" || selector.length > 2000)) || (tagName !== undefined && (typeof tagName !== "string" || !/^[a-z][a-z0-9-]{0,40}$/i.test(tagName))) || (name !== undefined && (typeof name !== "string" || name.length > 100)) || (value !== undefined && (typeof value !== "string" || value.length > 20000))) return { success: false, error: "Invalid DOM operation" };
    const tab = tabs.get(activeTabId);
    if (!tab || tab.view.webContents.isDestroyed() || !isSafeUrl(tab.view.webContents.getURL())) return { success: false, error: "Cannot modify this page" };
    const wc = tab.view.webContents;
    const history = getInspectorHistory(tab.id);
    try {
        const before = await wc.executeJavaScript("document.body.innerHTML");
        const result = await wc.executeJavaScript(`(() => {
          const op=${JSON.stringify(operation)}, sel=${JSON.stringify(selector || "")}, val=${JSON.stringify(value || "")}, nm=${JSON.stringify(name || "")}, tag=${JSON.stringify(tagName || "div")};
          const el=sel ? document.querySelector(sel) : null;
          if (sel && !el) return {success:false,error:"Element no longer exists. Refresh the DOM tree and select it again."};
          if (op === "add") { const n=document.createElement(tag); if (el) el.append(n); else document.body.append(n); return {success:true, selector:"body > "+tag+":last-child"}; }
          if (op === "duplicate") { if(!el || !el.parentElement) return {success:false,error:"Select an element that has a parent."}; const n=el.cloneNode(true); el.after(n); return {success:true}; }
          if (op === "delete") { if(!el || el===document.body || el===document.documentElement) return {success:false,error:"Cannot delete this element."}; el.remove(); return {success:true}; }
          if (op === "text") { el.textContent=val; return {success:true}; }
          if (op === "attribute") { if(!/^[^\\s\\"'<>/=]+$/.test(nm) || /^on/i.test(nm)) return {success:false,error:"Invalid or unsafe attribute name."}; el.setAttribute(nm,val); return {success:true}; }
          if (op === "remove-attribute") { el.removeAttribute(nm); return {success:true}; }
          if (op === "add-class" || op === "remove-class") { if(!val || /\\s/.test(val)) return {success:false,error:"Enter one CSS class name."}; el.classList[op === "add-class" ? "add" : "remove"](val); return {success:true}; }
          if (op === "reset") { el.removeAttribute("style"); return {success:true}; }
          return {success:false,error:"Unsupported DOM operation."};
        })()`);
        if (!result?.success) return result;
        const after = await wc.executeJavaScript("document.body.innerHTML");
        history.undo.push({ before, after }); if (history.undo.length > 50) history.undo.shift(); history.redo = [];
        return result;
    } catch (error) { return { success: false, error: error.message || "DOM operation failed" }; }
});

secureHandle("inspector:history", async (event, direction) => {
    if (!isTrustedRenderer(event)) return { success: false, error: "Unauthorized request" };
    if (!["undo", "redo"].includes(direction)) return { success: false, error: "Invalid history action" };
    const tab = tabs.get(activeTabId);
    if (!tab || tab.view.webContents.isDestroyed() || !isSafeUrl(tab.view.webContents.getURL())) return { success: false, error: "Cannot access the current page" };
    const history = getInspectorHistory(tab.id), from = history[direction], to = history[direction === "undo" ? "redo" : "undo"];
    if (!from.length) return { success: false, error: `Nothing to ${direction}` };
    const item = from.pop();
    try {
        await tab.view.webContents.executeJavaScript(`document.body.innerHTML = ${JSON.stringify(direction === "undo" ? item.before : item.after)}`);
        to.push(item);
        return { success: true };
    } catch (error) { from.push(item); return { success: false, error: error.message }; }
});

secureHandle("inspector:start", async (event) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    const tab = tabs.get(activeTabId);
    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return {
            success: false,
            error: "Inspector works only on HTTP/HTTPS pages"
        };
    }

    try {
        const existing = inspectorPollers.get(tab.id);
        if (existing) clearInterval(existing);

        await wc.executeJavaScript(`(() => {
            window.__devflowInspectorCleanup?.();

            const overlay = document.createElement("div");
            overlay.id = "__devflow_inspector_overlay__";

            Object.assign(overlay.style, {
                position: "fixed",
                zIndex: "2147483647",
                pointerEvents: "none",
                border: "2px solid #3b82f6",
                background: "rgba(59,130,246,0.12)",
                display: "none"
            });

            document.documentElement.appendChild(overlay);

            let selected = null;

            const getSelector = (el) => {
                if (el.id) return "#" + CSS.escape(el.id);

                const parts = [];
                let node = el;

                while (node && node.nodeType === 1 && parts.length < 6) {
                    let part = node.tagName.toLowerCase();

                    if (node.classList.length) {
                        part += "." + [...node.classList]
                            .slice(0, 2)
                            .map(CSS.escape)
                            .join(".");
                    }

                    const parent = node.parentElement;
                    if (parent) {
                        const siblings = [...parent.children]
                            .filter(item => item.tagName === node.tagName);

                        if (siblings.length > 1) {
                            part += ":nth-of-type(" +
                                (siblings.indexOf(node) + 1) + ")";
                        }
                    }

                    parts.unshift(part);
                    node = parent;
                }

                return parts.join(" > ");
            };

            const onMove = (event) => {
                const el = document.elementFromPoint(
                    event.clientX,
                    event.clientY
                );

                if (!el || el === overlay) return;

                const rect = el.getBoundingClientRect();

                Object.assign(overlay.style, {
                    display: "block",
                    left: rect.left + "px",
                    top: rect.top + "px",
                    width: rect.width + "px",
                    height: rect.height + "px"
                });
            };

            const onClick = (event) => {
                const el = event.target;

                if (!(el instanceof Element) || el === overlay) return;

                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();

                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);

                selected = {
                    tagName: el.tagName.toLowerCase(),
                    id: el.id || "",
                    className: typeof el.className === "string"
                        ? el.className
                        : "",
                    text: (el.innerText || el.textContent || "")
                        .trim().slice(0, 2000),
                    selector: getSelector(el),
                    outerHTML: el.outerHTML.slice(0, 10000),
                    innerHTML: el.innerHTML.slice(0, 10000),
                    attributes: [...el.attributes].map(attr => ({
                        name: attr.name,
                        value: attr.value.slice(0, 1000)
                    })),
                    dimensions: {
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        x: Math.round(rect.x),
                        y: Math.round(rect.y)
                    },
                    styles: {
                        color: style.color,
                        backgroundColor: style.backgroundColor,
                        fontSize: style.fontSize,
                        fontFamily: style.fontFamily,
                        display: style.display,
                        position: style.position,
                        margin: style.margin,
                        padding: style.padding
                    }
                };

                window.__devflowInspectorSelection = selected;
                overlay.style.display = "none";
            };

            const cleanup = () => {
                document.removeEventListener("mousemove", onMove, true);
                document.removeEventListener("click", onClick, true);
                overlay.remove();
                delete window.__devflowInspectorSelection;
                delete window.__devflowInspectorCleanup;
            };

            document.addEventListener("mousemove", onMove, true);
            document.addEventListener("click", onClick, true);

            window.__devflowInspectorCleanup = cleanup;
            window.__devflowInspectorSelection = null;

            return true;
        })()`);

        const poller = setInterval(async () => {
            if (wc.isDestroyed()) {
                clearInterval(poller);
                inspectorPollers.delete(tab.id);
                return;
            }

            try {
                const selection = await wc.executeJavaScript(
                    "window.__devflowInspectorSelection || null"
                );

                if (selection) {
                    mainWindow.webContents.send(
                        "inspector:element-selected",
                        { tabId: tab.id, ...selection }
                    );

                    await wc.executeJavaScript(
                        "window.__devflowInspectorSelection = null"
                    );
                }
            } catch {
                // Page may be navigating.
            }
        }, 150);

        inspectorPollers.set(tab.id, poller);

        return { success: true };
    } catch (error) {
        console.error("Inspector start error:", error);
        return { success: false, error: error.message };
    }
});

secureHandle("inspector:stop", async (event) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    const tab = tabs.get(activeTabId);
    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const poller = inspectorPollers.get(tab.id);
    if (poller) clearInterval(poller);
    inspectorPollers.delete(tab.id);

    try {
        await tab.view.webContents.executeJavaScript(
            "window.__devflowInspectorCleanup?.()"
        );

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});


// ELEMENT INSPECTOR - DOM TREE

secureHandle("inspector:get-dom-tree", async (event) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return { success: false, error: "Cannot inspect this page" };
    }

    try {
        const tree = await wc.executeJavaScript(`
            (() => {
                let count = 0;
                const MAX_NODES = 300;
                const MAX_DEPTH = 8;

                function getSelector(el) {
                    if (el.id) {
                        return "#" + CSS.escape(el.id);
                    }

                    const parts = [];

                    while (
                        el &&
                        el.nodeType === Node.ELEMENT_NODE &&
                        el !== document.documentElement
                    ) {
                        let part = el.tagName.toLowerCase();

                        if (el.parentElement) {
                            const siblings = Array.from(
                                el.parentElement.children
                            ).filter(
                                child => child.tagName === el.tagName
                            );

                            if (siblings.length > 1) {
                                part += ":nth-of-type(" +
                                    (siblings.indexOf(el) + 1) + ")";
                            }
                        }

                        parts.unshift(part);
                        el = el.parentElement;
                    }

                    return "html > " + parts.join(" > ");
                }

                function buildTree(el, depth = 0) {
                    if (
                        !(el instanceof Element) ||
                        count >= MAX_NODES ||
                        depth > MAX_DEPTH
                    ) {
                        return null;
                    }

                    count++;

                    const children = [];

                    if (depth < MAX_DEPTH) {
                        for (const child of el.children) {
                            if (count >= MAX_NODES) break;

                            const node = buildTree(child, depth + 1);

                            if (node) children.push(node);
                        }
                    }

                    return {
                        tagName: el.tagName.toLowerCase(),
                        id: el.id || "",
                        className:
                            typeof el.className === "string"
                                ? el.className
                                : "",
                        selector: getSelector(el),
                        children,
                        hasChildren: el.children.length > 0
                    };
                }

                return buildTree(document.body);
            })()
        `);

        return {
            success: true,
            tree
        };

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});


// SELECT ELEMENT FROM DOM TREE

secureHandle("inspector:select-dom-element", async (event, selector) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (
        typeof selector !== "string" ||
        !selector.trim() ||
        selector.length > 2000
    ) {
        return { success: false, error: "Invalid selector" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return { success: false, error: "Cannot inspect this page" };
    }

    try {
        const result = await wc.executeJavaScript(`
            (() => {
                const el = document.querySelector(
                    ${JSON.stringify(selector)}
                );

                if (!el) {
                    return {
                        success: false,
                        error: "Element not found"
                    };
                }

                const rect = el.getBoundingClientRect();
                const style = getComputedStyle(el);

                const styleKeys = [
                    "color",
                    "backgroundColor",
                    "fontSize",
                    "fontFamily",
                    "fontWeight",
                    "display",
                    "position",
                    "margin",
                    "padding",
                    "width",
                    "height",
                    "border",
                    "borderRadius",
                    "opacity"
                ];

                const styles = {};

                styleKeys.forEach(key => {
                    styles[key] = style[key];
                });

                return {
                    success: true,
                    tagName: el.tagName.toLowerCase(),
                    id: el.id || "",
                    className: typeof el.className === "string"
                        ? el.className
                        : "",
                    text: (el.innerText || el.textContent || "")
                        .trim()
                        .slice(0, 500),
                    selector: ${JSON.stringify(selector)},
                    outerHTML: el.outerHTML.slice(0, 10000),
                    innerHTML: el.innerHTML.slice(0, 10000),
                    attributes: Array.from(el.attributes).map(attr => ({
                        name: attr.name,
                        value: attr.value
                    })),
                    dimensions: {
                        width: Math.round(rect.width),
                        height: Math.round(rect.height)
                    },
                    styles
                };
            })()
        `);

        return result;

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});


// ELEMENT INSPECTOR - LIVE CSS UPDATE

secureHandle("inspector:update-element-style", async (event, data) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    const { selector, property, value } = data || {};

    if (
        typeof selector !== "string" ||
        !selector.trim() ||
        selector.length > 2000 ||
        typeof property !== "string" ||
        typeof value !== "string" ||
        value.length > 500
    ) {
        return { success: false, error: "Invalid CSS input" };
    }

    // Only allow common visual CSS properties.
    const allowedProperties = new Set([
        "color",
        "background-color",
        "font-size",
        "font-family",
        "font-weight",
        "font-style",
        "text-align",
        "text-decoration",
        "line-height",
        "letter-spacing",
        "width",
        "height",
        "min-width",
        "max-width",
        "min-height",
        "max-height",
        "margin",
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "padding",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "border",
        "border-color",
        "border-width",
        "border-radius",
        "display",
        "position",
        "opacity",
        "box-shadow",
        "overflow",
        "visibility"
    ]);

    if (!allowedProperties.has(property)) {
        return { success: false, error: "CSS property not allowed" };
    }

    // Reject potentially executable or externally loaded CSS values.
    if (/url\s*\(|expression\s*\(|javascript:|@import|[{};]/i.test(value)) {
        return { success: false, error: "Invalid CSS value" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return { success: false, error: "Cannot edit styles on this page" };
    }

    try {
        const result = await wc.executeJavaScript(`
            (() => {
                const el = document.querySelector(
                    ${JSON.stringify(selector)}
                );

                if (!el) {
                    return {
                        success: false,
                        error: "Element not found"
                    };
                }

                el.style.setProperty(
                    ${JSON.stringify(property)},
                    ${JSON.stringify(value)}
                );

                return {
                    success: true,
                    property: ${JSON.stringify(property)},
                    value: el.style.getPropertyValue(
                        ${JSON.stringify(property)}
                    )
                };
            })()
        `);

        return result;

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});


// ELEMENT INSPECTOR - EDIT HTML

secureHandle("inspector:update-element-html", async (event, data) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    const { selector, html } = data || {};

    if (
        typeof selector !== "string" ||
        !selector.trim() ||
        selector.length > 2000 ||
        typeof html !== "string" ||
        html.length > 20000
    ) {
        return { success: false, error: "Invalid HTML input" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return { success: false, error: "Cannot edit HTML on this page" };
    }

    try {
        const result = await wc.executeJavaScript(`
            (() => {
                const selector = ${JSON.stringify(selector)};
                const html = ${JSON.stringify(html)};

                const el = document.querySelector(selector);

                if (!el) {
                    return {
                        success: false,
                        error: "Element not found"
                    };
                }

                const template = document.createElement("template");
                template.innerHTML = html;

                // Remove dangerous HTML elements.
                template.content.querySelectorAll(
                    "script, iframe, object, embed, base, meta, link, foreignObject"
                ).forEach(node => node.remove());

                // Remove event handlers and unsafe URL attributes.
                template.content.querySelectorAll("*").forEach(node => {
                    Array.from(node.attributes).forEach(attr => {
                        const name = attr.name.toLowerCase();
                        const value = attr.value.trim();

                        if (
                            name.startsWith("on") ||
                            name === "srcdoc" ||
                            (
                                ["href", "src", "action", "formaction", "xlink:href"].includes(name) &&
                                /^(javascript|vbscript):/i.test(value)
                            )
                        ) {
                            node.removeAttribute(attr.name);
                        }
                    });
                });

                // Update the selected element's children.
                el.replaceChildren(template.content.cloneNode(true));

                return {
                    success: true,
                    outerHTML: el.outerHTML.slice(0, 20000),
                    message: "HTML updated successfully"
                };
            })()
        `);

        return result;

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});


// ELEMENT INSPECTOR - DELETE ELEMENT

secureHandle("inspector:delete-element", async (event, selector) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (
        typeof selector !== "string" ||
        !selector.trim() ||
        selector.length > 2000
    ) {
        return { success: false, error: "Invalid selector" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return { success: false, error: "Cannot modify this page" };
    }

    try {
        const result = await wc.executeJavaScript(`
            (() => {
                const el = document.querySelector(
                    ${JSON.stringify(selector)}
                );

                if (!el) {
                    return {
                        success: false,
                        error: "Element not found"
                    };
                }

                if (
                    el === document.body ||
                    el === document.documentElement
                ) {
                    return {
                        success: false,
                        error: "Cannot delete the main page structure"
                    };
                }

                const details = {
                    tagName: el.tagName.toLowerCase(),
                    id: el.id || "",
                    selector: ${JSON.stringify(selector)}
                };

                el.remove();

                return {
                    success: true,
                    message: "Element deleted successfully",
                    element: details
                };
            })()
        `);

        return result;

    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
});




// ELEMENT INSPECTOR - BOX MODEL

secureHandle("inspector:get-box-model", async (event, selector) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof selector !== "string" || !selector.trim() || selector.length > 2000) {
        return { success: false, error: "Invalid selector" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return { success: false, error: "Cannot inspect this page" };
    }

    try {
        return await wc.executeJavaScript(`
            (() => {
                const el = document.querySelector(${JSON.stringify(selector)});

                if (!el) {
                    return { success: false, error: "Element not found" };
                }

                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();

                const number = (value) => parseFloat(value) || 0;

                return {
                    success: true,
                    width: Math.round(rect.width),
                    height: Math.round(rect.height),
                    margin: {
                        top: number(style.marginTop),
                        right: number(style.marginRight),
                        bottom: number(style.marginBottom),
                        left: number(style.marginLeft)
                    },
                    border: {
                        top: number(style.borderTopWidth),
                        right: number(style.borderRightWidth),
                        bottom: number(style.borderBottomWidth),
                        left: number(style.borderLeftWidth)
                    },
                    padding: {
                        top: number(style.paddingTop),
                        right: number(style.paddingRight),
                        bottom: number(style.paddingBottom),
                        left: number(style.paddingLeft)
                    },
                    content: {
                        width: Math.max(
                            0,
                            rect.width -
                            number(style.paddingLeft) -
                            number(style.paddingRight) -
                            number(style.borderLeftWidth) -
                            number(style.borderRightWidth)
                        ),
                        height: Math.max(
                            0,
                            rect.height -
                            number(style.paddingTop) -
                            number(style.paddingBottom) -
                            number(style.borderTopWidth) -
                            number(style.borderBottomWidth)
                        )
                    },
                    boxSizing: style.boxSizing
                };
            })()
        `);
    } catch (error) {
        return { success: false, error: error.message };
    }
});


// ELEMENT INSPECTOR - DOM HIGHLIGHT

secureHandle("inspector:highlight-element", async (event, selector) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof selector !== "string" || !selector.trim() || selector.length > 2000) {
        return { success: false, error: "Invalid selector" };
    }

    const tab = tabs.get(activeTabId);

    if (!tab || tab.view.webContents.isDestroyed()) {
        return { success: false, error: "No active browser tab" };
    }

    const wc = tab.view.webContents;

    if (!isSafeUrl(wc.getURL())) {
        return { success: false, error: "Cannot inspect this page" };
    }

    try {
        return await wc.executeJavaScript(`
            (() => {
                const el = document.querySelector(${JSON.stringify(selector)});

                if (!el) {
                    return { success: false, error: "Element not found" };
                }

                let overlay = document.getElementById(
                    "__devflow_dom_highlight__"
                );

                if (!overlay) {
                    overlay = document.createElement("div");
                    overlay.id = "__devflow_dom_highlight__";

                    Object.assign(overlay.style, {
                        position: "fixed",
                        zIndex: "2147483646",
                        pointerEvents: "none",
                        border: "2px solid #3b82f6",
                        background: "rgba(59,130,246,0.16)",
                        boxShadow: "0 0 0 1px rgba(255,255,255,0.6)",
                        transition: "all 0.1s ease",
                        display: "none"
                    });

                    document.documentElement.appendChild(overlay);
                }

                const update = () => {
                    if (!el.isConnected) {
                        overlay.style.display = "none";
                        return;
                    }

                    const rect = el.getBoundingClientRect();

                    Object.assign(overlay.style, {
                        display: "block",
                        left: rect.left + "px",
                        top: rect.top + "px",
                        width: rect.width + "px",
                        height: rect.height + "px"
                    });
                };

                if (window.__devflowHighlightCleanup) {
                    window.__devflowHighlightCleanup();
                }

                window.addEventListener("scroll", update, true);
                window.addEventListener("resize", update);

                window.__devflowHighlightCleanup = () => {
                    window.removeEventListener("scroll", update, true);
                    window.removeEventListener("resize", update);
                    overlay.remove();
                    delete window.__devflowHighlightCleanup;
                };

                update();

                return { success: true };
            })()
        `);
    } catch (error) {
        return { success: false, error: error.message };
    }
});


secureOn("tools:open-menu", (event, point) => {
    if (!isTrustedRenderer(event) || !mainWindow || mainWindow.isDestroyed()) return;

    if (!toolsWindow || toolsWindow.isDestroyed()) createToolsMenuWindow();

    const cursorPoint = point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? point
        : screen.getCursorScreenPoint();
    const workArea = screen.getDisplayNearestPoint(cursorPoint).workArea;
    const width = 270;
    const height = 545;
    const x = Math.max(workArea.x, Math.min(cursorPoint.x - 12, workArea.x + workArea.width - width));
    const y = Math.max(workArea.y, Math.min(cursorPoint.y + 14, workArea.y + workArea.height - height));

    toolsWindowRequested = true;
    toolsWindow.setBounds({ x, y, width, height });
    if (toolsWindowReady) toolsWindow.webContents.send("tools:active", activeTool);
    if (toolsWindowReady) {
        toolsWindow.show();
        toolsWindow.focus();
    }
});

secureOn("tools:select", (event, toolId) => {
    if (!toolsWindow || event.sender !== toolsWindow.webContents) return;

    const validTools = [
        "",
        "bookmarks",
        "history",
        "api",
        "developer",
        "network",
        "downloads",
        "settings",
        "responsive",
        "private-tab",
        "inspector",
        "permissions"
    ];
    if (!validTools.includes(toolId)) return;

    if (toolId === "private-tab") {
        createTab("https://www.google.com", true);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("tools:selected", toolId);
    }

    hideToolsMenu();
});

secureHandle("tools:get-theme", (event) => {
    if (!toolsWindow || event.sender !== toolsWindow.webContents) return "dark";
    return database.getSettings().theme || "dark";
});

secureOn("tools:set-active", (event, toolId) => {
    if (!isTrustedRenderer(event) || typeof toolId !== "string") return;
    activeTool = toolId;
    if (toolsWindow && !toolsWindow.isDestroyed()) toolsWindow.webContents.send("tools:active", activeTool);
});

secureOn("tools:close-menu", (event) => {
    if (toolsWindow && event.sender === toolsWindow.webContents) {
        hideToolsMenu();
    }
});

function createToolsMenuWindow() {
    toolsWindowReady = false;
    toolsWindow = new BrowserWindow({
        width: 270,
        height: 545,
        parent: mainWindow,
        frame: false,
        transparent: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false,
        skipTaskbar: true,
        backgroundColor: database.getSettings().theme === "light" ? "#edf0f5" : "#191b22",
        webPreferences: {
            preload: path.join(__dirname, "tools-menu-preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    const currentToolsWindow = toolsWindow;
    currentToolsWindow.on("blur", hideToolsMenu);
    currentToolsWindow.on("closed", () => {
        if (toolsWindow === currentToolsWindow) {
            toolsWindow = null;
            toolsWindowReady = false;
        }
    });
    currentToolsWindow.once("ready-to-show", () => {
        toolsWindowReady = true;
        if (toolsWindowRequested && !currentToolsWindow.isDestroyed()) {
            currentToolsWindow.show();
            currentToolsWindow.focus();
            currentToolsWindow.webContents.send("tools:active", activeTool);
        }
    });
    currentToolsWindow.loadFile(path.join(__dirname, "tools-menu.html"));
}

function hideToolsMenu() {
    toolsWindowRequested = false;
    if (toolsWindow && !toolsWindow.isDestroyed() && toolsWindow.isVisible()) {
        toolsWindow.hide();
    }
}

function isTrustedRenderer(event) {
    return !!mainWindow &&
        !mainWindow.isDestroyed() &&
        event.sender === mainWindow.webContents &&
        event.senderFrame === event.sender.mainFrame &&
        isDevFlowAppUrl(event.senderFrame.url);
}

secureHandle("downloads:get-all", (event) => {
    if (!isTrustedRenderer(event)) return [];

    const savedDownloads = database.getDownloads();

    const privateVisible = Boolean(tabs.get(activeTabId)?.isPrivate);
    const activeDownloads = [...downloads.values()]
        .filter(download => !download.isPrivate || privateVisible)
        .map(getDownloadSnapshot);

    const activeIds = new Set(
        activeDownloads.map(item => item.id)
    );

    return [
        ...activeDownloads,
        ...savedDownloads.filter(item => !activeIds.has(item.id))
    ].sort((a, b) => b.startedAt - a.startedAt);
});

secureHandle("downloads:choose-location", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: "Window is unavailable" };
    const result = await dialog.showOpenDialog(mainWindow, { title: "Choose download folder", properties: ["openDirectory", "createDirectory"] });
    return result.canceled || !result.filePaths[0]
        ? { success: false, canceled: true }
        : (() => {
            const selectedPath = path.resolve(result.filePaths[0]);
            approvedDownloadLocations.add(selectedPath);
            return { success: true, path: selectedPath };
        })();
});

secureHandle("downloads:control", (event, data) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (!data || typeof data.id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const download = downloads.get(data.id);

    if (!canAccessDownload(download)) {
        return { success: false, error: "Download not found" };
    }

    try {
        if (data.action === "pause") {
            download.item.pause();
        } else if (data.action === "resume") {
            if (!download.item.isPaused() && !download.item.canResume()) {
                return { success: false, error: "Download cannot be resumed" };
            }

            download.item.resume();
        } else if (data.action === "cancel") {
            download.item.cancel();
        } else {
            return { success: false, error: "Invalid action" };
        }

        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});


secureHandle("downloads:remove", (event, id) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const liveDownload = downloads.get(id);
    if (liveDownload && !canAccessDownload(liveDownload)) return { success: false, error: "Download not found" };

    // Do not remove an active download.
    if (
        liveDownload &&
        ["progressing", "paused"].includes(liveDownload.state)
    ) {
        return {
            success: false,
            error: "Cancel the active download before removing it"
        };
    }

    downloads.delete(id);
    database.deleteDownload(id);
    publishDownloads();

    return { success: true };
});


secureHandle("downloads:clear-history", (event) => {
    if (!isTrustedRenderer(event)) {
        return {
            success: false,
            error: "Unauthorized request"
        };
    }

    try {
        // Keep downloads that are still active or paused.
        const activeDownloads = [...downloads.values()].filter(
            item => !item.isPrivate && ["progressing", "paused"].includes(item.state)
        );

        // Remove all saved download history.
        database.clearDownloads();

        // Remove completed and failed downloads from memory.
        for (const [id, download] of downloads.entries()) {
            if (!["progressing", "paused"].includes(download.state)) {
                downloads.delete(id);
            }
        }

        // Preserve active downloads in JSON storage.
        activeDownloads.filter(download => !download.isPrivate).forEach(download => {
            database.saveDownload(getDownloadSnapshot(download));
        });

        publishDownloads();

        return {
            success: true,
            removed: database.getDownloads().length === 0
                ? undefined
                : undefined
        };

    } catch (error) {
        console.error("Clear download history error:", error);

        return {
            success: false,
            error: error.message || "Could not clear download history"
        };
    }
});



secureHandle("downloads:open-file", async (event, id) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const download = getDownloadRecord(id);

    if (!canAccessDownload(download) || download.state !== "completed") {
        return {
            success: false,
            error: "Download is not complete"
        };
    }

    const filePath = download.filePath;

    if (!filePath || !isWithinDirectory(download.downloadDirectory || app.getPath("downloads"), filePath) || !fs.existsSync(filePath)) {
        return {
            success: false,
            error: "Downloaded file does not exist"
        };
    }

    const error = await shell.openPath(filePath);

    return error
        ? { success: false, error }
        : { success: true };
});


secureHandle("downloads:show-folder", (event, id) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const download = getDownloadRecord(id);

    if (!canAccessDownload(download)) {
        return {
            success: false,
            error: "Download not found"
        };
    }

    const filePath = download.filePath;

    if (!filePath || !isWithinDirectory(download.downloadDirectory || app.getPath("downloads"), filePath) || !fs.existsSync(filePath)) {
        return {
            success: false,
            error: "Downloaded file does not exist"
        };
    }

    shell.showItemInFolder(filePath);

    return { success: true };
});



function getDownloadRecord(id) {
    const liveDownload = downloads.get(id);

    if (liveDownload) {
        let filePath = liveDownload.filePath || "";

        try {
            filePath = liveDownload.item?.getSavePath() || filePath;
        } catch {
            // Use the saved file path if DownloadItem is unavailable.
        }

        return {
            ...liveDownload,
            filePath
        };
    }

    // Look up downloads saved in the JSON database.
    return database.getDownloads().find(item => item.id === id) || null;
}

function canAccessDownload(download) {
    return Boolean(download) && (!download.isPrivate || Boolean(tabs.get(activeTabId)?.isPrivate));
}


app.whenReady().then(() => {
    setupNetworkMonitoring();
    setupDownloadManager();
    createWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});


