
import { useEffect, useMemo, useState } from "react";
import { db, initializeDatabase, saveCustomer, saveProduct, recordInvoiceDeletion } from "./database/db";
import { getNextInvoiceNumber } from "./utils/invoiceNumber";
import { calculateInvoice } from "./utils/calculations";
import { getDeviceSettings } from "./utils/device";
import logo from "./assets/logo.png";
import { Capacitor } from "@capacitor/core";
import { FileSharer } from "@capgo/capacitor-file-sharer";
import { Printer as CapacitorPrinter } from "@capgo/capacitor-printer";
import {
  Plus,
  Trash2,
  Printer,
  FileText,
  Search,
  Receipt,
  Save,
  Download,
  Share2,
  MoreVertical,
  X,
  Wifi,
  RefreshCw
} from "lucide-react";

import html2pdf from "html2pdf.js";
import "./styles/global.css";
import "./styles/invoice.css";
import CustomerAutocomplete from "./components/CustomerAutocomplete";
import ProductAutocomplete from "./components/ProductAutocomplete";
import SyncModal from "./components/SyncModal";
import TransactionsPage from "./components/TransactionsPage";
import { mergeRemoteData, getLocalSyncData } from "./utils/syncEngine";
const emptyItem = () => ({
  name: "",
  hsn: "",
  qty: "",
  unit: "Sq.ft",
  rate: ""
});

const emptyCustomer = {
  name: "",
  address: "",
  state: "KARNATAKA",
  stateCode: "29",
  gstin: ""
};

