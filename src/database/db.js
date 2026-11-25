
import Dexie from "dexie";

export const db = new Dexie("ArifBillingDB");

db.version(1).stores({
  invoices: "++id, invoiceNo, invoiceDate, customerName, customerGSTIN",
  customers: "++id, &name, gstin, state",
  products: "++id, &name, hsn, rate",
  settings: "&key",
  counters: "&financialYear"
});

db.version(2).stores({
  deletedInvoices: "&invoiceNo, deletedAt"
});

export async function initializeDatabase() {
  const company = await db.settings.get("company");

  if (!company) {
    await db.settings.put({
      key: "company",
      name: "ARIF VENEER AND WOODS",
      address: "Kandali, B.M. Road, HASSAN - 573217",
      phone: "8660915153",
      gstin: "29AIEPH9232K1ZY",
      state: "KARNATAKA",
      stateCode: "29"
    });
  }

  const gst = await db.settings.get("gst");

  if (!gst) {
    await db.settings.put({
      key: "gst",
      cgst: 9,
      sgst: 9,
      igst: 18,
      recentCGST: [9],
      recentSGST: [9],
      recentIGST: [18]
    });
  }
}

export async function saveCustomer(customer) {
  const existing = await db.customers
    .where("name")
    .equalsIgnoreCase(customer.name)
    .first();

  if (existing) {
    await db.customers.update(existing.id, customer);
    return existing.id;
  }

  return await db.customers.add(customer);
}

export async function saveProduct(product) {
  const existing = await db.products
    .where("name")
    .equalsIgnoreCase(product.name)
    .first();

  if (existing) {
    await db.products.update(existing.id, product);
    return existing.id;
  }

  return await db.products.add(product);
}

export async function recordInvoiceDeletion(invoice) {
  if (!invoice) return;
  await db.transaction("rw", [db.invoices, db.deletedInvoices], async () => {
    if (invoice.id) {
      await db.invoices.delete(invoice.id);
    }
    if (invoice.invoiceNo) {
      await db.deletedInvoices.put({
        invoiceNo: invoice.invoiceNo,
        deletedAt: new Date().toISOString()
      });
    }
  });
}
