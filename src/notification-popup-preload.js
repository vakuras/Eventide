const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronNotif', {
  onShow: (callback) => ipcRenderer.on('notification:show', (_, data) => callback(data)),
  click: () => ipcRenderer.send('notification-popup:click'),
  dismiss: () => ipcRenderer.send('notification-popup:dismiss'),
});
