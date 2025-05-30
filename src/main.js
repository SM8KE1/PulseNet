const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const isAdmin = require('is-admin');
const fs = require('fs');


function writeLog(message) {
  const exePath = path.dirname(app.getPath('exe'));
  const logPath = path.join(exePath, 'log.txt');
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}\n`;

  try {
    fs.appendFileSync(logPath, logMessage);
  } catch (error) {
    console.error('Error writing to log:', error);
  }
}

function resetLog() {
  const exePath = path.dirname(app.getPath('exe'));
  const logPath = path.join(exePath, 'log.txt');
  try {
    fs.writeFileSync(logPath, '');
    console.log('Log file reset successfully');
  } catch (error) {
    console.error('Error resetting log file:', error);
  }
}

ipcMain.on('log-ping', (event, logMessage) => {
  writeLog(logMessage);
});

ipcMain.on('ping-response', (event, response) => {
  writeLog(`Ping response: ${response}`);
});

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#1a1a1a',
    icon: path.join(__dirname, '../assets/icon.ico'),
    title: 'PulseNet'
  });


  mainWindow.setMenu(null);


  mainWindow.loadFile(path.join(__dirname, 'index.html'));


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
        title: 'نیاز به دسترسی ادمین',
        message: 'این برنامه برای اجرای دستورات پینگ نیاز به دسترسی ادمین دارد. لطفا برنامه را با دسترسی ادمین اجرا کنید.',
        buttons: ['باشه']
      });
    }
  } catch (error) {
    console.error('Error checking admin rights:', error);
  }
}

app.whenReady().then(async () => {
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
