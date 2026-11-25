import { useState, useMemo } from "react";
import {
  Search,
  Trash2,
  Eye,
  Receipt,
  Plus,
  ArrowUpDown,
  CheckSquare,
  Square,
  X,
  Calendar,
  User,
  FileText
} from "lucide-react";

export default function TransactionsPage({
  invoices,
  onOpenInvoice,
  onDeleteInvoice,
  onDeleteMultiple,
  onNewInvoice
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [sortBy, setSortBy] = useState("date-desc"); // "date-desc" | "date-asc" | "amount-desc" | "amount-asc"

  // Filter and sort invoices
  const filteredInvoices = useMemo(() => {
    let list = invoices.filter((inv) => {
      const q = searchTerm.toLowerCase().trim();
      if (!q) return true;

      const no = (inv.invoiceNo || "").toLowerCase();
      const name = (inv.customerName || "").toLowerCase();
      const gstin = (inv.customerGSTIN || "").toLowerCase();
      const date = (inv.invoiceDate || "").toLowerCase();
      const vehicle = (inv.vehicle || "").toLowerCase();
      const place = (inv.placeOfSupply || "").toLowerCase();
      const total = String(inv.grandTotal || "");

      return (
        no.includes(q) ||
        name.includes(q) ||
        gstin.includes(q) ||
        date.includes(q) ||
        vehicle.includes(q) ||
        place.includes(q) ||
        total.includes(q)
      );
    });

    list = [...list].sort((a, b) => {
      if (sortBy === "date-desc") {
        return (b.id || 0) - (a.id || 0);
      }
      if (sortBy === "date-asc") {
        return (a.id || 0) - (b.id || 0);
      }
      if (sortBy === "amount-desc") {
        return Number(b.grandTotal || 0) - Number(a.grandTotal || 0);
      }
      if (sortBy === "amount-asc") {
        return Number(a.grandTotal || 0) - Number(b.grandTotal || 0);
      }
      return 0;
    });

    return list;
  }, [invoices, searchTerm, sortBy]);

  // Overall totals
  const totalBilled = useMemo(() => {
    return invoices.reduce((sum, inv) => sum + Number(inv.grandTotal || 0), 0);
  }, [invoices]);

  // Multi-select handlers
  const allFilteredSelected =
    filteredInvoices.length > 0 &&
    filteredInvoices.every((inv) => selectedIds.has(inv.id));

  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
    } else {
      const allIds = new Set(filteredInvoices.map((inv) => inv.id));
      setSelectedIds(allIds);
    }
  };

  const toggleSelectOne = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkDelete = () => {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete ${count} selected invoice(s)? This will sync deletions to other devices.`
    );

    if (!confirmed) return;

    const invoicesToDelete = invoices.filter((inv) => selectedIds.has(inv.id));
    onDeleteMultiple(invoicesToDelete);
    setSelectedIds(new Set());
  };

  return (
    <div className="transactions-page no-print">
      {/* Top Header */}
      <div className="transactions-header">
        <div>
          <h2>All Invoices & Transactions</h2>
          <p>Search, review, print, and manage company invoice records</p>
        </div>

        <button
          type="button"
          className="primary transactions-new-btn"
          onClick={onNewInvoice}
        >
          <Plus size={18} /> New Invoice
        </button>
      </div>

      {/* Summary Metrics */}
      <div className="transactions-metrics">
        <div className="metric-card">
          <div className="metric-icon">
            <Receipt size={22} />
          </div>
          <div>
            <span className="metric-label">Total Invoices</span>
            <strong className="metric-value">{invoices.length}</strong>
          </div>
        </div>

        <div className="metric-card">
          <div className="metric-icon green">
            <FileText size={22} />
          </div>
          <div>
            <span className="metric-label">Total Billed Revenue</span>
            <strong className="metric-value">
              ₹{totalBilled.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
          </div>
        </div>
      </div>

      {/* Search & Actions Toolbar */}
      <div className="transactions-toolbar">
        <div className="transactions-search-box">
          <Search size={18} className="search-icon" />
          <input
            type="text"
            placeholder="Search by invoice no, customer, date, vehicle, amount..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="clear-search-btn"
              onClick={() => setSearchTerm("")}
              title="Clear search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <div className="transactions-sort-box">
          <ArrowUpDown size={16} />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
            <option value="date-desc">Newest First</option>
            <option value="date-asc">Oldest First</option>
            <option value="amount-desc">Highest Amount</option>
            <option value="amount-asc">Lowest Amount</option>
          </select>
        </div>
      </div>

      {/* Bulk Action Bar (Visible when items selected) */}
      {selectedIds.size > 0 && (
        <div className="bulk-actions-bar">
          <div className="bulk-actions-info">
            <CheckSquare size={18} />
            <span>
              <strong>{selectedIds.size}</strong> invoice(s) selected
            </span>
          </div>

          <div className="bulk-actions-btns">
            <button
              type="button"
              className="bulk-delete-btn"
              onClick={handleBulkDelete}
            >
              <Trash2 size={16} /> Delete Selected ({selectedIds.size})
            </button>

            <button
              type="button"
              className="bulk-cancel-btn"
              onClick={() => setSelectedIds(new Set())}
            >
              Deselect All
            </button>
          </div>
        </div>
      )}

      {/* Transactions Table */}
      <div className="transactions-table-container">
        {filteredInvoices.length === 0 ? (
          <div className="transactions-empty-state">
            <Receipt size={48} />
            <h3>No invoices found</h3>
            <p>
              {searchTerm
                ? "No invoice matches your search criteria. Try a different search term."
                : "You haven't generated any invoices yet."}
            </p>
            {searchTerm ? (
              <button
                type="button"
                className="secondary"
                onClick={() => setSearchTerm("")}
              >
                Clear Search
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={onNewInvoice}
              >
                <Plus size={16} /> Create First Invoice
              </button>
            )}
          </div>
        ) : (
          <table className="transactions-table">
            <thead>
              <tr>
                <th style={{ width: "42px" }}>
                  <button
                    type="button"
                    className="select-checkbox-btn"
                    onClick={toggleSelectAll}
                    title={allFilteredSelected ? "Deselect all" : "Select all"}
                  >
                    {allFilteredSelected ? (
                      <CheckSquare size={18} color="#2563eb" />
                    ) : (
                      <Square size={18} color="#94a3b8" />
                    )}
                  </button>
                </th>
                <th>Invoice No</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Items</th>
                <th style={{ textAlign: "right" }}>Total Amount</th>
                <th style={{ textAlign: "center", width: "120px" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((inv) => {
                const isSelected = selectedIds.has(inv.id);
                return (
                  <tr
                    key={inv.id}
                    className={isSelected ? "row-selected" : ""}
                  >
                    <td>
                      <button
                        type="button"
                        className="select-checkbox-btn"
                        onClick={() => toggleSelectOne(inv.id)}
                      >
                        {isSelected ? (
                          <CheckSquare size={18} color="#2563eb" />
                        ) : (
                          <Square size={18} color="#94a3b8" />
                        )}
                      </button>
                    </td>

                    <td>
                      <button
                        type="button"
                        className="invoice-no-link"
                        onClick={() => onOpenInvoice(inv)}
                        title="Click to view invoice preview"
                      >
                        {inv.invoiceNo}
                      </button>
                    </td>

                    <td>
                      <div className="table-cell-date">
                        <Calendar size={13} />
                        <span>{inv.invoiceDate || "N/A"}</span>
                      </div>
                    </td>

                    <td>
                      <div className="table-cell-customer">
                        <strong>{inv.customerName}</strong>
                        {inv.customerGSTIN && (
                          <small>GST: {inv.customerGSTIN}</small>
                        )}
                      </div>
                    </td>

                    <td>
                      <span className="table-cell-vehicle">
                        {inv.vehicle || "—"}
                      </span>
                    </td>

                    <td>
                      <span className="table-cell-items-count">
                        {(inv.items || []).length} item(s)
                      </span>
                    </td>

                    <td style={{ textAlign: "right" }}>
                      <strong className="table-cell-amount">
                        ₹{Number(inv.grandTotal || 0).toLocaleString("en-IN", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2
                        })}
                      </strong>
                    </td>

                    <td>
                      <div className="table-cell-actions">
                        <button
                          type="button"
                          className="action-icon-btn view"
                          onClick={() => onOpenInvoice(inv)}
                          title="View / Print Invoice"
                          aria-label={`View invoice ${inv.invoiceNo}`}
                        >
                          <Eye size={16} />
                        </button>

                        <button
                          type="button"
                          className="action-icon-btn delete"
                          onClick={() => onDeleteInvoice(inv)}
                          title="Delete Invoice"
                          aria-label={`Delete invoice ${inv.invoiceNo}`}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
