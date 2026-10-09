// Narrow bridge between the dashboard and the Electron updater — the page
// can read update state and ask for a download/install, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

// Printing a form's page images through the system print dialog.
contextBridge.exposeInMainWorld("famsPrint", {
  html: (html) => ipcRenderer.invoke("print:html", html),
});

contextBridge.exposeInMainWorld("famsUpdater", {
  getState: () => ipcRenderer.invoke("updater:get-state"),
  check: () => ipcRenderer.invoke("updater:check"),
  download: () => ipcRenderer.invoke("updater:download"),
  install: () => ipcRenderer.invoke("updater:install"),
  ackWhatsNew: () => ipcRenderer.invoke("updater:ack-whats-new"),
  onState: (callback) => {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on("updater:state", handler);
    return () => ipcRenderer.removeListener("updater:state", handler);
  },
});
