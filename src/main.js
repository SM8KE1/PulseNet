const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('path');
const isAdmin = require('is-admin');
const fs = require('fs');


const logFilePath = path.join(__dirname, 'log.txt');


try {
  if (fs.existsSync(logFilePath)) {
    fs.unlinkSync(logFilePath);
  }
} catch (e) {
  console.error('Error resetting log.txt:', e);
}


function writeLog(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp}: ${message}\n`;
  fs.appendFileSync(logFilePath, logMessage);
}


ipcMain.on('log-ping', (event, logMessage) => {
  writeLog(logMessage);
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

  // Remove menu bar
  mainWindow.setMenu(null);

  // Load the index.html file
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Handle window control messages
  ipcMain.on('minimize-window', () => {
    mainWindow.minimize();
  });

  ipcMain.on('close-window', () => {
    mainWindow.close();
  });

  // Uncomment the following line to open DevTools by default
  // mainWindow.webContents.openDevTools();
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
