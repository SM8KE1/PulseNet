const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ipcApi', {
  send: (channel, data) => {
    // Whitelist channels
    const validChannels = ['minimize-window', 'close-window', 'open-github-link', 'log-ping', 'ping-response'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },
  // We can also expose receive channels if needed, but for now, send is enough
});

// Expose ping functionality securely
contextBridge.exposeInMainWorld('pingApi', {
  ping: (host) => ipcRenderer.invoke('ping-host', host)
});
