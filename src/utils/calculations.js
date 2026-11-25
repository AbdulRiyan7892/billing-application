
export function calculateInvoice(items, gst, isInterState) {

  const subtotal = items.reduce((total, item) => {
    return total +
      Number(item.qty || 0) *
      Number(item.rate || 0);
  }, 0);

  let cgst = 0;
  let sgst = 0;
  let igst = 0;

  if (isInterState) {
    igst = subtotal * Number(gst.igst || 0) / 100;
  } else {
    cgst = subtotal * Number(gst.cgst || 0) / 100;
    sgst = subtotal * Number(gst.sgst || 0) / 100;
  }
  const grandTotal = Math.round(
  subtotal + cgst + sgst + igst
);
 
  return {
    subtotal,
    cgst,
    sgst,
    igst,

    grandTotal
  };
}
