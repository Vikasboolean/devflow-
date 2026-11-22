
const { contextBridge, ipcRenderer } = require("electron");
const initialTheme = process.argv.find(argument => argument.startsWith("--devflow-theme="))?.split("=")[1] === "light" ? "light" : "dark";

contextBridge.exposeInMainWorld("browserAPI", {
  initialTheme,
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),
  hardReload: () => ipcRenderer.invoke("browser:hard-reload"),
  stopLoading: () => ipcRenderer.invoke("browser:stop-loading"),

  retryPage: () => ipcRenderer.invoke("browser:retry"),

  setViewVisible: (visible) =>
    ipcRenderer.send("browser:set-visible", visible),

  openToolsMenu: (point) => ipcRenderer.send("tools:open-menu", point),
  setActiveTool: (toolId) => ipcRenderer.send("tools:set-active", toolId),

  onToolSelected: (callback) => {
    const listener = (_, toolId) => callback(toolId);
    ipcRenderer.on("tools:selected", listener);
    return () => ipcRenderer.removeListener("tools:selected", listener);
  },

  createTab: (url) =>
    ipcRenderer.invoke("browser:create-tab", url),

  duplicateTab: (id) => ipcRenderer.invoke("browser:duplicate-tab", id),
  openBlockedPopup: (data) => ipcRenderer.invoke("browser:open-blocked-popup", data),
  reopenClosedTab: () => ipcRenderer.invoke("browser:reopen-closed-tab"),
  setTabPinned: (id, pinned) => ipcRenderer.invoke("browser:set-tab-pinned", { id, pinned }),
  closePinnedTab: (id) => ipcRenderer.invoke("browser:close-pinned-tab", id),
  closeOtherTabs: (id) => ipcRenderer.invoke("browser:close-other-tabs", id),
  closeTabsToRight: (id) => ipcRenderer.invoke("browser:close-tabs-right", id),
  reloadTab: (id) => ipcRenderer.invoke("browser:reload-tab", id),
  toggleTabMute: (id) => ipcRenderer.invoke("browser:toggle-tab-mute", id),
  findInPage: (data) => ipcRenderer.invoke("browser:find-in-page", data),
  stopFindInPage: (tabId) => ipcRenderer.invoke("browser:stop-find-in-page", tabId),
  onFindResult: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("browser:find-result", listener);
    return () => ipcRenderer.removeListener("browser:find-result", listener);
  },
  onBrowserShortcut: (callback) => {
    const listener = (_, action) => callback(action);
    ipcRenderer.on("browser:shortcut", listener);
    return () => ipcRenderer.removeListener("browser:shortcut", listener);
  },
  clearBrowsingData: (data) => ipcRenderer.invoke("browser:clear-data", data),
  getSearchSuggestions: (query, engine) => ipcRenderer.invoke("browser:search-suggestions", { query, engine }),

  createPrivateTab: (url) =>
    ipcRenderer.invoke("browser:create-private-tab", url),

  switchTab: (id) =>
    ipcRenderer.invoke("browser:switch-tab", id),

  closeTab: (id) =>
    ipcRenderer.invoke("browser:close-tab", id),

  getTabs: () =>
    ipcRenderer.invoke("browser:get-tabs"),

  resize: (bounds) =>
    ipcRenderer.send("browser:resize", bounds),

  addBookmark: (data) =>
    ipcRenderer.invoke("db:add-bookmark", data),

  getBookmarks: () =>
    ipcRenderer.invoke("db:get-bookmarks"),

  deleteBookmark: (id) =>
    ipcRenderer.invoke("db:delete-bookmark", id),

  getHistory: () =>
    ipcRenderer.invoke("db:get-history"),

  clearHistory: () =>
    ipcRenderer.invoke("db:clear-history"),

  sendApiRequest: (data) =>
    ipcRenderer.invoke("api:send-request", data),

  // Network Monitor
  getNetworkRequests: (tabId) =>
    ipcRenderer.invoke("browser:get-network-requests", tabId),

  clearNetworkRequests: (tabId) =>
    ipcRenderer.invoke("browser:clear-network-requests", tabId),

  setNetworkRequestBlocked: (url, blocked) =>
    ipcRenderer.invoke("browser:set-request-blocked", { url, blocked }),

  onNetworkUpdated: (callback) => {
    const listener = (_, data) => callback(data);

    ipcRenderer.on("browser:network-updated", listener);

    return () =>
      ipcRenderer.removeListener("browser:network-updated", listener);
  },

  // API Collections
  addCollection: (name) =>
    ipcRenderer.invoke("api:add-collection", name),

  getCollections: () =>
    ipcRenderer.invoke("api:get-collections"),

  deleteCollection: (id) =>
    ipcRenderer.invoke("api:delete-collection", id),

  // Saved API Requests
  saveApiRequest: (data) =>
    ipcRenderer.invoke("api:save-request", data),

  getSavedRequests: (collectionId) =>
    ipcRenderer.invoke("api:get-saved-requests", collectionId),

  getSavedRequest: (id) => ipcRenderer.invoke("api:get-saved-request", id),

  deleteSavedRequest: (id) =>
    ipcRenderer.invoke("api:delete-saved-request", id),

  executeJavaScript: (code) =>
    ipcRenderer.invoke("browser:execute-js", code),

  // Developer Console
  onConsoleMessage: (callback) => {
    if (typeof callback !== "function") return () => { };

    const listener = (_, data) => callback(data);

    ipcRenderer.on("browser:console-message", listener);

    return () =>
      ipcRenderer.removeListener("browser:console-message", listener);
  },

  // Browser Tabs
  onTabsUpdated: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("browser:tabs-updated", listener);

    return () =>
      ipcRenderer.removeListener("browser:tabs-updated", listener);
  },

  onPopupBlocked: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("browser:popup-blocked", listener);
    return () => ipcRenderer.removeListener("browser:popup-blocked", listener);
  },

  onWindowResize: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("browser:window-resized", listener);

    return () =>
      ipcRenderer.removeListener("browser:window-resized", listener);
  },

  // Browser Settings

  getSettings: () =>
    ipcRenderer.invoke("settings:get"),

  getWebsitePermissions: () => ipcRenderer.invoke("permissions:get"),
  setWebsitePermission: (data) => ipcRenderer.invoke("permissions:set", data),
  resetWebsitePermissions: (origin) => ipcRenderer.invoke("permissions:reset-origin", origin),
  onWebsitePermissionsUpdated: (callback) => {
    const listener = (_, data) => callback(data);
    ipcRenderer.on("permissions:updated", listener);
    return () => ipcRenderer.removeListener("permissions:updated", listener);
  },

  updateSettings: (settings) =>
    ipcRenderer.invoke("settings:update", settings),

  // Download Manager
  getDownloads: () =>
    ipcRenderer.invoke("downloads:get-all"),

  controlDownload: (id, action) =>
    ipcRenderer.invoke("downloads:control", { id, action }),

  removeDownload: (id) =>
    ipcRenderer.invoke("downloads:remove", id),


  clearDownloadHistory: () =>
    ipcRenderer.invoke("downloads:clear-history"),


  openDownloadedFile: (id) =>
    ipcRenderer.invoke("downloads:open-file", id),

  showDownloadFolder: (id) =>
    ipcRenderer.invoke("downloads:show-folder", id),

  onDownloadsUpdated: (callback) => {
    if (typeof callback !== "function") return () => { };

    const listener = (_, data) => callback(data);

    ipcRenderer.on("downloads:updated", listener);

    return () =>
      ipcRenderer.removeListener("downloads:updated", listener);
  },

  // Responsive Design Mode
  setResponsiveMode: (settings) =>
    ipcRenderer.invoke("browser:responsive-mode", settings),

  resetResponsiveMode: () =>
    ipcRenderer.invoke("browser:responsive-reset"),

  // Element Inspector
  startElementInspection: () =>
    ipcRenderer.invoke("inspector:start"),

  stopElementInspection: () =>
    ipcRenderer.invoke("inspector:stop"),

  getDOMTree: () =>
  ipcRenderer.invoke("inspector:get-dom-tree"),

selectDOMElement: (selector) =>
  ipcRenderer.invoke("inspector:select-dom-element", selector),

updateElementStyle: (selector, property, value) =>
  ipcRenderer.invoke(
    "inspector:update-element-style",
    { selector, property, value }
  ),

  deleteDOMElement: (selector) =>
  ipcRenderer.invoke("inspector:delete-element", selector),

  getElementBoxModel: (selector) =>
  ipcRenderer.invoke("inspector:get-box-model", selector),

highlightDOMElement: (selector) =>
  ipcRenderer.invoke("inspector:highlight-element", selector),

updateElementHTML: (selector, html) =>
  ipcRenderer.invoke("inspector:update-element-html", {
    selector,
    html
  }),

  mutateDOM: (data) => ipcRenderer.invoke("inspector:mutate-dom", data),
  undoInspector: () => ipcRenderer.invoke("inspector:history", "undo"),
  redoInspector: () => ipcRenderer.invoke("inspector:history", "redo"),

  onElementSelected: (callback) => {
    if (typeof callback !== "function") return () => {};

    const listener = (_, data) => callback(data);

    ipcRenderer.on("inspector:element-selected", listener);

    return () =>
      ipcRenderer.removeListener("inspector:element-selected", listener);
  }
});
