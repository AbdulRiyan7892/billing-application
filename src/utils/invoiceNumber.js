import { db } from "../database/db";
import { getDeviceSettings } from "./device";

export function getFinancialYear(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth();

  const startYear = month >= 3 ? year : year - 1;

  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export async function getNextInvoiceNumber(date = new Date()) {
  const financialYear = getFinancialYear(date);
  const deviceConfig = await getDeviceSettings();
  const prefix = deviceConfig.seriesPrefix ?? "";

  // Distinct counter key for this financial year + prefix series
  const counterKey = prefix ? `${financialYear}_${prefix}` : financialYear;

  return await db.transaction(
    "rw",
    db.counters,
    async () => {
      const counter = await db.counters.get(counterKey);

      const nextNumber = counter
        ? counter.lastNumber + 1
        : 1;

      await db.counters.put({
        financialYear: counterKey,
        lastNumber: nextNumber,
        seriesPrefix: prefix,
        updatedAt: new Date().toISOString()
      });

      return `${financialYear}/${prefix}${String(nextNumber).padStart(3, "0")}`;
    }
  );
}
