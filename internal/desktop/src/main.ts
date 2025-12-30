import {
  app,
  BrowserWindow,
  ipcMain,
  nativeImage,
  Menu,
  dialog,
} from "electron";
import { join } from "path";
import { readFileSync } from "fs";

// esbuild injects __dirname for CJS
declare const __dirname: string;

// Set app name BEFORE app is ready to ensure it shows in menu bar
if (process.platform === "darwin") {
  app.setName("Blink Desktop");
}

// Set dock icon for macOS
if (process.platform === "darwin" && !app.isPackaged && app.dock) {
  const iconPath = join(__dirname, "assets/icon.icns");
  const icon = nativeImage.createFromPath(iconPath);
  app.dock.setIcon(icon);
}

let mainWindow: BrowserWindow | null = null;

// Enable @electron/remote
try {
  require("@electron/remote/main").initialize();
} catch (e) {
  console.log("@electron/remote not available");
}

function createMainWindow(directory?: string) {
  const iconPath =
    process.platform === "darwin"
      ? join(__dirname, "assets/icon.icns")
      : process.platform === "win32"
        ? join(__dirname, "assets/icon.ico")
        : join(__dirname, "assets/icon.png");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    icon: iconPath,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      additionalArguments: directory ? [`--agent-directory=${directory}`] : [],
    },
    title: "Blink Desktop",
  });

  // Load the unified app
  mainWindow.loadFile(join(__dirname, "app.html"));

  try {
    require("@electron/remote/main").enable(mainWindow.webContents);
  } catch (e) {
    console.log("@electron/remote not available");
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  return mainWindow;
}

// IPC handler for setting agent directory (transitions from welcome to agent)
ipcMain.on("set-agent-directory", (event, directory: string) => {
  // The renderer will handle the transition
  event.reply("agent-directory-set", directory);
});

// IPC handler for opening file viewer windows
ipcMain.handle(
  "open-file-viewer",
  (
    event,
    data: { filePath: string; fileContent: string; directory: string }
  ) => {
    const fileWindow = new BrowserWindow({
      width: 900,
      height: 700,
      icon: join(__dirname, "assets/icon.png"),
      title: data.filePath,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
    });

    // Store the file data for the window to access
    (fileWindow as any).fileData = data;

    fileWindow.loadFile(join(__dirname, "file-viewer.html"));

    try {
      require("@electron/remote/main").enable(fileWindow.webContents);
    } catch (e) {
      console.log("@electron/remote not available");
    }

    // Add context menu for copy/paste
    fileWindow.webContents.on("context-menu", (event, params) => {
      const contextMenu = Menu.buildFromTemplate([
        {
          label: "Copy",
          role: "copy",
          enabled: params.selectionText.length > 0,
        },
        {
          label: "Select All",
          role: "selectAll",
        },
        { type: "separator" },
        {
          label: "Search in File",
          accelerator: "CmdOrCtrl+F",
          click: () => {
            fileWindow.webContents.send("open-search");
          },
        },
      ]);
      contextMenu.popup();
    });

    return { success: true };
  }
);

app.whenReady().then(() => {
  // Get version from package.json
  let appVersion = "0.1.0";
  try {
    const packageJsonPath = join(__dirname, "../package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
    appVersion = packageJson.version || appVersion;
  } catch (err) {
    console.error("Failed to read app version:", err);
  }

  // Get current year for copyright
  const currentYear = new Date().getFullYear();

  // Create custom menu to show "Blink Desktop" instead of "Electron"
  const template: any[] = [
    {
      label: "Blink Desktop",
      submenu: [
        {
          label: "About Blink Desktop",
          click: () => {
            dialog.showMessageBox({
              type: "info",
              title: "About Blink Desktop",
              message: "Blink Desktop",
              detail: `Version ${appVersion}\n\nA developer tool for building and running Blink agents.\n\n© ${currentYear} Blink`,
              buttons: ["OK"],
            });
          },
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        { type: "separator" },
        { role: "front" },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (mainWindow === null) {
    createMainWindow();
  }
});
