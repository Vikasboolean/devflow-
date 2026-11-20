const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("toolsMenuAPI", {
  selectTool: (toolId) => ipcRenderer.send("tools:select", toolId),
  closeMenu: () => ipcRenderer.send("tools:close-menu")
});
