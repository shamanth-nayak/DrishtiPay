export const VerificationStatus = Object.freeze({
  INTENDED_AMOUNT_MISSING: "INTENDED_AMOUNT_MISSING",
  QR_INVALID: "QR_INVALID",
  QR_AMOUNT_MISSING: "QR_AMOUNT_MISSING",
  MISMATCH_BLOCKED: "MISMATCH_BLOCKED",
  MATCH_NEEDS_CONFIRMATION: "MATCH_NEEDS_CONFIRMATION"
});

/** Extracts and cleans pure numerical rupees and paise from noisy OCR text (e.g. '₹ 10#', 'Rs. 35.00/-', 'MRP: 40') */
/** Extracts and cleans pure numerical rupees and paise from noisy OCR text (e.g. '10', '₹ 10#', 'Rs. 35.00/-', 'MRP: 40') */
export function cleanPriceString(raw) {
  if (!raw) return "";
  const s = String(raw).trim();
  // If it's already a clean numeric string like "10" or "10.00"
  if (/^\d+(\.\d{1,2})?$/.test(s)) {
    return s;
  }
  // Match standard Indian price numbers: optional commas, decimals
  const match = s.match(/(?:(?:Rs\.?|INR|₹)\s*)?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?/i);
  if (!match) {
    // Fallback: extract any sequence of digits
    const digitsOnly = s.replace(/[^\d.]/g, "");
    const secondMatch = digitsOnly.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    return secondMatch ? (secondMatch[2] ? `${secondMatch[1]}.${secondMatch[2]}` : secondMatch[1]) : "";
  }
  const whole = match[1].replace(/,/g, "");
  const frac = match[2];
  return frac ? `${whole}.${frac}` : whole;
}

/** Converts an INR decimal string to paise without using floating point. */
export function parseRupeesToPaise(value) {
  const rawStr = String(value ?? "").trim();
  // Reject 3 or more decimal places per Section 9.2 (e.g. 35.555 is invalid)
  if (/\.\d{3,}/.test(rawStr)) return null;

  const cleaned = cleanPriceString(value);
  if (!cleaned) return null;
  const match = cleaned.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  const rupees = Number(match[1]);
  const fractional = (match[2] || "").padEnd(2, "0");
  if (!Number.isSafeInteger(rupees) || rupees > 10000000) return null;
  return rupees * 100 + Number(fractional);
}

export function formatPaise(paise) {
  if (!Number.isInteger(paise)) return "an unknown amount";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(paise / 100);
}

export function parseUpiRequest(rawText) {
  try {
    const raw = String(rawText || "").trim();
    if (!raw) return { isValid: false, error: "Enter or scan a UPI payment QR code first." };
    const url = new URL(raw);
    if (url.protocol.toLowerCase() !== "upi:" || url.hostname.toLowerCase() !== "pay") {
      return { isValid: false, error: "Unsupported QR code. Please scan a UPI payment QR code." };
    }
    const params = url.searchParams;
    for (const key of ["pa", "am", "cu"]) {
      if (params.getAll(key).length > 1) {
        return { isValid: false, error: `The QR code contains duplicate ${key} fields. Do not continue.` };
      }
    }
    const payeeVpa = params.get("pa")?.trim();
    if (!payeeVpa || !/^[A-Za-z0-9._-]{2,256}@[A-Za-z0-9.-]{2,64}$/.test(payeeVpa)) {
      return { isValid: false, error: "The QR code does not contain a recognisable UPI ID." };
    }
    const currency = (params.get("cu") || "INR").toUpperCase();
    if (currency !== "INR") {
      return { isValid: false, error: `Unsupported currency ${currency}. Only INR is supported.` };
    }
    const rawAmount = params.get("am");
    let amountPaise = null;
    if (rawAmount !== null && rawAmount.trim() !== "") {
      amountPaise = parseRupeesToPaise(rawAmount.trim());
      if (amountPaise === null) {
        return { isValid: false, error: "The QR code contains an invalid payment amount." };
      }
    }
    return {
      isValid: true,
      rawText: raw,
      payeeVpa,
      payeeName: params.get("pn")?.trim() || "Name not provided in QR",
      amountPaise,
      currency,
      note: params.get("tn")?.trim() || ""
    };
  } catch {
    return { isValid: false, error: "This does not look like a valid UPI payment link." };
  }
}

export function verifyAmounts(intendedPaise, parsedQr) {
  if (!Number.isInteger(intendedPaise)) {
    return {
      status: VerificationStatus.INTENDED_AMOUNT_MISSING,
      mayOfferUpiHandoff: false,
      confirmationsRequired: 0,
      message: "Please enter or confirm the amount you intend to pay."
    };
  }
  if (!parsedQr?.isValid) {
    return {
      status: VerificationStatus.QR_INVALID,
      mayOfferUpiHandoff: false,
      confirmationsRequired: 0,
      message: parsedQr?.error || "This is not a valid supported UPI payment request. Payment has not been opened."
    };
  }
  if (!Number.isInteger(parsedQr.amountPaise)) {
    return {
      status: VerificationStatus.QR_AMOUNT_MISSING,
      mayOfferUpiHandoff: false,
      confirmationsRequired: 2,
      intendedPaise,
      qrPaise: null,
      message: `The QR has no fixed amount. Your intended amount is ${formatPaise(intendedPaise)}. You must check the amount in your UPI app yourself.`
    };
  }
  if (intendedPaise !== parsedQr.amountPaise) {
    return {
      status: VerificationStatus.MISMATCH_BLOCKED,
      mayOfferUpiHandoff: false,
      confirmationsRequired: 0,
      intendedPaise,
      qrPaise: parsedQr.amountPaise,
      message: `Amount mismatch: you intend to pay ${formatPaise(intendedPaise)}, but the QR requests ${formatPaise(parsedQr.amountPaise)}. Payment handoff is blocked.`
    };
  }
  return {
    status: VerificationStatus.MATCH_NEEDS_CONFIRMATION,
    mayOfferUpiHandoff: true,
    confirmationsRequired: 1,
    intendedPaise,
    qrPaise: parsedQr.amountPaise,
    message: `The amounts match at ${formatPaise(intendedPaise)}. Please confirm the payee and amount before opening your UPI app.`
  };
}

export function createSafeUpiLink(parsedQr) {
  if (!parsedQr?.isValid || !Number.isInteger(parsedQr.amountPaise)) return null;
  const params = new URLSearchParams({
    pa: parsedQr.payeeVpa,
    am: (parsedQr.amountPaise / 100).toFixed(2),
    cu: "INR"
  });
  if (parsedQr.payeeName) params.set("pn", parsedQr.payeeName);
  return `upi://pay?${params.toString()}`;
}

/** Calculates subtotal in paise for an item given unit price in paise and integer quantity. */
export function calculateItemSubtotal(unitPricePaise, quantity = 1) {
  if (!Number.isInteger(unitPricePaise) || unitPricePaise <= 0) return null;
  const q = Number.isInteger(quantity) && quantity > 0 ? quantity : 1;
  return unitPricePaise * q;
}

/** Calculates total in paise from an array of shopping items. */
export function calculateShoppingTotal(items = []) {
  if (!Array.isArray(items)) return 0;
  return items.reduce((sum, item) => {
    const sub = Number.isInteger(item?.subtotalPaise) && item.subtotalPaise > 0 
      ? item.subtotalPaise 
      : 0;
    return sum + sub;
  }, 0);
}