export default function App() {
  const [currentView, setCurrentView] = useState("create"); // "create" | "transactions"
  const [customers, setCustomers] = useState([]);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [products, setProducts] = useState([]);
  const [history, setHistory] = useState([]);
  const [company, setCompany] = useState({});
  const [gst, setGst] = useState({
    cgst: 9, sgst: 9, igst: 18
  });

  const [customer, setCustomer] = useState(emptyCustomer);

  const [items, setItems] = useState([emptyItem()]);

  const [vehicle, setVehicle] = useState("");
  const [placeOfSupply, setPlaceOfSupply] = useState("BENGALURU");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const [savedInvoice, setSavedInvoice] = useState(null);
  const [syncModalOpen, setSyncModalOpen] = useState(false);

  async function loadData() {
    await initializeDatabase();

    setCustomers(await db.customers.toArray());
    setProducts(await db.products.toArray());
    const invoicesList = await db.invoices.orderBy("id").reverse().toArray();
    setHistory(invoicesList);

    const c = await db.settings.get("company");
    const g = await db.settings.get("gst");

    setCompany(c || {});
    if (g) setGst(g);

    // Fix: Ensure any older legacy invoices created without a signature snapshot
    // get stamped with the current company signature so they don't dynamically adopt future changes
    if (c?.signatureDataUrl) {
      const unmigrated = invoicesList.filter(inv => !inv.signatureDataUrl);
      if (unmigrated.length > 0) {
        for (const inv of unmigrated) {
          await db.invoices.update(inv.id, { signatureDataUrl: c.signatureDataUrl });
          inv.signatureDataUrl = c.signatureDataUrl;
        }
      }
    }
  }

  useEffect(() => {
    loadData();

    // Listen for incoming Wi-Fi sync requests on Desktop from Mobile devices
    if (window.electronSync && typeof window.electronSync.onIncomingSync === "function") {
      const unsubscribe = window.electronSync.onIncomingSync(async ({ requestId, payload }) => {
        try {
          const mergeStats = await mergeRemoteData(payload);
          const localData = await getLocalSyncData();

          window.electronSync.sendSyncResponse(requestId, {
            success: true,
            device: localData.deviceRole,
            deviceName: localData.deviceName,
            invoices: localData.invoices,
            customers: localData.customers,
            products: localData.products,
            deletedInvoices: localData.deletedInvoices,
            mergeStats
          });

          await loadData();
        } catch (err) {
          console.error("Failed to process incoming sync:", err);
          window.electronSync.sendSyncError(requestId, err.message);
        }
      });

      return () => {
        if (typeof unsubscribe === "function") unsubscribe();
      };
    }
  }, []);

  function updateItem(index, field, value) {
    setItems(old => old.map((item, i) =>
      i === index ? { ...item, [field]: value } : item
    ));

    if (field === "name") {
      const match = products.find(
        p => p.name.toLowerCase() === value.trim().toLowerCase()
      );

      if (match) {
        setItems(old => old.map((item, i) =>
          i === index
            ? {
                ...item,
                name: match.name,
                hsn: match.hsn,
                rate: match.rate
              }
            : item
        ));
      }
    }
  }

  function updateCustomerName(value) {
    setCustomer(old => ({ ...old, name: value }));

    const match = customers.find(
      c => c.name.toLowerCase() === value.trim().toLowerCase()
    );

    if (match) {
      setCustomer(match);
    }
  }

  function addRow() {
    setItems(old => [...old, emptyItem()]);
  }

  function removeRow(index) {
    setItems(old => {
      const filtered = old.filter((_, i) => i !== index);
      return filtered.length === 0 ? [emptyItem()] : filtered;
    });
  }

  const isInterState =
    customer.stateCode &&
    company.stateCode &&
    customer.stateCode !== company.stateCode;

  const totals = useMemo(
    () => calculateInvoice(items, gst, isInterState),
    [items, gst, isInterState]
  );

  async function backupData() {
  try {
    const backup = {
      appName: "Arif Billing",
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      data: {}
    };

    for (const table of db.tables) {
      backup.data[table.name] = await table.toArray();
    }

    const blob = new Blob(
      [JSON.stringify(backup, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `arif-billing-backup-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;

    link.click();
    URL.revokeObjectURL(url);

    alert("Backup downloaded successfully.");
  } catch (error) {
    console.error(error);
    alert("Backup failed: " + error.message);
  }
}

async function restoreData(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  try {
    const text = await file.text();
    const backup = JSON.parse(text);

    const requiredTables = [
      "invoices",
      "customers",
      "products",
      "settings",
      "counters"
    ];

    if (
      backup.appName !== "Arif Billing" ||
      backup.backupVersion !== 1 ||
      !backup.data
    ) {
      throw new Error("Invalid Arif Billing backup file.");
    }

    for (const tableName of requiredTables) {
      if (!Array.isArray(backup.data[tableName])) {
        throw new Error(`Invalid or missing ${tableName} data.`);
      }
    }

    const confirmed = window.confirm(
      "Restoring this backup will replace all current invoices, customers, products and settings. Continue?"
    );

    if (!confirmed) {
      event.target.value = "";
      return;
    }

    await db.transaction(
      "rw",
      ...db.tables,
      async () => {
        for (const tableName of requiredTables) {
          const table = db.table(tableName);

          await table.clear();

          if (backup.data[tableName].length > 0) {
            await table.bulkPut(backup.data[tableName]);
          }
        }

        if (db.deletedInvoices && Array.isArray(backup.data.deletedInvoices)) {
          await db.deletedInvoices.clear();
          if (backup.data.deletedInvoices.length > 0) {
            await db.deletedInvoices.bulkPut(backup.data.deletedInvoices);
          }
        }
      }
    );

    await loadData();
    newInvoice();

    alert("Backup restored successfully.");
  } catch (error) {
    console.error(error);
    alert("Restore failed: " + error.message);
  } finally {
    event.target.value = "";
  }
}
  async function finalizeInvoice() {
    if (!customer.name.trim()) {
      alert("Enter customer name");
      return;
    }

    const validItems = items.filter(
      item => item.name.trim() &&
        Number(item.qty) > 0 &&
        Number(item.rate) >= 0
    );

    if (!validItems.length) {
      alert("Add at least one valid product");
      return;
    }

    if (isInterState && !gst.igst) {
      alert("Enter the applicable IGST rate");
      return;
    }

    if (!isInterState && (!gst.cgst || !gst.sgst)) {
      alert("Enter applicable CGST and SGST rates");
      return;
    }

    const invoiceNo = await getNextInvoiceNumber(
      new Date(invoiceDate + "T12:00:00")
    );

    const finalTotals = calculateInvoice(
      validItems,
      gst,
      isInterState
    );

    const invoice = {
      invoiceNo,
      invoiceDate,
      timeOfSupply: new Date().toLocaleString("en-IN", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
}),
      customerName: customer.name,
      customerAddress: customer.address,
      customerState: customer.state,
      customerStateCode: customer.stateCode,
      customerGSTIN: customer.gstin,
      vehicle,
      placeOfSupply,
      items: validItems.map(item => ({
        ...item,
        qty: Number(item.qty),
        rate: Number(item.rate),
        amount: Number(item.qty) * Number(item.rate)
      })),
      gst: {
        cgst: Number(gst.cgst),
        sgst: Number(gst.sgst),
        igst: Number(gst.igst)
      },
      isInterState,
      signatureDataUrl: company.signatureDataUrl || "",
      createdOnDevice: (await getDeviceSettings())?.name || "Device",
      ...finalTotals
    };

    try {
      const id = await db.invoices.add(invoice);
      invoice.id = id;

      await saveCustomer({
        name: customer.name,
        address: customer.address,
        state: customer.state,
        stateCode: customer.stateCode,
        gstin: customer.gstin
      });

      for (const item of validItems) {
        await saveProduct({
          name: item.name,
          hsn: item.hsn,
          unit: item.unit || "Sq.ft",
          rate: Number(item.rate)
        });
      }

      const updatedGST = {
        key: "gst",
        cgst: Number(gst.cgst),
        sgst: Number(gst.sgst),
        igst: Number(gst.igst),
        recentCGST: [...new Set([
          Number(gst.cgst), ...(gst.recentCGST || [])
        ])].slice(0, 10),
        recentSGST: [...new Set([
          Number(gst.sgst), ...(gst.recentSGST || [])
        ])].slice(0, 10),
        recentIGST: [...new Set([
          Number(gst.igst), ...(gst.recentIGST || [])
        ])].slice(0, 10)
      };

      await db.settings.put(updatedGST);

      setSavedInvoice(invoice);
      await loadData();

      return invoice;
    } catch (error) {
      console.error(error);
      alert("Unable to save invoice: " + error.message);
    }
  }
 
// Convert generated PDF Blob into Base64
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onloadend = () => {
      const result = reader.result;
      resolve(result.split(",")[1]);
    };

    reader.onerror = reject;

    reader.readAsDataURL(blob);
  });
}

// Generate invoice PDF using existing design
async function generateInvoicePDF() {
  if (!savedInvoice) {
    throw new Error("Please save the invoice first.");
  }

  const element = document.getElementById("invoice");

  if (!element) {
    throw new Error("Invoice preview not found.");
  }

  const filename = `${savedInvoice.invoiceNo.replace(
    /[^\w-]/g,
    "_"
  )}.pdf`;

  const options = {
    margin: 0,
    filename,
    image: {
      type: "jpeg",
      quality: 0.98
    },
    html2canvas: {
      scale: 2,
      useCORS: true
    },
    jsPDF: {
      unit: "mm",
      format: "a4",
      orientation: "portrait"
    }
  };

  const pdfBlob = await html2pdf()
    .set(options)
    .from(element)
    .outputPdf("blob");

  const base64Data = await blobToBase64(pdfBlob);

  return { filename, base64Data };
}

// PRINT INVOICE
async function printInvoice() {
  if (!savedInvoice) {
    alert("Please save the invoice before printing.");
    return;
  }

  try {
    // Android: use native print dialog
    if (Capacitor.isNativePlatform()) {
      const { filename, base64Data } =
        await generateInvoicePDF();

      await CapacitorPrinter.printBase64({
        name: filename.replace(".pdf", ""),
        data: base64Data,
        mimeType: "application/pdf"
      });

      return;
    }

    // Desktop / browser: retain existing printing
    window.print();

  } catch (error) {
    console.error("Print error:", error);
    alert("Unable to print invoice: " + error.message);
  }
}

// EXPORT OR SHARE PDF
async function exportPDF(share = false) {
  if (!savedInvoice) {
    alert("Please save the invoice before exporting.");
    return;
  }

  try {
    const { filename, base64Data } =
      await generateInvoicePDF();

    // Android native file handling
    if (Capacitor.isNativePlatform()) {

      if (share) {
        await FileSharer.share({
          filename,
          contentType: "application/pdf",
          base64Data,
          title: `Invoice ${savedInvoice.invoiceNo}`,
          text: `Invoice for ${savedInvoice.customerName}`
        });

      } else {
        const result = await FileSharer.save({
          filename,
          contentType: "application/pdf",
          base64Data,
          android: {
            saveDirectory: "downloads",
            relativePath: "Download/Arif Veneer and Woods/Invoices"
          }
        });

        alert("Invoice PDF saved successfully in Downloads.");
        console.log("Saved PDF:", result.uri);
      }

      return;
    }

    // Desktop Electron: native Windows default sharing console
    if (window.electronSync?.isElectron && share) {
      const shareRes = await window.electronSync.shareFile({
        filename,
        base64Data,
        title: `Invoice ${savedInvoice.invoiceNo}`
      });

      if (!shareRes?.success && shareRes?.error) {
        alert("Unable to open Windows Share dialog: " + shareRes.error);
      }
      return;
    }

    // Existing desktop/browser handling
    const pdfBlob = await html2pdf()
      .set({
        margin: 0,
        filename,
        image: {
          type: "jpeg",
          quality: 0.98
        },
        html2canvas: {
          scale: 2,
          useCORS: true
        },
        jsPDF: {
          unit: "mm",
          format: "a4",
          orientation: "portrait"
        }
      })
      .from(document.getElementById("invoice"))
      .outputPdf("blob");

    if (
      share &&
      navigator.share &&
      navigator.canShare
    ) {
      const file = new File(
        [pdfBlob],
        filename,
        { type: "application/pdf" }
      );

      if (navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Invoice ${savedInvoice.invoiceNo}`,
          text: `Invoice for ${savedInvoice.customerName}`
        });

        return;
      }
    }

    const url = URL.createObjectURL(pdfBlob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    link.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    if (share) {
      alert("Sharing is unavailable. PDF downloaded instead.");
    }

  } catch (error) {
    console.error("PDF error:", error);

    if (
      error.message !== "Share canceled" &&
      error.code !== "USER_CANCELLED"
    ) {
      alert("Unable to process PDF: " + error.message);
    }
  }
}

  function openInvoice(invoice) {
    setSavedInvoice(invoice);
  }

  function newInvoice() {
    setSavedInvoice(null);
    setCustomer(emptyCustomer);
    setItems([emptyItem()]);
    setVehicle("");
    setPlaceOfSupply("BENGALURU");
    setInvoiceDate(new Date().toISOString().slice(0, 10));
  }

  const previewItems = savedInvoice?.items || items;
  const previewCustomer = savedInvoice
  ? {
      name: savedInvoice.customerName,
      address: savedInvoice.customerAddress,
      state: savedInvoice.customerState,
      stateCode: savedInvoice.customerStateCode,
      gstin: savedInvoice.customerGSTIN
    }
  : customer;
  const previewTotals = savedInvoice || totals;
  const previewGST = savedInvoice?.gst || gst;
async function handleSignatureUpload(event) {
  const file = event.target.files?.[0];

  if (!file) return;

  if (!file.type.startsWith("image/")) {
    alert("Please select an image file.");
    event.target.value = "";
    return;
  }

  if (file.size > 1024 * 1024) {
    alert("Please use a signature image smaller than 1 MB.");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = async () => {
    try {
      // Guarantee that all existing invoices in DB preserve the current signature before saving the new one
      if (company.signatureDataUrl) {
        const existing = await db.invoices.toArray();
        for (const inv of existing) {
          if (!inv.signatureDataUrl) {
            await db.invoices.update(inv.id, { signatureDataUrl: company.signatureDataUrl });
          }
        }
      }

      const updatedCompany = {
        ...company,
        signatureDataUrl: reader.result
      };

      await db.settings.put(updatedCompany);
      setCompany(updatedCompany);
      await loadData();

      alert("Signature saved successfully. Older invoices will keep their original signature.");
    } catch (error) {
      console.error(error);
      alert("Unable to save signature.");
    }
  };

  reader.readAsDataURL(file);
  event.target.value = "";
}
const deleteInvoice = async (invoice) => {
  const confirmed = window.confirm(
    `Are you sure you want to permanently delete invoice ${invoice.invoiceNo}?`
  );

  if (!confirmed) return;

  try {
    await recordInvoiceDeletion(invoice);

    // Clear the preview if this invoice is currently selected
    if (savedInvoice?.id === invoice.id) {
      setSavedInvoice(null);
    }

    await loadData();

    alert(`Invoice ${invoice.invoiceNo} deleted successfully.`);
  } catch (error) {
    console.error("Invoice deletion failed:", error);
    alert("Unable to delete invoice. Please try again.");
  }
};

const deleteMultipleInvoices = async (invoicesToDelete) => {
  if (!invoicesToDelete || invoicesToDelete.length === 0) return;

  try {
    for (const inv of invoicesToDelete) {
      await recordInvoiceDeletion(inv);
      if (savedInvoice?.id === inv.id) {
        setSavedInvoice(null);
      }
    }

    await loadData();
    alert(`${invoicesToDelete.length} invoice(s) deleted successfully.`);
  } catch (error) {
    console.error("Bulk deletion failed:", error);
    alert("Unable to delete selected invoices. Please try again.");
  }
};
  return (
    <div className={`app-shell ${mobileMenuOpen ? "mobile-menu-open" : ""}`}>

      <aside className="sidebar no-print">

  <div className="sidebar-brand-row">
    <div className="sidebar-brand-info">
      <img src={logo} alt="Arif Billing Logo" className="sidebar-brand-logo" />
      <div>
        <h2>ARIF <span>BILLING</span></h2>
        <p>Invoice Management</p>
      </div>
    </div>

    <button
      type="button"
      className="mobile-menu-toggle"
      onClick={() => setMobileMenuOpen(prev => !prev)}
      aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
      aria-expanded={mobileMenuOpen}
    >
      {mobileMenuOpen
        ? <X size={23} />
        : <MoreVertical size={23} />
      }
    </button>
  </div>

  <div className="sidebar-nav">
    <button
      type="button"
      className={`sidebar-nav-btn ${currentView === "create" ? "active" : ""}`}
      onClick={() => {
        setCurrentView("create");
        newInvoice();
        setMobileMenuOpen(false);
      }}
    >
      <span className="sidebar-nav-label">
        <Plus size={17} />
        <span>New Invoice</span>
      </span>
    </button>

    <button
      type="button"
      className={`sidebar-nav-btn ${currentView === "transactions" ? "active" : ""}`}
      onClick={() => {
        setCurrentView("transactions");
        setMobileMenuOpen(false);
      }}
    >
      <span className="sidebar-nav-label">
        <FileText size={17} />
        <span>All Invoices</span>
      </span>
      <span className="sidebar-count-badge">{history.length}</span>
    </button>

    <button
      type="button"
      className="sidebar-sync-btn"
      onClick={() => {
        setSyncModalOpen(true);
        setMobileMenuOpen(false);
      }}
    >
      <Wifi size={17} /> Sync Invoices
    </button>
  </div>

  <div className="backup-actions">
  <button
    type="button"
    className="backup-btn"
    onClick={backupData}
  >
    <FileText size={16} />
    Download Backup
  </button>

  <label className="backup-btn restore-btn">
    <Receipt size={16} />
    Restore Backup

    <input
      type="file"
      accept=".json,application/json"
      hidden
      onChange={restoreData}
    />
  </label>
</div>
<div className="sidebar-signature">
  <h3>Authorized Signature</h3>

  <label className="signature-change-btn">
    <FileText size={16} />
    Change Signature

    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      onChange={handleSignatureUpload}
      hidden
    />
  </label>

  {company.signatureDataUrl && (
    <div className="sidebar-signature-preview">
      <img
        src={company.signatureDataUrl}
        alt="Current authorized signature"
      />
      <small>Signature saved</small>
    </div>
  )}
</div>
      </aside>

      <main className="main-content">

        {currentView === "transactions" ? (
          <TransactionsPage
            invoices={history}
            onOpenInvoice={(inv) => {
              openInvoice(inv);
              setCurrentView("create");
            }}
            onDeleteInvoice={deleteInvoice}
            onDeleteMultiple={deleteMultipleInvoices}
            onNewInvoice={() => {
              newInvoice();
              setCurrentView("create");
            }}
          />
        ) : (
          <>
            <header className="no-print">
              <div>
                <h1>Invoice Management</h1>
                <p>Create and manage company tax invoices</p>
              </div>

              <div className="invoice-actions no-print">

                <button
                  className="action-save"
                  onClick={finalizeInvoice}
                  disabled={!!savedInvoice}
                >
                  <Save size={16}/>
                  {savedInvoice ? "Saved" : "Save Invoice"}
                </button>

                <button
                  className="action-print"
                  onClick={printInvoice}
                  disabled={!savedInvoice}
                >
                  <Printer size={16}/>
                  Print
                </button>

                <button
                  className="action-export"
                  onClick={() => exportPDF(false)}
                  disabled={!savedInvoice}
                >
                  <Download size={16}/>
                  Export PDF
                </button>

                <button
                  className="action-share"
                  onClick={() => exportPDF(true)}
                  disabled={!savedInvoice}
                >
                  <Share2 size={16}/>
                  Share PDF
                </button>

                <button
                  type="button"
                  className="action-sync"
                  onClick={() => setSyncModalOpen(true)}
                  title="Sync invoices over Wi-Fi"
                >
                  <RefreshCw size={16}/>
                  Sync
                </button>

              </div>
            </header>

            <div className="workspace-layout">
              {!savedInvoice && (
                <section className="form-section no-print">

                  <h3>Invoice Details</h3>

                  <div className="form-grid">
                    <label>
                      Invoice Date
                      <input
                        type="date"
                        value={invoiceDate}
                        onChange={e => setInvoiceDate(e.target.value)}
                      />
                    </label>

                    <label>
                      Place of Supply
                      <input
                        value={placeOfSupply}
                        onChange={e => setPlaceOfSupply(e.target.value)}
                      />
                    </label>

                    <label>
                      Vehicle Number
                      <input
                        value={vehicle}
                        onChange={e => setVehicle(e.target.value)}
                      />
                    </label>
                  </div>

                  <h3>Buyer Details</h3>

                  <div className="form-grid">
                    <label className="wide">
                      Customer Name

                      <CustomerAutocomplete
                        value={customer.name}
                        customers={customers}
                        onChange={updateCustomerName}
                        onSelect={(selectedCustomer) => {
                          setCustomer(selectedCustomer);
                        }}
                      />
                    </label>

                    <label className="wide">
                      Address
                      <textarea
                        value={customer.address}
                        onChange={e => setCustomer({
                          ...customer, address: e.target.value
                        })}
                      />
                    </label>

                    <label>
                      State
                      <input
                        value={customer.state}
                        onChange={e => setCustomer({
                          ...customer, state: e.target.value
                        })}
                      />
                    </label>

                    <label>
                      State Code
                      <input
                        value={customer.stateCode}
                        onChange={e => setCustomer({
                          ...customer, stateCode: e.target.value
                        })}
                      />
                    </label>

                    <label>
                      GSTIN
                      <input
                        value={customer.gstin}
                        onChange={e => setCustomer({
                          ...customer, gstin: e.target.value
                        })}
                      />
                    </label>
                  </div>

                  <h3>Products / Services</h3>

                  <div className="product-table-wrapper">
                    <div className="product-header">
                      <span>Product</span>
                      <span>HSN/ACS</span>
                      <span>Qty</span>
                      <span>Unit</span>
                      <span>Rate</span>
                      <span>Amount</span>
                      <span></span>
                    </div>

                    {items.map((item, index) => (
                      <div className="product-row" key={index}>
                        <ProductAutocomplete
                          value={item.name}
                          products={products}
                          onChange={(value) => updateItem(index, "name", value)}
                          onSelect={(selectedProduct) => {
                            setItems(old =>
                              old.map((row, i) =>
                                i === index
                                  ? {
                                      ...row,
                                      name: selectedProduct.name,
                                      hsn: selectedProduct.hsn || "",
                                      rate: selectedProduct.rate ?? ""
                                    }
                                  : row
                              )
                            );
                          }}
                        />

                        <input
                          placeholder="HSN/ACS"
                          value={item.hsn}
                          onChange={e =>
                            updateItem(index, "hsn", e.target.value)
                          }
                        />

                        <input
                          type="number"
                          min="0"
                          placeholder="Qty"
                          value={item.qty}
                          onChange={e =>
                            updateItem(index, "qty", e.target.value)
                          }
                        />

                        <select
                          className="item-input"
                          value={item.unit || "Sq.ft"}
                          onChange={e =>
                            updateItem(index, "unit", e.target.value)
                          }
                        >
                          <option value="Sq.ft">Sq.ft</option>
                          <option value="Sq.m">Sq.m</option>
                          <option value="Rft">Rft</option>
                          <option value="Cft">Cft</option>
                          <option value="Nos">Nos</option>
                          <option value="Kg">Kg</option>
                          <option value="Ton">Ton</option>
                          <option value="Box">Box</option>
                          <option value="Piece">Piece</option>
                          <option value="Set">Set</option>
                        </select>

                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="Rate"
                          value={item.rate}
                          onChange={e =>
                            updateItem(index, "rate", e.target.value)
                          }
                        />

                        <strong>
                          ₹{(
                            Number(item.qty || 0) *
                            Number(item.rate || 0)
                          ).toFixed(2)}
                        </strong>

                        <button
                          type="button"
                          className="delete"
                          onClick={() => removeRow(index)}
                          title="Delete product row"
                          aria-label={`Delete product row ${index + 1}`}
                        >
                          <Trash2 size={16}/>
                        </button>
                      </div>
                    ))}
                  </div>

                  <button className="secondary" onClick={addRow}>
                    <Plus size={16}/> Add Product
                  </button>

                  <h3>GST Configuration</h3>

                  <div className="form-grid">
                    {["cgst", "sgst", "igst"].map(key => (
                      <label key={key}>
                        {key.toUpperCase()} (%)
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.01"
                          list={`recent-${key}`}
                          value={gst[key]}
                          onChange={e => setGst({
                            ...gst, [key]: e.target.value
                          })}
                        />
                        <datalist id={`recent-${key}`}>
                          {(gst[`recent${key.toUpperCase()}`] || []).map(
                            (rate, i) => (
                              <option key={i} value={rate}/>
                            )
                          )}
                        </datalist>
                      </label>
                    ))}
                  </div>

                  <div className="calculation">
                    <p>Subtotal: ₹{totals.subtotal.toFixed(2)}</p>
                    {isInterState ? (
                      <p>IGST: ₹{totals.igst.toFixed(2)}</p>
                    ) : (
                      <>
                        <p>CGST: ₹{totals.cgst.toFixed(2)}</p>
                        <p>SGST: ₹{totals.sgst.toFixed(2)}</p>
                      </>
                    )}
                    <h2>Grand Total: ₹{totals.grandTotal.toFixed(2)}</h2>
                  </div>

                </section>
              )}

              <div className="preview-container">
                <InvoicePreview
                  company={company}
                  invoice={savedInvoice}
                  invoiceDate={invoiceDate}
                  customer={previewCustomer}
                  items={previewItems}
                  totals={previewTotals}
                  gst={previewGST}
                  vehicle={savedInvoice?.vehicle || vehicle}
                  placeOfSupply={savedInvoice?.placeOfSupply || placeOfSupply}
                  isInterState={savedInvoice?.isInterState ?? isInterState}
                />
              </div>
            </div>
          </>
        )}
          
      </main>

      <SyncModal
        isOpen={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        onSyncComplete={loadData}
      />
    </div>
  );
}

function InvoicePreview({
  company, invoice, invoiceDate, customer,
  items, totals, gst, vehicle, placeOfSupply,
  isInterState
}) {
  const date = invoice?.invoiceDate || invoiceDate;
  const invoiceNo = invoice?.invoiceNo || "DRAFT";

  // If viewing a saved invoice, use its snapshotted signature from creation.
  // If drafting a new invoice (invoice is null/undefined), show current company signature.
  const activeSignature = invoice
    ? (invoice.signatureDataUrl || "")
    : (company.signatureDataUrl || "");

  return (
    <div className="invoice-paper" id="invoice">

      <div className="invoice-heading">
        <h1>{company.name}</h1>
        <p>{company.address} | Mob: {company.phone}</p>
        <p>GSTIN: {company.gstin}</p>
      </div>

      <h3 className="invoice-title">TAX INVOICE</h3>

      <div className="invoice-meta">
        <div>
          <p>GSTIN: {company.gstin}</p>
          <p>Reverse Charge: NO</p>
          <p>Invoice No: <b>{invoiceNo}</b></p>
        </div>

        <div>
          <p>Invoice Date: {date}</p>
          <p>Place of Supply: {placeOfSupply}</p>
       <p>
  Time of Supply: {invoice?.timeOfSupply || "Not recorded"}
</p>
        </div>
      </div>

      <div className="buyer-box">
        <b>To</b>
        <p>Name: {customer.name}</p>
        <p>Address: {customer.address}</p>
        <p>State: {customer.state}</p>
        <p>GSTIN: {customer.gstin}</p>
        <p>State Code: {customer.stateCode}</p>
        <p>Vehicle No: {vehicle}</p>
      </div>

      <table className="invoice-table">
        <thead>
          <tr>
            <th>Sl.No</th>
            <th>Name of Product / Service</th>
            <th>HSN / ACS</th>
            <th>Qty</th>
           <th>Unit</th>
            <th>Rate</th>
            <th>Amount (Rs.)</th>
          </tr>
        </thead>

        <tbody>
          {items.map((item, index) => (
            <tr key={index}>
              <td>{index + 1}</td>
              <td>{item.name}</td>
              <td>{item.hsn}</td>
              <td>{item.qty}</td>
               <td>{item.unit || "Sq.ft"}</td>
              
              <td>{Number(item.rate || 0).toFixed(2)}</td>
              <td>
                {(Number(item.qty || 0) *
                  Number(item.rate || 0)).toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-totals">
        <p>Subtotal: ₹{Number(totals.subtotal || 0).toFixed(2)}</p>

        {isInterState ? (
          <p>IGST ({gst.igst}%): ₹{Number(totals.igst || 0).toFixed(2)}</p>
        ) : (
          <>
            <p>CGST ({gst.cgst}%): ₹{Number(totals.cgst || 0).toFixed(2)}</p>
            <p>SGST ({gst.sgst}%): ₹{Number(totals.sgst || 0).toFixed(2)}</p>
            <p>IGST (18%): ₹0.00</p>
          </>
        )}

        <h3>GRAND TOTAL: ₹{Number(totals.grandTotal || 0).toFixed(2)}</h3>
      </div>

      <div className="invoice-footer">
        <div>
          <b>Total Invoice Amount In Words:</b>
          <p>{numberToWords(totals.grandTotal || 0)} Only.</p>
        </div>

        <div className="signature">
  <p>Certified that the particulars given above are true and correct</p>

  <b>For {company.name}</b>

  {activeSignature ? (
    <img
      src={activeSignature}
      alt="Authorized signature"
      className="invoice-signature-image"
    />
  ) : (
    <div className="signature-space"></div>
  )}

  <p>Authorised Signatory</p>
</div>
      </div>

    </div>
  );
}

function numberToWords(value) {
  const n = Math.round(Number(value) || 0);

  if (n === 0) return "Zero";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five",
    "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen",
    "Fifteen", "Sixteen", "Seventeen", "Eighteen",
    "Nineteen"
  ];

  const tens = [
    "", "", "Twenty", "Thirty", "Forty",
    "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"
  ];

  function convert(num) {
    if (num < 20) return ones[num];

    if (num < 100) {
      return tens[Math.floor(num / 10)] +
        (num % 10 ? " " + ones[num % 10] : "");
    }

    if (num < 1000) {
      return ones[Math.floor(num / 100)] + " Hundred " +
        (num % 100 ? convert(num % 100) : "");
    }

    if (num < 100000) {
      return convert(Math.floor(num / 1000)) + " Thousand " +
        (num % 1000 ? convert(num % 1000) : "");
    }

    if (num < 10000000) {
      return convert(Math.floor(num / 100000)) + " Lakh " +
        (num % 100000 ? convert(num % 100000) : "");
    }

    return convert(Math.floor(num / 10000000)) + " Crore " +
      (num % 10000000 ? convert(num % 10000000) : "");
  }

  return convert(n).trim();
}
