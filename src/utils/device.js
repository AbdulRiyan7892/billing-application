import { Capacitor } from "@capacitor/core";
import { db } from "../database/db";

export function detectIsMobile() {
  if (typeof Capacitor !== "undefined" && Capacitor.isNativePlatform && Capacitor.isNativePlatform()) {
    return true;
  }
  return false;
}

export async function getDeviceSettings() {
  try {
    const saved = await db.settings.get("deviceConfig");
    if (saved && saved.role) {
      return saved;
    }
  } catch (err) {
    console.error("Error reading deviceConfig:", err);
  }

  const isMobile = detectIsMobile();
  const defaultConfig = {
    key: "deviceConfig",
    role: isMobile ? "mobile" : "desktop",
    name: isMobile ? "Mobile Device" : "Desktop PC",
    seriesPrefix: isMobile ? "M-" : "",
    autoSync: false,
    targetIp: "",
    targetPort: 52417
  };

  return defaultConfig;
}

export async function saveDeviceSettings(newSettings) {
  const current = await getDeviceSettings();
  const updated = {
    ...current,
    ...newSettings,
    key: "deviceConfig",
    updatedAt: new Date().toISOString()
  };
  await db.settings.put(updated);
  return updated;
}
