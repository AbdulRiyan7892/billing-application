const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronSync", {
  isElectron: true,

  getServerInfo: () => {
    return ipcRenderer.invoke("sync:get-server-info");
  },

  onIncomingSync: (callback) => {
    const subscription = (event, data) => callback(data);
    ipcRenderer.on("sync:incoming-request", subscription);
    return () => {
      ipcRenderer.removeListener("sync:incoming-request", subscription);
    };
  },

  sendSyncResponse: (requestId, responseData) => {
    ipcRenderer.send("sync:response-to-client", { requestId, responseData });
  },

  sendSyncError: (requestId, error) => {
    ipcRenderer.send("sync:error-to-client", { requestId, error });
  },

  shareFile: (data) => {
    return ipcRenderer.invoke("desktop:share-file", data);
  }
});
