const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcApi', {
  send: (channel, data) => {
    const validChannels = ['minimize-window', 'close-window', 'open-github-link', 'log-ping', 'ping-response'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
});

contextBridge.exposeInMainWorld('pingApi', {
  ping: (host) => ipcRenderer.invoke('ping-host', host)
});
