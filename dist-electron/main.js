"use strict";
const { app, BrowserWindow, dialog, ipcMain, shell, session } = require("electron");
const path = require("path");
const isAdmin = require("is-admin");
const fs = require("fs");
const ping = require("ping");
function getLogPath() {
  try {
    let logPath;
    if (app.isPackaged) {
      const exePath = path.dirname(app.getPath("exe"));
      logPath = path.join(exePath, "log.txt");
    } else {
      logPath = path.join(app.getAppPath(), "log.txt");
    }
    const logDir = path.dirname(logPath);
    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        console.log("Created directory:", logDir);
      } catch (mkdirError) {
        console.error("Error creating directory:", mkdirError);
        throw mkdirError;
      }
    }
    if (!fs.existsSync(logPath)) {
      try {
        fs.writeFileSync(logPath, "");
        console.log("Created log file:", logPath);
      } catch (fileError) {
        console.error("Error creating log file:", fileError);
        throw fileError;
      }
    }
    return logPath;
  } catch (error) {
    console.error("Error in getLogPath:", error);
    throw error;
  }
}
function writeLog(message) {
  try {
    const logPath = getLogPath();
    const timestamp = (/* @__PURE__ */ new Date()).toISOString();
    const logMessage = `[${timestamp}] ${message}
`;
    fs.appendFileSync(logPath, logMessage);
  } catch (error) {
    console.error("Error writing to log:", error);
    dialog.showErrorBox("خطا در نوشتن لاگ", `خطا در نوشتن فایل لاگ: ${error.message}`);
  }
}
function resetLog() {
  try {
    const logPath = getLogPath();
    fs.writeFileSync(logPath, "");
    console.log("Log file reset successfully");
  } catch (error) {
    console.error("Error resetting log file:", error);
    dialog.showErrorBox("خطا در بازنویسی لاگ", `خطا در بازنویسی فایل لاگ: ${error.message}`);
  }
}
ipcMain.on("log-ping", (event, logMessage) => {
  writeLog(logMessage);
});
ipcMain.handle("ping-host", async (event, host) => {
  try {
    const res = await ping.promise.probe(host, {
      timeout: 10,
      extra: ["-c", "1"]
    });
    const message = res.alive ? `Success (${res.time} ms)` : "No Response";
    writeLog(`Ping to ${host}: ${message}`);
    return {
      alive: res.alive,
      time: res.time,
      error: null
    };
  } catch (error) {
    writeLog(`Ping to ${host}: Error: ${error.message}`);
    return {
      alive: false,
      time: null,
      error: error.message
    };
  }
});
ipcMain.on("open-github-link", () => {
  shell.openExternal("https://github.com/SM8KE1/PulseNet");
});
let mainWindow;
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    },
    frame: false,
    titleBarStyle: "hidden",
    backgroundColor: "#1a1a1a",
    icon: path.join(__dirname, "../assets/icon.ico"),
    title: "PulseNet"
  });
  mainWindow.setMenu(null);
  const devServerURL = process.env.VITE_DEV_SERVER_URL;
  const loadVite = (url) => {
    mainWindow.loadURL(url).catch((e) => {
      console.log("Error on load URL, retrying...", e.message);
      setTimeout(() => {
        loadVite(url);
      }, 200);
    });
  };
  if (devServerURL) {
    loadVite(devServerURL);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }
  ipcMain.on("minimize-window", () => {
    mainWindow.minimize();
  });
  ipcMain.on("close-window", () => {
    mainWindow.close();
  });
}
async function checkAdmin() {
  try {
    const admin = await isAdmin();
    if (!admin) {
      dialog.showMessageBox({
        type: "warning",
        title: "نیاز به دسترسی ادمین",
        message: "این برنامه برای اجرای دستورات پینگ نیاز به دسترسی ادمین دارد. لطفا برنامه را با دسترسی ادمین اجرا کنید.",
        buttons: ["باشه"]
      });
    }
  } catch (error) {
    console.error("Error checking admin rights:", error);
  }
}
app.whenReady().then(async () => {
  if (!process.env.VITE_DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": ["script-src 'self'"]
        }
      });
    });
  }
  resetLog();
  await checkAdmin();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
