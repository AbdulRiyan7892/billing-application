import { Capacitor, CapacitorHttp } from "@capacitor/core";
import { db, saveCustomer, saveProduct } from "../database/db";
import { getDeviceSettings, saveDeviceSettings } from "./device";

export const DEFAULT_SYNC_PORT = 52417;

/**
 * Universal HTTP request handler:
 * On Android/iOS: Uses native CapacitorHttp (bypasses WebView Mixed Content and CORS restrictions!)
 * On Electron/Web: Uses standard web fetch
 */
async function httpRequest(url, method = "GET", data = null, timeoutMs = 15000) {
  if (Capacitor.isNativePlatform()) {
    try {
      const options = {
        url,
        method,
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        connectTimeout: timeoutMs,
        readTimeout: timeoutMs
      };

      if (data && (method === "POST" || method === "PUT")) {
        options.data = data;
      }

      const res = await CapacitorHttp.request(options);
      let resData = res.data;
      if (typeof resData === "string") {
        try {
          resData = JSON.parse(resData);
        } catch {
          // keep as string
        }
      }

      return {
        ok: res.status >= 200 && res.status < 300,
        status: res.status,
        data: resData
      };
    } catch (err) {
      console.error("CapacitorHttp native request failed:", err);
      throw err;
    }
  }

  // Fallback for Desktop Electron or browser
  const fetchOptions = {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(timeoutMs)
  };

  if (data && (method === "POST" || method === "PUT")) {
    fetchOptions.body = JSON.stringify(data);
  }

  const res = await fetch(url, fetchOptions);
  let parsedData = null;
  try {
    parsedData = await res.json();
  } catch {
    parsedData = await res.text();
  }

  return {
    ok: res.ok,
    status: res.status,
    data: parsedData
  };
}

/**
 * Gathers all data on this device to send to the peer
 */
export async function getLocalSyncData() {
  const device = await getDeviceSettings();
  const invoices = await db.invoices.toArray();
  const customers = await db.customers.toArray();
  const products = await db.products.toArray();
  const counters = await db.counters.toArray();
  const deletedInvoices = db.deletedInvoices ? await db.deletedInvoices.toArray() : [];

  return {
    version: 1,
    deviceRole: device.role,
    deviceName: device.name,
    seriesPrefix: device.seriesPrefix,
    invoices,
    customers,
    products,
    counters,
    deletedInvoices,
    timestamp: new Date().toISOString()
  };
}

/**
 * Merges incoming remote data into local Dexie database
 */
export async function mergeRemoteData(remoteData) {
  if (!remoteData || !Array.isArray(remoteData.invoices)) {
    throw new Error("Invalid sync data format received");
  }

  let addedInvoices = 0;
  let updatedInvoices = 0;
  let deletedInvoicesCount = 0;
  let newCustomers = 0;
  let newProducts = 0;

  // 1. Process Deletions First (Tombstones from remote peer)
  const localDeleted = db.deletedInvoices ? await db.deletedInvoices.toArray() : [];
  const localDeletedMap = new Map(localDeleted.map(d => [d.invoiceNo, d.deletedAt]));

  if (Array.isArray(remoteData.deletedInvoices) && db.deletedInvoices) {
    for (const remDel of remoteData.deletedInvoices) {
      if (!remDel.invoiceNo) continue;

      // Save tombstone locally so this device remembers it is deleted
      if (!localDeletedMap.has(remDel.invoiceNo)) {
        await db.deletedInvoices.put({
          invoiceNo: remDel.invoiceNo,
          deletedAt: remDel.deletedAt || new Date().toISOString()
        });
        localDeletedMap.set(remDel.invoiceNo, remDel.deletedAt || new Date().toISOString());
      }

      // If the invoice is still sitting in local db.invoices, DELETE it!
      const existingLocally = await db.invoices
        .where("invoiceNo")
        .equals(remDel.invoiceNo)
        .first();

      if (existingLocally) {
        await db.invoices.delete(existingLocally.id);
        deletedInvoicesCount++;
      }
    }
  }

  // 2. Merge Invoices (ignoring any that were marked deleted)
  for (const remoteInv of remoteData.invoices) {
    if (!remoteInv.invoiceNo) continue;

    // Guard against resurrection of deleted invoices
    if (localDeletedMap.has(remoteInv.invoiceNo)) {
      continue;
    }

    const existing = await db.invoices
      .where("invoiceNo")
      .equals(remoteInv.invoiceNo)
      .first();

    if (!existing) {
      // Discard remote auto-increment id and let local Dexie assign a clean local id
      const { id, ...dataToInsert } = remoteInv;
      await db.invoices.add({
        ...dataToInsert,
        syncedAt: new Date().toISOString()
      });
      addedInvoices++;
    } else {
      // If invoice exists locally, we keep local id and update contents if remote is newer
      const existingTime = new Date(existing.syncedAt || existing.invoiceDate || 0).getTime();
      const remoteTime = new Date(remoteInv.syncedAt || remoteInv.invoiceDate || 0).getTime();

      if (remoteTime > existingTime) {
        const { id, ...dataToUpdate } = remoteInv;
        await db.invoices.put({
          ...dataToUpdate,
          id: existing.id,
          syncedAt: new Date().toISOString()
        });
        updatedInvoices++;
      }
    }
  }

  // 3. Merge Customers
  if (Array.isArray(remoteData.customers)) {
    for (const cust of remoteData.customers) {
      if (!cust.name) continue;
      const { id, ...custData } = cust;
      const savedId = await saveCustomer(custData);
      if (savedId) newCustomers++;
    }
  }

  // 4. Merge Products
  if (Array.isArray(remoteData.products)) {
    for (const prod of remoteData.products) {
      if (!prod.name) continue;
      const { id, ...prodData } = prod;
      const savedId = await saveProduct(prodData);
      if (savedId) newProducts++;
    }
  }

  return {
    addedInvoices,
    updatedInvoices,
    deletedInvoicesCount,
    newCustomers,
    newProducts
  };
}

