const http = require("http");
const os = require("os");
const { ipcMain } = require("electron");

const DEFAULT_PORT = 52417;

class SyncServer {
  constructor() {
    this.server = null;
    this.port = DEFAULT_PORT;
    this.rendererWindow = null;
    this.pendingRequests = new Map();
    this.lastSyncInfo = null;
  }

  setWindow(win) {
    this.rendererWindow = win;
  }

  getLocalIPAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];
    // Filter virtual/emulated adapters across Windows, Linux, and macOS (awdl, p2p, llw, utun, bridge)
    const virtualRegex = /virtualbox|vmware|vethernet|wsl|hyper-v|npcap|loopback|bluetooth|tap|teredo|pseudo|awdl|p2p|llw|utun|bridge/i;

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family !== "IPv4" || iface.internal) continue;
        // Ignore link-local APIPA and VirtualBox default host-only subnet
        if (iface.address.startsWith("169.254.") || iface.address.startsWith("192.168.56.")) continue;
        if (virtualRegex.test(name)) continue;

        let score = 0;
        const lower = name.toLowerCase();
        const isDarwin = process.platform === "darwin";
        const isMacEn0or1 = isDarwin && (lower === "en0" || lower === "en1");
        const isWifi = lower.includes("wi-fi") || lower.includes("wifi") || lower.includes("wlan") || lower.includes("wireless") || isMacEn0or1;
        const isHotspot = iface.address.startsWith("192.168.43.");

        if (isHotspot) score += 150;
        if (isWifi) score += 100;
        if (lower.includes("ethernet") || lower.includes("lan")) score += 20;

        let typeLabel = isHotspot
          ? "Hotspot / Wi-Fi"
          : isWifi
            ? (isDarwin ? `Wi-Fi (${name})` : "Wi-Fi")
            : name;

        addresses.push({
          name: typeLabel,
          originalName: name,
          address: iface.address,
          score,
          isRecommended: false
        });
      }
    }

    addresses.sort((a, b) => b.score - a.score);

    if (addresses.length > 0) {
      addresses[0].isRecommended = true;
    } else {
      // Fallback if everything was filtered
      for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
          if (iface.family === "IPv4" && !iface.internal) {
            addresses.push({
              name,
              originalName: name,
              address: iface.address,
              isRecommended: addresses.length === 0
            });
          }
        }
      }
    }

    return addresses;
  }

  getServerInfo() {
    return {
      isRunning: !!this.server && this.server.listening,
      port: this.port,
      addresses: this.getLocalIPAddresses(),
      hostname: os.hostname(),
      lastSyncInfo: this.lastSyncInfo
    };
  }

  start(port = DEFAULT_PORT) {
    if (this.server && this.server.listening) {
      return Promise.resolve(this.getServerInfo());
    }

    this.port = port;

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Handle CORS
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

        // Health / Status check endpoint
        if (req.method === "GET" && url.pathname === "/api/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            app: "arif-billing",
            role: "desktop",
            version: 1,
            hostname: os.hostname(),
            addresses: this.getLocalIPAddresses(),
            time: Date.now()
          }));
          return;
        }

        // Sync endpoint
        if (req.method === "POST" && url.pathname === "/api/sync") {
          let body = "";

          req.on("data", chunk => {
            body += chunk;
            // Guard against massive payloads (max 50MB)
            if (body.length > 50 * 1024 * 1024) {
              req.destroy();
            }
          });

          req.on("end", async () => {
            try {
              const payload = JSON.parse(body);

              if (!this.rendererWindow || this.rendererWindow.isDestroyed()) {
                res.writeHead(503, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Desktop billing window is not available" }));
                return;
              }

              const requestId = Math.random().toString(36).substring(2, 10);

              const responsePromise = new Promise((resResolve, resReject) => {
                const timeoutId = setTimeout(() => {
                  this.pendingRequests.delete(requestId);
                  resReject(new Error("Sync request timed out in renderer"));
                }, 20000);

                this.pendingRequests.set(requestId, {
                  resolve: (data) => {
                    clearTimeout(timeoutId);
                    resResolve(data);
                  },
                  reject: (err) => {
                    clearTimeout(timeoutId);
                    resReject(err);
                  }
                });
              });

              // Forward payload to renderer
              this.rendererWindow.webContents.send("sync:incoming-request", {
                requestId,
                payload
              });

              const result = await responsePromise;
              this.lastSyncInfo = {
                timestamp: new Date().toISOString(),
                deviceName: payload.deviceName || payload.device || "Mobile Client",
                invoicesReceived: payload.invoices?.length || 0,
                invoicesSent: result.invoices?.length || 0
              };

              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(result));

            } catch (err) {
              console.error("Sync error:", err);
              res.writeHead(500, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ error: err.message || "Failed to process sync" }));
            }
          });

          return;
        }

        // Unknown route
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not Found" }));
      });

      this.server.on("error", (err) => {
        console.error("Sync Server error:", err);
        reject(err);
      });

      this.server.listen(this.port, "0.0.0.0", () => {
        console.log(`Sync Server listening on 0.0.0.0:${this.port}`);
        resolve(this.getServerInfo());
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  setupIPC() {
    ipcMain.handle("sync:get-server-info", () => {
      return this.getServerInfo();
    });

    ipcMain.on("sync:response-to-client", (event, { requestId, responseData }) => {
      if (this.pendingRequests.has(requestId)) {
        const { resolve } = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        resolve(responseData);
      }
    });

    ipcMain.on("sync:error-to-client", (event, { requestId, error }) => {
      if (this.pendingRequests.has(requestId)) {
        const { reject } = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);
        reject(new Error(error || "Renderer sync failed"));
      }
    });
  }
}

module.exports = new SyncServer();
