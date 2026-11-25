const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");
const syncServer = require("./syncServer.cjs");

let mainWindow = null;

function setupApplicationMenu() {
  if (process.platform === "darwin") {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" }
        ]
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
          { role: "selectAll" }
        ]
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
          { role: "togglefullscreen" }
        ]
      },
      {
        label: "Window",
        submenu: [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
          { type: "separator" },
          { role: "window" }
        ]
      }
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
}

function getShareHelperExe() {
  // 1. In development mode (not packaged)
  if (!app.isPackaged) {
    const devPath = path.join(__dirname, "ShareHelper.exe");
    if (fs.existsSync(devPath)) return devPath;
  }

  // 2. In packaged mode, check real filesystem directories outside app.asar
  const unpackedExe = path.join(process.resourcesPath || "", "app.asar.unpacked", "electron", "ShareHelper.exe");
  try {
    if (fs.existsSync(unpackedExe)) return unpackedExe;
  } catch {}

  const resourceExe = path.join(process.resourcesPath || "", "ShareHelper.exe");
  try {
    if (fs.existsSync(resourceExe)) return resourceExe;
  } catch {}

  // 3. Fallback: Extract from app.asar into userData (which is always a physical folder on disk)
  try {
    const userDataDir = app.getPath("userData");
    const extractedExe = path.join(userDataDir, "ShareHelper.exe");
    const asarExe = path.join(__dirname, "ShareHelper.exe");

    if (fs.existsSync(asarExe)) {
      const buffer = fs.readFileSync(asarExe);
      if (!fs.existsSync(extractedExe) || fs.statSync(extractedExe).size !== buffer.length) {
        fs.writeFileSync(extractedExe, buffer);
      }
      return extractedExe;
    }
  } catch (err) {
    console.error("Failed to extract ShareHelper.exe from asar:", err);
  }

  return path.join(app.getPath("userData"), "ShareHelper.exe");
}

function setupDesktopShareIPC() {
  ipcMain.handle("desktop:share-file", async (event, { filename, base64Data, title }) => {
    try {
      if (!base64Data) {
        throw new Error("No file content provided for sharing.");
      }

      const tempDir = path.join(os.tmpdir(), "ArifBillingShares");
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const safeFilename = (filename || "Invoice.pdf").replace(/[^\w.-]/g, "_");
      const tempFilePath = path.join(tempDir, safeFilename);
      fs.writeFileSync(tempFilePath, Buffer.from(base64Data, "base64"));

      // macOS native sharing
      if (process.platform === "darwin") {
        const possibleSwiftScripts = [
          path.join(__dirname, "share_mac.swift"),
          path.join(process.resourcesPath || "", "electron", "share_mac.swift"),
          path.join(process.resourcesPath || "", "app.asar.unpacked", "electron", "share_mac.swift"),
          path.join(process.resourcesPath || "", "share_mac.swift")
        ];
        const swiftScript = possibleSwiftScripts.find(p => fs.existsSync(p));

        if (swiftScript) {
          const child = spawn("swift", [swiftScript, tempFilePath, safeFilename], {
            detached: true,
            stdio: "ignore"
          });
          child.on("error", () => {
            // Fallback: Reveal PDF in Finder so user can AirDrop or drag to WhatsApp / Mail
            shell.showItemInFolder(tempFilePath);
          });
          child.unref();
        } else {
          shell.showItemInFolder(tempFilePath);
        }

        return { success: true };
      }

      // Windows native sharing (via ShareHelper.exe)
      // Grant ALL APPLICATION PACKAGES (S-1-15-2-1) read access so UWP apps like WhatsApp can read the file
      try {
        const { execFile } = require("child_process");
        execFile("icacls", [tempFilePath, "/grant", "*S-1-15-2-1:(R)"], () => {});
      } catch {}

      const helperExe = getShareHelperExe();
      if (!helperExe || !fs.existsSync(helperExe)) {
        throw new Error("Windows Share helper binary not found: " + helperExe);
      }

      const child = spawn(helperExe, [tempFilePath, safeFilename], {
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });

      child.on("error", (err) => {
        console.error("ShareHelper spawn error:", err);
      });

      child.unref();

      return { success: true };
    } catch (err) {
      console.error("Desktop share error:", err);
      return { success: false, error: err.message };
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: "Arif Veneer and Woods - Billing",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,

    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  syncServer.setWindow(mainWindow);

  if (!app.isPackaged) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
    syncServer.setWindow(null);
  });
}

app.whenReady().then(async () => {
  app.setPath(
    "userData",
    path.join(app.getPath("appData"), "ArifVeneerBilling")
  );

  syncServer.setupIPC();
  setupDesktopShareIPC();
  setupApplicationMenu();
  try {
    await syncServer.start();
  } catch (err) {
    console.error("Failed to start Sync Server on launch:", err);
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    syncServer.stop();
    app.quit();
  }
});

app.on("before-quit", () => {
  syncServer.stop();
});