/**
 * Client-initiated sync: sends local data to target Desktop IP and merges response
 */
export async function syncWithPeer(targetIp, port = DEFAULT_SYNC_PORT) {
  if (!targetIp || !targetIp.trim()) {
    throw new Error("Desktop IP address is required");
  }

  const cleanIp = targetIp.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").split(":")[0];
  const url = `http://${cleanIp}:${port}/api/sync`;

  const localData = await getLocalSyncData();

  const response = await httpRequest(url, "POST", localData, 25000);

  if (!response.ok) {
    let errorText = "";
    if (typeof response.data === "object" && response.data !== null) {
      errorText = response.data.error || JSON.stringify(response.data);
    } else {
      errorText = String(response.data || `HTTP ${response.status}`);
    }
    throw new Error(`Sync failed (${response.status}): ${errorText}`);
  }

  const remoteResponse = response.data;
  const mergeStats = await mergeRemoteData(remoteResponse);

  // Save successful targetIp in settings
  await saveDeviceSettings({ targetIp: cleanIp, targetPort: port, lastSyncAt: new Date().toISOString() });

  return {
    success: true,
    sentInvoices: localData.invoices.length,
    receivedInvoices: remoteResponse.invoices?.length || 0,
    addedInvoices: mergeStats.addedInvoices,
    updatedInvoices: mergeStats.updatedInvoices,
    deletedInvoices: mergeStats.deletedInvoicesCount || 0,
    peerDevice: remoteResponse.deviceName || "Desktop"
  };
}

/**
 * Test connectivity with target IP
 */
export async function checkPeerStatus(targetIp, port = DEFAULT_SYNC_PORT, timeoutMs = 2000) {
  if (!targetIp) return null;
  const cleanIp = targetIp.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").split(":")[0];
  const url = `http://${cleanIp}:${port}/api/status`;

  try {
    const res = await httpRequest(url, "GET", null, timeoutMs);
    if (res.ok && res.data && res.data.app === "arif-billing") {
      return res.data;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Quick subnet auto-scanner to locate Desktop Server on Wi-Fi or Hotspot
 */
export async function discoverDesktopServer(
  savedIp = "",
  baseSubnets = ["192.168.43", "192.168.1", "192.168.0", "192.168.29", "10.55.208", "10.0.0"],
  onProgress
) {
  // First test saved IP if provided
  if (savedIp) {
    onProgress?.(`Checking saved IP: ${savedIp}...`);
    const status = await checkPeerStatus(savedIp, DEFAULT_SYNC_PORT, 2000);
    if (status && status.app === "arif-billing") {
      return { ip: savedIp, status };
    }
  }

  // If savedIp had a subnet (e.g. 192.168.43.50 -> 192.168.43), prioritize it
  let prioritizedSubnets = [...baseSubnets];
  if (savedIp && savedIp.includes(".")) {
    const parts = savedIp.split(".");
    if (parts.length === 4) {
      const userSubnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
      prioritizedSubnets = [userSubnet, ...baseSubnets.filter(s => s !== userSubnet)];
    }
  }

  for (const subnet of prioritizedSubnets) {
    onProgress?.(`Scanning subnet ${subnet}.x on Wi-Fi / Hotspot...`);

    // Scan in chunks of 25 to avoid overwhelming network
    const chunkSize = 25;
    for (let start = 1; start <= 254; start += chunkSize) {
      const batch = [];
      const end = Math.min(start + chunkSize - 1, 254);

      for (let i = start; i <= end; i++) {
        const ip = `${subnet}.${i}`;
        batch.push(
          checkPeerStatus(ip, DEFAULT_SYNC_PORT, 800).then(result => {
            if (result && result.app === "arif-billing") {
              return { ip, status: result };
            }
            return null;
          })
        );
      }

      const results = await Promise.all(batch);
      const found = results.find(r => r !== null);
      if (found) {
        return found;
      }
    }
  }

  return null;
}
