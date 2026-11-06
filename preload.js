"use strict";

const {contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("tbNative", {
	siteInfo: () => ipcRenderer.invoke("site:info"),
	changeSite: () => ipcRenderer.invoke("site:change"),
	resetSite: () => ipcRenderer.invoke("site:reset"),
	relaunch: () => ipcRenderer.invoke("app:relaunch"),
	filesInfo: () => ipcRenderer.invoke("files:info"),
	openFolder: (kind) => ipcRenderer.invoke("files:open", kind),
	updaterCheck: () => ipcRenderer.invoke("updater:check"),
	updaterRun: (opts) => ipcRenderer.invoke("updater:run", opts),
	updaterCancel: () => ipcRenderer.invoke("updater:cancel"),
	onUpdaterProgress: (fn) => {
		const h = (evt, p) => fn(p);
		ipcRenderer.on("updater:progress", h);
		return () => ipcRenderer.removeListener("updater:progress", h);
	},
	readStore: () => ipcRenderer.invoke("store:read"),
	writeStore: (data) => ipcRenderer.invoke("store:write", data),
	exportFile: (defaultName, data) => ipcRenderer.invoke("store:exportFile", {defaultName, data}),
	importFile: () => ipcRenderer.invoke("store:importFile"),
	exportPdf: (args) => ipcRenderer.invoke("export:pdf", args),
	openPath: (p) => ipcRenderer.invoke("shell:openPath", p),
	showItem: (p) => ipcRenderer.invoke("shell:showItem", p),
	getPrintPayload: (jobId) => ipcRenderer.invoke("print:getPayload", jobId),
	printReady: (jobId, result) => ipcRenderer.send("print:ready", jobId, result),
	selftestPayload: (data) => ipcRenderer.send("selftest:payload", data),
	appUpdateInfo: () => ipcRenderer.invoke("appupdate:info"),
	appUpdateCheck: () => ipcRenderer.invoke("appupdate:check"),
	appUpdateInstall: () => ipcRenderer.invoke("appupdate:install"),
	appUpdateInstallBytes: (data) => ipcRenderer.invoke("appupdate:installBytes", data),
	appUpdateUseBuiltIn: () => ipcRenderer.invoke("appupdate:useBuiltIn"),
});
