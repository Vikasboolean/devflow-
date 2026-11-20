const database = require("./database.cjs");
const {
    app,
    BrowserWindow,
    WebContentsView,
    screen,
    ipcMain,
    safeStorage,
    session,
    shell
} = require("electron");

const path = require("path");
const { randomUUID } = require("crypto");

let mainWindow;
let toolsWindow = null;
let toolsWindowReady = false;
let toolsWindowRequested = false;
let tabs = new Map();
let activeTabId = null;
let responsiveModeActive = false;
let responsiveViewBounds = null;
let viewBounds = {
    x: 0,
    y: 0,
    width: 0,
    height: 0
};
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
    return [...tabs.values()].map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        loading: tab.loading,
        isPrivate: tab.isPrivate || false,
        loadError: tab.loadError || null
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
        activeTab.view.setBounds(
            responsiveModeActive && responsiveViewBounds
                ? responsiveViewBounds
                : viewBounds
        );
    }
}

function createTab(url = null, isPrivate = false) {
    const settings = database.getSettings();

    const homepage = isSafeUrl(settings.homepage)
        ? settings.homepage
        : "https://www.google.com";

    const targetUrl = isSafeUrl(url) ? url : homepage;

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
        loading: true,
        isPrivate
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
        if (isSafeUrl(url)) {
            createTab(url, isPrivate);
        }

        return { action: "deny" };
    });

    wc.on("page-title-updated", (_, title) => {
        tab.title = title || "Untitled";
        publishTabs();
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
        if (errorCode === -3) return;

        tab.loading = false;

        tab.loadError = {
            code: errorCode,
            description: errorDescription,
            url: validatedURL
        };

        console.error("Page failed to load:", {
            errorCode,
            errorDescription,
            url: validatedURL
        });

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

    wc.loadURL(targetUrl).catch((error) => {
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


async function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;

    const wasActive = activeTabId === id;
    const wasPrivate = tab.isPrivate;

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
            try {
                const privateSession = session.fromPartition("incognito");

                await privateSession.clearStorageData();
                await privateSession.clearCache();

                console.log("Incognito session data cleared");
            } catch (error) {
                console.error("Incognito cleanup error:", error);
            }
        }
    }

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

    createToolsMenuWindow();


    mainWindow.on("close", () => {
        const settings = database.getSettings();

        if (settings.startupBehavior !== "continue") {
            return;
        }

        const openTabs = Array.from(tabs.values())
            .filter(tab => !tab.isPrivate)
            .map(tab => tab.url)
            .filter(url => isSafeUrl(url));

        database.updateSettings({
            lastSession: openTabs
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

    if (
        settings.startupBehavior === "continue" &&
        Array.isArray(settings.lastSession) &&
        settings.lastSession.length > 0
    ) {
        settings.lastSession.forEach(url => {
            if (isSafeUrl(url)) {
                createTab(url);
            }
        });
    } else if (settings.startupBehavior === "newtab") {
        createTab("https://www.google.com");
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

ipcMain.handle("browser:create-tab", (_, url) => {
    return createTab(isSafeUrl(url) ? url : "https://www.google.com");
});

ipcMain.handle("browser:create-private-tab", (_, url) => {
    return createTab(
        isSafeUrl(url) ? url : "https://www.google.com",
        true
    );
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

// Browser Settings IPC

ipcMain.handle("settings:get", (event) => {
    if (!isTrustedRenderer(event)) return null;

    return database.getSettings();
});

ipcMain.handle("settings:update", (event, newSettings) => {
    if (!isTrustedRenderer(event)) {
        return { success: false, error: "Unauthorized request" };
    }

    if (!newSettings || typeof newSettings !== "object" || Array.isArray(newSettings)) {
        return { success: false, error: "Invalid settings" };
    }

    const allowedKeys = [
        "searchEngine",
        "homepage",
        "startupBehavior",
        "theme",
        "downloadLocation"
    ];

    const safeSettings = {};

    for (const key of allowedKeys) {
        if (Object.prototype.hasOwnProperty.call(newSettings, key)) {
            safeSettings[key] = newSettings[key];
        }
    }

    try {
        database.updateSettings(safeSettings);

        return { success: true, settings: database.getSettings() };
    } catch (error) {
        console.error("Settings update error:", error);
        return { success: false, error: "Could not save settings" };
    }
});

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

ipcMain.handle("browser:retry", (event) => {
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


ipcMain.on("browser:set-visible", (_, visible) => {
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


ipcMain.handle("browser:responsive-mode", async (event, settings) => {
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


ipcMain.handle("browser:responsive-reset", async (event) => {
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

ipcMain.handle("inspector:start", async (event) => {
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

ipcMain.handle("inspector:stop", async (event) => {
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


ipcMain.on("tools:open-menu", (event, point) => {
    if (!isTrustedRenderer(event) || !mainWindow || mainWindow.isDestroyed()) return;

    if (!toolsWindow || toolsWindow.isDestroyed()) createToolsMenuWindow();

    const cursorPoint = point && Number.isFinite(point.x) && Number.isFinite(point.y)
        ? point
        : screen.getCursorScreenPoint();
    const workArea = screen.getDisplayNearestPoint(cursorPoint).workArea;
    const width = 250;
    const height = 480;
    const x = Math.max(workArea.x, Math.min(cursorPoint.x - 12, workArea.x + workArea.width - width));
    const y = Math.max(workArea.y, Math.min(cursorPoint.y + 14, workArea.y + workArea.height - height));

    toolsWindowRequested = true;
    toolsWindow.setBounds({ x, y, width, height });
    if (toolsWindowReady) {
        toolsWindow.show();
        toolsWindow.focus();
    }
});

ipcMain.on("tools:select", (event, toolId) => {
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
        "inspector"
    ];
    if (!validTools.includes(toolId)) return;

    if (toolId === "private-tab") {
        createTab("https://www.google.com", true);
    } else if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("tools:selected", toolId);
    }

    hideToolsMenu();
});

ipcMain.on("tools:close-menu", (event) => {
    if (toolsWindow && event.sender === toolsWindow.webContents) {
        hideToolsMenu();
    }
});

function createToolsMenuWindow() {
    toolsWindowReady = false;
    toolsWindow = new BrowserWindow({
        width: 250,
        height: 480,
        parent: mainWindow,
        frame: false,
        transparent: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        show: false,
        skipTaskbar: true,
        backgroundColor: "#252231",
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


ipcMain.handle("downloads:clear-history", (event) => {
    if (!isTrustedRenderer(event)) {
        return {
            success: false,
            error: "Unauthorized request"
        };
    }

    try {
        // Keep downloads that are still active or paused.
        const activeDownloads = [...downloads.values()].filter(
            item => ["progressing", "paused"].includes(item.state)
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
        activeDownloads.forEach(download => {
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


