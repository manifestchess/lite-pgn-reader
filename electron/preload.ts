import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

import { createElectronApi, type Bridge } from "./preload-api";

type Handler = (event: IpcRendererEvent, ...args: unknown[]) => void;
const wrappers = new Map<(...args: unknown[]) => void, Handler>();

const bridge: Bridge = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  on: (channel, listener) => {
    const wrapped: Handler = (_event, ...args) => listener(...args);
    wrappers.set(listener, wrapped);
    ipcRenderer.on(channel, wrapped);
  },
  removeListener: (channel, listener) => {
    const wrapped = wrappers.get(listener);
    if (wrapped) {
      ipcRenderer.removeListener(channel, wrapped);
      wrappers.delete(listener);
    }
  },
  pathForFile: (file) => webUtils.getPathForFile(file as File),
};

contextBridge.exposeInMainWorld("electronAPI", createElectronApi(bridge));
