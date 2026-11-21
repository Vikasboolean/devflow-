const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolsMenuAPI", {
  selectTool: (toolId) => ipcRenderer.send("tools:select", toolId),
  closeMenu: () => ipcRenderer.send("tools:close-menu"),
  getTheme: () => ipcRenderer.invoke("tools:get-theme"),
  onTheme: (callback) => {
    const listener = (_, theme) => callback(theme);
    ipcRenderer.on("tools:theme", listener);
    return () => ipcRenderer.removeListener("tools:theme", listener);
  },
  onActive: (callback) => {
    const listener = (_, toolId) => callback(toolId);
    ipcRenderer.on("tools:active", listener);
    return () => ipcRenderer.removeListener("tools:active", listener);
  }
});
