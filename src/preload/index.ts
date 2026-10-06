import { contextBridge, ipcRenderer, webUtils } from "electron";
contextBridge.exposeInMainWorld("workshop", {
  call: (method: string, input: any = {}) =>
    ipcRenderer.invoke("workshop:call", method, input),
  choose: (options: any) => ipcRenderer.invoke("workshop:choose", options),
  dropPaths: (files: File[]) => {
    const paths = files
      .map((file) => webUtils.getPathForFile(file))
      .filter(Boolean);
    ipcRenderer.send("workshop:drop", paths);
    return paths;
  },
  onEvent: (callback: any) => {
    const listener = (_event: any, event: any) => callback(event);
    ipcRenderer.on("workshop:event", listener);
    return () => ipcRenderer.removeListener("workshop:event", listener);
  },
});
