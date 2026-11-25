import { useEffect, useState } from "react";
import QRCode from "qrcode";
import {
  X,
  Wifi,
  RefreshCw,
  Smartphone,
  Monitor,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Search,
  Settings,
  ArrowRightLeft,
  Info
} from "lucide-react";
import { getDeviceSettings, saveDeviceSettings } from "../utils/device";
import {
  DEFAULT_SYNC_PORT,
  syncWithPeer,
  checkPeerStatus,
  discoverDesktopServer
} from "../utils/syncEngine";

export default function SyncModal({ isOpen, onClose, onSyncComplete }) {
  const [deviceConfig, setDeviceConfig] = useState(null);
  const [activeTab, setActiveTab] = useState("sync"); // "sync" | "settings"
  const [desktopInfo, setDesktopInfo] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // Mobile client sync states
  const [targetIp, setTargetIp] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState("");
  const [syncStatus, setSyncStatus] = useState(null);

  // Settings form states
  const [formRole, setFormRole] = useState("desktop");
  const [formPrefix, setFormPrefix] = useState("");
  const [formName, setFormName] = useState("");

  useEffect(() => {
    if (!isOpen) return;

    async function init() {
      const config = await getDeviceSettings();
      setDeviceConfig(config);
      setTargetIp(config.targetIp || "");
      setFormRole(config.role);
      setFormPrefix(config.seriesPrefix ?? (config.role === "mobile" ? "M-" : ""));
      setFormName(config.name);

      // Check if Electron sync server is available
      if (window.electronSync && typeof window.electronSync.getServerInfo === "function") {
        try {
          const info = await window.electronSync.getServerInfo();
          setDesktopInfo(info);

          // Find recommended physical IP (Wi-Fi or Hotspot, skipping VirtualBox)
          const primaryIp = info.addresses?.find((a) => a.isRecommended)?.address ||
            info.addresses?.[0]?.address ||
            "127.0.0.1";

          const qrContent = `http://${primaryIp}:${info.port || DEFAULT_SYNC_PORT}`;
          const qr = await QRCode.toDataURL(qrContent, {
            margin: 1,
            width: 180,
            color: { dark: "#1e293b", light: "#ffffff" }
          });
          setQrDataUrl(qr);
        } catch (err) {
          console.error("Could not fetch server info:", err);
        }
      } else if (config.role === "desktop") {
        setDesktopInfo({
          isRunning: true,
          port: DEFAULT_SYNC_PORT,
          addresses: [{ name: "Local", address: window.location.hostname || "localhost", isRecommended: true }]
        });
      }
    }

    init();
  }, [isOpen]);

  if (!isOpen) return null;

  const isMobile = deviceConfig?.role === "mobile";

  const handleCopyIp = (ip) => {
    navigator.clipboard.writeText(ip);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    const updated = await saveDeviceSettings({
      role: formRole,
      seriesPrefix: formPrefix.trim(),
      name: formName.trim()
    });
    setDeviceConfig(updated);
    setSyncStatus({
      type: "success",
      message: `Settings saved. Invoices will use prefix '${updated.seriesPrefix}'`
    });
    setActiveTab("sync");
  };

  const handleScanNetwork = async () => {
    setIsScanning(true);
    setScanMessage("Scanning Wi-Fi / Hotspot for Desktop...");
    setSyncStatus(null);

    try {
      const found = await discoverDesktopServer(targetIp, undefined, (msg) => {
        setScanMessage(msg);
      });

      if (found) {
        setTargetIp(found.ip);
        setSyncStatus({
          type: "success",
          message: `Desktop found at ${found.ip} (${found.status.hostname || "Ready"})!`
        });
      } else {
        setSyncStatus({
          type: "error",
          message: "Could not auto-detect Desktop. Please check the IP address shown on your Desktop Billing screen and type it in below."
        });
      }
    } catch (err) {
      setSyncStatus({
        type: "error",
        message: "Scan error: " + err.message
      });
    } finally {
      setIsScanning(false);
      setScanMessage("");
    }
  };

  const handleRunSync = async () => {
    if (!targetIp.trim()) {
      setSyncStatus({
        type: "error",
        message: "Please enter or scan the Desktop Wi-Fi IP address first."
      });
      return;
    }

    setIsSyncing(true);
    setSyncStatus(null);

    try {
      const result = await syncWithPeer(targetIp, DEFAULT_SYNC_PORT);

      const delNote = result.deletedInvoices ? `, removed ${result.deletedInvoices} deleted invoice(s)` : "";
      setSyncStatus({
        type: "success",
        message: `Sync successful with ${result.peerDevice}!`,
        details: `Sent ${result.sentInvoices} invoice(s), received ${result.receivedInvoices} invoice(s) (${result.addedInvoices} new added locally${delNote}).`
      });

      if (onSyncComplete) {
        onSyncComplete();
      }
    } catch (err) {
      console.error("Sync error:", err);
      setSyncStatus({
        type: "error",
        message: "Sync failed: " + err.message,
        details: "Ensure Desktop Billing is running on your laptop. If using Phone Hotspot, confirm your laptop is connected to your hotspot and Windows network type is set to Private."
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const recommendedIpObj = desktopInfo?.addresses?.find((a) => a.isRecommended) || desktopInfo?.addresses?.[0];

  return (
    <div className="sync-modal-backdrop" onClick={onClose}>
      <div className="sync-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="sync-modal-header">
          <div className="sync-modal-title">
            <div className="sync-icon-badge">
              <Wifi size={20} />
            </div>
            <div>
              <h3>Wi-Fi & Hotspot Sync</h3>
              <p>Synchronize invoices between Mobile & Desktop offline</p>
            </div>
          </div>

          <button className="sync-close-btn" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="sync-tab-bar">
          <button
            type="button"
            className={`sync-tab ${activeTab === "sync" ? "active" : ""}`}
            onClick={() => setActiveTab("sync")}
          >
            <ArrowRightLeft size={16} />
            Sync Hub
          </button>
          <button
            type="button"
            className={`sync-tab ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            <Settings size={16} />
            Device & Series Settings
          </button>
        </div>

        <div className="sync-modal-body">
          {activeTab === "sync" && (
            <>
              {/* Device Mode Badge */}
              <div className="sync-role-banner">
                <div className="sync-role-tag">
                  {isMobile ? <Smartphone size={16} /> : <Monitor size={16} />}
                  <span>This Device: <strong>{deviceConfig?.name || (isMobile ? "Mobile" : "Desktop")}</strong></span>
                </div>
                <div className="sync-series-tag">
                  Series: <strong>{deviceConfig?.seriesPrefix ? `${deviceConfig.seriesPrefix}xxx` : "Standard (xxx)"}</strong>
                </div>
              </div>

              {/* Status alerts */}
              {syncStatus && (
                <div className={`sync-status-box ${syncStatus.type}`}>
                  {syncStatus.type === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
                  <div>
                    <strong>{syncStatus.message}</strong>
                    {syncStatus.details && <p>{syncStatus.details}</p>}
                  </div>
                </div>
              )}

              {/* DESKTOP VIEW: Displays server info & QR code */}
              {!isMobile && (
                <div className="sync-desktop-view">
                  <div className="sync-server-card">
                    <div className="sync-server-header">
                      <span className="sync-pulse-dot" />
                      <h4>Desktop Sync Server is Active</h4>
                    </div>
                    <p className="sync-server-desc">
                      Connect your phone to the same Wi-Fi or Mobile Hotspot, then enter the Desktop IP below or scan the QR code.
                    </p>

                    <div className="sync-ip-list">
                      {desktopInfo?.addresses && desktopInfo.addresses.length > 0 ? (
                        desktopInfo.addresses.map((addr, idx) => (
                          <div
                            key={idx}
                            className={`sync-ip-row ${addr.isRecommended ? "recommended" : ""}`}
                          >
                            <div className="sync-ip-meta">
                              <span className="sync-ip-label">{addr.name}:</span>
                              {addr.isRecommended && (
                                <span className="sync-ip-badge">Primary IP</span>
                              )}
                            </div>
                            <code className="sync-ip-code">{addr.address}</code>
                            <button
                              type="button"
                              className="sync-copy-btn"
                              onClick={() => handleCopyIp(addr.address)}
                              title="Copy IP"
                            >
                              {copied ? <Check size={14} color="#16a34a" /> : <Copy size={14} />}
                            </button>
                          </div>
                        ))
                      ) : (
                        <div className="sync-ip-row">
                          <span className="sync-ip-label">Port:</span>
                          <code className="sync-ip-code">{DEFAULT_SYNC_PORT}</code>
                        </div>
                      )}
                    </div>

                    {qrDataUrl && (
                      <div className="sync-qr-container">
                        <img src={qrDataUrl} alt="Desktop Wi-Fi QR Code" className="sync-qr-img" />
                        <span className="sync-qr-note">
                          Scan to connect (uses port {DEFAULT_SYNC_PORT})
                        </span>
                      </div>
                    )}

                    <div className="sync-hotspot-callout">
                      <Info size={15} />
                      <span>
                        <strong>Mobile Hotspot Tip:</strong> If sharing hotspot from your phone, connect your laptop's Wi-Fi to your phone's hotspot. Enter <strong>{recommendedIpObj?.address || "your Wi-Fi IP"}</strong> on your phone.
                      </span>
                    </div>
                  </div>

                  {/* Manual sync option on desktop */}
                  <div className="sync-secondary-action">
                    <details>
                      <summary>Sync with another device manually</summary>
                      <div className="sync-manual-inputs">
                        <input
                          type="text"
                          placeholder="e.g. 192.168.43.50"
                          value={targetIp}
                          onChange={(e) => setTargetIp(e.target.value)}
                        />
                        <button
                          type="button"
                          className="sync-action-btn"
                          onClick={handleRunSync}
                          disabled={isSyncing}
                        >
                          <RefreshCw size={15} className={isSyncing ? "spinning" : ""} />
                          {isSyncing ? "Syncing..." : "Sync Now"}
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              )}

              {/* MOBILE VIEW: Scan & Connect to Desktop */}
              {isMobile && (
                <div className="sync-mobile-view">
                  <div className="sync-input-group">
                    <label>Desktop Wi-Fi / Hotspot IP Address</label>
                    <div className="sync-input-row">
                      <input
                        type="text"
                        placeholder="e.g. 192.168.43.x or 192.168.1.x"
                        value={targetIp}
                        onChange={(e) => setTargetIp(e.target.value)}
                      />
                      <button
                        type="button"
                        className="sync-scan-btn"
                        onClick={handleScanNetwork}
                        disabled={isScanning || isSyncing}
                        title="Auto-scan Wi-Fi for Desktop"
                      >
                        <Search size={16} className={isScanning ? "spinning" : ""} />
                        {isScanning ? "Scanning..." : "Auto-Detect"}
                      </button>
                    </div>
                    {isScanning && <small className="sync-scan-tip">{scanMessage}</small>}
                    <small className="sync-hotspot-hint">
                      <Wifi size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
                      Using Phone Hotspot? The desktop IP shown on your laptop screen usually begins with <strong>192.168.43.</strong>
                    </small>
                  </div>

                  <div className="sync-instructions">
                    <p>
                      <strong>How to sync:</strong>
                    </p>
                    <ol>
                      <li>Open the <strong>Desktop Billing app</strong> on your laptop.</li>
                      <li>Click <strong>Sync Invoices</strong> on the desktop to see the IP address.</li>
                      <li>Make sure your phone and laptop are connected to the same Wi-Fi or Hotspot.</li>
                      <li>Tap <strong>Auto-Detect</strong> or type the Desktop IP shown on your laptop.</li>
                      <li>Tap <strong>Sync Invoices Now</strong> below.</li>
                    </ol>
                  </div>

                  <button
                    type="button"
                    className="sync-now-main-btn"
                    onClick={handleRunSync}
                    disabled={isSyncing || isScanning}
                  >
                    <RefreshCw size={18} className={isSyncing ? "spinning" : ""} />
                    {isSyncing ? "Synchronizing Invoices..." : "Sync Invoices Now"}
                  </button>
                </div>
              )}
            </>
          )}

          {activeTab === "settings" && (
            <form onSubmit={handleSaveSettings} className="sync-settings-form">
              <div className="sync-form-group">
                <label>Device Role</label>
                <div className="sync-role-options">
                  <label className={`sync-role-radio ${formRole === "desktop" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="role"
                      value="desktop"
                      checked={formRole === "desktop"}
                      onChange={() => {
                        setFormRole("desktop");
                        if (!formPrefix || formPrefix === "M-") setFormPrefix("");
                      }}
                    />
                    <Monitor size={18} />
                    <div>
                      <strong>Desktop Application</strong>
                      <small>Standard series (e.g. 2026-27/001)</small>
                    </div>
                  </label>

                  <label className={`sync-role-radio ${formRole === "mobile" ? "selected" : ""}`}>
                    <input
                      type="radio"
                      name="role"
                      value="mobile"
                      checked={formRole === "mobile"}
                      onChange={() => {
                        setFormRole("mobile");
                        if (!formPrefix) setFormPrefix("M-");
                      }}
                    />
                    <Smartphone size={18} />
                    <div>
                      <strong>Mobile Application</strong>
                      <small>Separate mobile series (e.g. 2026-27/M-001)</small>
                    </div>
                  </label>
                </div>
              </div>

              <div className="sync-form-group">
                <label>
                  Invoice Series Prefix
                  <small style={{ display: "block", color: "#64748b", fontWeight: 400 }}>
                    Separate prefix prevents invoice number conflicts between devices.
                  </small>
                </label>
                <input
                  type="text"
                  placeholder="e.g. M- or MOB- or leave empty for desktop"
                  value={formPrefix}
                  onChange={(e) => setFormPrefix(e.target.value)}
                />
                <small className="sync-prefix-preview">
                  Next invoice will look like: <code>2026-27/{formPrefix}001</code>
                </small>
              </div>

              <div className="sync-form-group">
                <label>Device Name (Optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Counter PC, Van Mobile"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div className="sync-form-actions">
                <button type="submit" className="sync-save-settings-btn">
                  Save Device Settings
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
