// Minimal bridge: the only thing the renderer needs from main right now is
// vnc:// deep links coming in from the OS protocol handler.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coolVnc", {
  onVncUrl: (cb) => {
    ipcRenderer.on("vnc-url", (_e, url) => {
      try {
        cb(url);
      } catch (err) {
        console.error("[preload] onVncUrl callback threw", err);
      }
    });
  },
});
