const database = require("./database.cjs");
const {
    app,
    BrowserWindow,
    WebContentsView,
    ipcMain,
    safeStorage,
    session,
    shell
} = require("electron");

const path = require("path");
const { randomUUID } = require("crypto");

let mainWindow;
let tabs = new Map();
let activeTabId = null;
let viewBounds = { x: 220, y: 110, width: 900, height: 700 };
let networkMonitoringInitialized = false;
const networkRequests = new Map();
const MAX_NETWORK_REQUESTS = 500;
// Download Manager
const downloads = new Map();
const MAX_DOWNLOAD_HISTORY = 200;

function isSafeUrl(value) {
    try {
        const parsed = new URL(value);
        return ["http:", "https:"].includes(parsed.protocol);
    } catch {
        return false;
    }
}

function saveCurrentHistory(tab) {
    if (!tab || !tab.url || !isSafeUrl(tab.url)) return;

    try {
        database.addHistory(tab.title || "Untitled", tab.url);
    } catch (error) {
        console.error("History save error:", error);
    }
}

function getTabData() {
    return [...tabs.values()].map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        loading: tab.loading
    }));
}

function publishTabs() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    mainWindow.webContents.send("browser:tabs-updated", {
        tabs: getTabData(),
        activeTabId
    });
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
        startedAt: download.startedAt,
        completedAt: download.completedAt ?? null,
        error: download.error || null
    };
}

function publishDownloads() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const items = [...downloads.values()]
        .sort((a, b) => b.startedAt - a.startedAt)
        .map(getDownloadSnapshot);

    mainWindow.webContents.send("downloads:updated", items);
}

