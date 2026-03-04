const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  scrapeManabox: (url) => ipcRenderer.invoke('scrape-manabox', url),
  printToPDF:    (html) => ipcRenderer.invoke('print-to-pdf', html),
});