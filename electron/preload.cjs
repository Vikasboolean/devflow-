
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("browserAPI", {
  navigate: (url) => ipcRenderer.invoke("browser:navigate", url),
  back: () => ipcRenderer.invoke("browser:back"),
  forward: () => ipcRenderer.invoke("browser:forward"),
  reload: () => ipcRenderer.invoke("browser:reload"),

  retryPage: () => ipcRenderer.invoke("browser:retry"),

  setViewVisible: (visible) =>
    ipcRenderer.send("browser:set-visible", visible),

  openToolsMenu: (point) => ipcRenderer.send("tools:open-menu", point),

  onToolSelected: (callback) => {
    const listener = (_, toolId) => callback(toolId);
    ipcRenderer.on("tools:selected", listener);
    return () => ipcRenderer.removeListener("tools:selected", listener);
  },

  createTab: (url) =>
    ipcRenderer.invoke("browser:create-tab", url),

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

  onWindowResize: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("browser:window-resized", listener);

    return () =>
      ipcRenderer.removeListener("browser:window-resized", listener);
  },

  // Browser Settings

  getSettings: () =>
    ipcRenderer.invoke("settings:get"),

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

  onElementSelected: (callback) => {
    if (typeof callback !== "function") return () => {};

    const listener = (_, data) => callback(data);

    ipcRenderer.on("inspector:element-selected", listener);

    return () =>
      ipcRenderer.removeListener("inspector:element-selected", listener);
  }
});