function setupDownloadManager() {
    const downloadSession = session.defaultSession;

    downloadSession.setDownloadPath(app.getPath("downloads"));

    downloadSession.on("will-download", (event, item, webContents) => {

        // Automatically save downloads without showing Save As dialog
        const downloadsFolder = app.getPath("downloads");

        const originalName = path.basename(item.getFilename());
        const parsedName = path.parse(originalName);

        let savePath = path.join(downloadsFolder, originalName);
        let counter = 1;

        while (require("fs").existsSync(savePath)) {
            savePath = path.join(
                downloadsFolder,
                `${parsedName.name} (${counter})${parsedName.ext}`
            );
            counter++;
        }

        item.setSavePath(savePath);


        const id = randomUUID();
        const now = Date.now();

        const download = {
            id,
            item,
            filename: item.getFilename(),
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
            startedAt: now,
            completedAt: null,
            error: null
        };

        downloads.set(id, download);

        database.saveDownload(getDownloadSnapshot(download));

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

            database.saveDownload(getDownloadSnapshot(download));
            publishDownloads();

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
                    const notification = new Notification({
                        title,
                        body,
                        silent: false
                    });

                    notification.on("click", () => {
                        if (state === "completed" && download.filePath) {
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

    mainWindow.webContents.send("browser:console-message", {
        tabId: tab.id,
        level: message.level,
        message: String(message.message || "").slice(0, 10000),
        source: String(message.sourceId || "").slice(0, 2000),
        lineNumber: Number(message.lineNumber) || 0,
        timestamp: new Date().toISOString()
    });
}

function updateActiveBounds() {
    const activeTab = tabs.get(activeTabId);
    if (activeTab) {
        activeTab.view.setBounds(viewBounds);
    }
}

function createTab(url = "https://www.google.com") {
    const id = randomUUID();

    const view = new WebContentsView({
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true
        }
    });

    const tab = {
        id,
        view,
        title: "New Tab",
        url,
        loading: true
    };

    tabs.set(id, tab);
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
        if (isSafeUrl(url)) createTab(url);
        return { action: "deny" };
    });

    wc.on("page-title-updated", (_, title) => {
        tab.title = title || "Untitled";
        publishTabs();
    });

    wc.on("did-start-loading", () => {
        tab.loading = true;
        publishTabs();
    });

    wc.on("did-stop-loading", () => {
        tab.loading = false;
        tab.url = wc.getURL();
        tab.title = wc.getTitle() || tab.title;

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

    wc.loadURL(url).catch((error) => {
        console.error("Page loading error:", error);
    });

    publishTabs();
    return id;
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
}

function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;

    const wasActive = activeTabId === id;

    if (wasActive) {
        mainWindow.contentView.removeChildView(tab.view);
    }

    tab.view.webContents.close();
    tabs.delete(id);

    if (tabs.size === 0) {
        createTab();
        return;
    }

    if (wasActive) {
        const nextId = [...tabs.keys()][0];
        switchTab(nextId);
    } else {
        publishTabs();
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 1000,
        minHeight: 650,
        title: "DevFlow Browser",
        backgroundColor: "#101114",
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });


    mainWindow.on("resize", () => {
        const contentBounds = mainWindow.getContentBounds();

        viewBounds.width = Math.max(
            0,
            contentBounds.width - viewBounds.x
        );

        viewBounds.height = Math.max(
            0,
            contentBounds.height - viewBounds.y
        );

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

    createTab();

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

ipcMain.handle("browser:create-tab", (_, url) => {
    return createTab(isSafeUrl(url) ? url : "https://www.google.com");
});

ipcMain.handle("db:add-bookmark", (_, data) => {
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

ipcMain.handle("db:get-bookmarks", () => database.getBookmarks());

ipcMain.handle("db:delete-bookmark", (_, id) => {
    if (!Number.isSafeInteger(id) || id < 1) return false;

    database.deleteBookmark(id);
    return true;
});

ipcMain.handle("db:get-history", () => database.getHistory());

ipcMain.handle("db:clear-history", () => {
    database.clearHistory();
    return true;
});

ipcMain.handle("browser:switch-tab", (_, id) => {
    switchTab(id);
});

ipcMain.handle("browser:close-tab", (_, id) => {
    closeTab(id);
});

ipcMain.handle("browser:get-tabs", () => ({
    tabs: getTabData(),
    activeTabId
}));

ipcMain.handle("browser:get-network-requests", (_, tabId) => {
    if (typeof tabId !== "string") return [];

    return [...networkRequests.values()]
        .filter(item => item.tabId === tabId);
});

ipcMain.handle("browser:clear-network-requests", (_, tabId) => {
    if (typeof tabId !== "string") return false;

    for (const [key, item] of networkRequests.entries()) {
        if (item.tabId === tabId) {
            networkRequests.delete(key);
        }
    }

    return true;
});

ipcMain.handle("browser:navigate", async (_, url) => {
    if (!isSafeUrl(url)) return;

    const tab = tabs.get(activeTabId);
    if (tab) await tab.view.webContents.loadURL(url);
});

ipcMain.handle("browser:back", () => {
    const wc = tabs.get(activeTabId)?.view.webContents;
    if (wc?.canGoBack()) wc.goBack();
});

ipcMain.handle("browser:forward", () => {
    const wc = tabs.get(activeTabId)?.view.webContents;
    if (wc?.canGoForward()) wc.goForward();
});

ipcMain.handle("browser:reload", () => {
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

// ==========================================
// JAVASCRIPT EXECUTOR
// ==========================================

ipcMain.handle("browser:execute-js", async (event, code) => {
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
            error: error.message || "JavaScript execution failed"
        };
    }
});


// ==========================================
// API COLLECTION IPC HANDLERS
// ==========================================

ipcMain.handle("api:add-collection", (_, name) => {
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

ipcMain.handle("api:get-collections", () => {
    return database.getCollections();
});

ipcMain.handle("api:delete-collection", (_, id) => {
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

ipcMain.handle("api:save-request", (_, data) => {
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

ipcMain.handle("api:get-saved-requests", (_, collectionId) => {
    if (!Number.isSafeInteger(collectionId) || collectionId < 1) {
        return [];
    }

    try {
        return database.getSavedRequests(collectionId).map(item => {
            let authConfig = {};

            try {
                const encrypted = JSON.parse(item.auth_config || '""');
                authConfig = decryptAuthConfig(encrypted);
            } catch {
                authConfig = {};
            }

            return {
                ...item,
                headers: JSON.parse(item.headers || "{}"),
                authConfig
            };
        });
    } catch (error) {
        console.error("Retrieve saved requests error:", error);
        return [];
    }
});

ipcMain.handle("api:delete-saved-request", (_, id) => {
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

ipcMain.handle("api:send-request", async (_, data) => {
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

    if (data.body !== undefined && typeof data.body !== "string") {
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

        const responseText = method === "HEAD"
            ? ""
            : await result.text();

        const duration = Date.now() - startTime;

        return {
            status: result.status,
            statusText: result.statusText,
            duration,
            size: new TextEncoder().encode(responseText).length,
            headers: Object.fromEntries(result.headers.entries()),
            body: responseText.slice(0, 1024 * 1024),
            truncated: responseText.length > 1024 * 1024
        };
        // Handle authentication based on the provided type and configuration.
        // this is not working properly, need to fix it.
        const authType = data.authType || "none";
        const auth = data.authConfig || {};

        if (authType === "bearer") {
            if (!auth.token || typeof auth.token !== "string") {
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

    } catch (error) {
        return {
            error: error.name === "AbortError"
                ? "Request timed out after 30 seconds"
                : error.message || "Network request failed"
        };
    } finally {
        clearTimeout(timeout);
    }
});



ipcMain.on("browser:resize", (_, bounds) => {
    if (!bounds || !Object.values(bounds).every(Number.isFinite)) return;

    const contentBounds = mainWindow.getContentBounds();

    viewBounds = {
        x: Math.round(bounds.x),
        y: Math.round(bounds.y),
        width: Math.max(0, contentBounds.width - Math.round(bounds.x)),
        height: Math.max(0, contentBounds.height - Math.round(bounds.y))
    };

    updateActiveBounds();
});


ipcMain.on("browser:set-visible", (_, visible) => {
    const tab = tabs.get(activeTabId);
    if (!tab || !mainWindow || mainWindow.isDestroyed()) return;

    try {
        if (visible === true) {
            mainWindow.contentView.addChildView(tab.view);
        } else {
            mainWindow.contentView.removeChildView(tab.view);
        }
    } catch (error) {
        console.error("Browser visibility error:", error);
    }
});

function isTrustedRenderer(event) {
    return !!mainWindow &&
        !mainWindow.isDestroyed() &&
        event.sender === mainWindow.webContents;
}

ipcMain.handle("downloads:get-all", (event) => {
    if (!isTrustedRenderer(event)) return [];

    const savedDownloads = database.getDownloads();

    const activeDownloads = [...downloads.values()]
        .map(getDownloadSnapshot);

    const activeIds = new Set(
        activeDownloads.map(item => item.id)
    );

    return [
        ...activeDownloads,
        ...savedDownloads.filter(item => !activeIds.has(item.id))
    ].sort((a, b) => b.startedAt - a.startedAt);
});

ipcMain.handle("downloads:control", (event, data) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (!data || typeof data.id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const download = downloads.get(data.id);

    if (!download) {
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


ipcMain.handle("downloads:remove", (event, id) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const liveDownload = downloads.get(id);

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


ipcMain.handle("downloads:open-file", async (event, id) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const download = getDownloadRecord(id);

    if (!download || download.state !== "completed") {
        return {
            success: false,
            error: "Download is not complete"
        };
    }

    const filePath = download.filePath;

    if (!filePath || !require("fs").existsSync(filePath)) {
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


ipcMain.handle("downloads:show-folder", (event, id) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (typeof id !== "string") {
        return { success: false, error: "Invalid download ID" };
    }

    const download = getDownloadRecord(id);

    if (!download) {
        return {
            success: false,
            error: "Download not found"
        };
    }

    const filePath = download.filePath;

    if (!filePath || !require("fs").existsSync(filePath)) {
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


app.whenReady().then(() => {
    setupNetworkMonitoring();
    setupDownloadManager();
    createWindow();
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});


