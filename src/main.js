const { app, BrowserWindow, dialog, ipcMain, shell, session } = require('electron');
const path = require('path');
const isAdmin = require('is-admin');
const fs = require('fs');
const ping = require('ping');
const os = require('os');

function getLogPath() {
  try {
    let logPath;
    if (app.isPackaged) {
      const exePath = path.dirname(app.getPath('exe'));
      logPath = path.join(exePath, 'log.txt');
    } else {
      logPath = path.join(app.getAppPath(), 'log.txt');
    }

    const logDir = path.dirname(logPath);

    if (!fs.existsSync(logDir)) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        console.log('Created directory:', logDir);
      } catch (mkdirError) {
        console.error('Error creating directory:', mkdirError);
        throw mkdirError;
      }
    }

    if (!fs.existsSync(logPath)) {
      try {
        fs.writeFileSync(logPath, '');
        console.log('Created log file:', logPath);
      } catch (fileError) {
        console.error('Error creating log file:', fileError);
        throw fileError;
      }
    }

    return logPath;
  } catch (error) {
    console.error('Error in getLogPath:', error);
    throw error;
  }
}

function writeLog(message) {
  try {
    const logPath = getLogPath();
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logPath, logMessage);
  } catch (error) {
    console.error('Error writing to log:', error);
    dialog.showErrorBox('Log Write Error', `Error writing to log file: ${error.message}`);
  }
}

function resetLog() {
  try {
    const logPath = getLogPath();
    fs.writeFileSync(logPath, '');
    console.log('Log file reset successfully');
  } catch (error) {
    console.error('Error resetting log file:', error);
    dialog.showErrorBox('Log Reset Error', `Error resetting log file: ${error.message}`);
  }
}

ipcMain.on('log-ping', (event, logMessage) => {
  writeLog(logMessage);
});

ipcMain.handle('ping-host', async (event, host) => {
  try {
    const res = await ping.promise.probe(host, {
      timeout: 10,
      extra: ['-c', '1'],
    });
    const message = res.alive ? `Success (${res.time} ms)` : 'No Response';
    writeLog(`Ping to ${host}: ${message}`);
    return {
      alive: res.alive,
      time: res.time,
      error: null,
    };
  } catch (error) {
    writeLog(`Ping to ${host}: Error: ${error.message}`);
    return {
      alive: false,
      time: null,
      error: error.message,
    };
  }
});

ipcMain.on('open-github-link', () => {
  shell.openExternal('https://github.com/SM8KE1/PulseNet');
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-username', () => {
  try {
    return os.userInfo().username || 'User';
  } catch (error) {
    return 'User';
  }
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
    },
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, '../assets/icon.ico'),
    title: 'PulseNet'
  });


  mainWindow.setMenu(null);

  const devServerURL = process.env.VITE_DEV_SERVER_URL;

  if (devServerURL) {
    mainWindow.loadURL(devServerURL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }


  ipcMain.on('minimize-window', () => {
    mainWindow.minimize();
  });

  ipcMain.on('close-window', () => {
    mainWindow.close();
  });


}

async function checkAdmin() {
  try {
    const admin = await isAdmin();
    if (!admin) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Admin Access Required',
        message: 'This application requires administrator access to run ping commands. Please run the application as administrator.',
        buttons: ['OK']
      });
    }
  } catch (error) {
    console.error('Error checking admin rights:', error);
  }
}

app.whenReady().then(async () => {
  if (!process.env.VITE_DEV_SERVER_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["script-src 'self'"],
        },
      });
    });
  }

  resetLog();
  await checkAdmin();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
