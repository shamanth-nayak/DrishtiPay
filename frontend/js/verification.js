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
    const url = new URL(String(rawText).trim());
    if (url.protocol !== "upi:" || url.hostname !== "pay") {
      return { isValid: false, error: "This is not a supported UPI payment request." };
    }
    const payeeVpa = url.searchParams.get("pa")?.trim();
    if (!payeeVpa || !payeeVpa.includes("@")) {
      return { isValid: false, error: "The UPI request does not contain a valid payee address." };
    }
    const currency = (url.searchParams.get("cu") || "INR").toUpperCase();
    if (currency !== "INR") {
      return { isValid: false, error: "Only INR UPI requests are supported in this prototype." };
    }
    const rawAmount = url.searchParams.get("am");
    const amountPaise = rawAmount === null || rawAmount === "" ? null : parseRupeesToPaise(rawAmount);
    if (rawAmount !== null && amountPaise === null) {
      return { isValid: false, error: "The amount encoded in this QR could not be read safely." };
    }
    return {
      isValid: true,
      rawText: String(rawText).trim(),
      payeeVpa,
      payeeName: url.searchParams.get("pn")?.trim() || null,
      amountPaise,
      currency
    };
  } catch {
    return { isValid: false, error: "This QR text could not be parsed as a UPI request." };
  }
}

export function verifyAmounts(intendedPaise, parsedQr) {
  if (!Number.isInteger(intendedPaise)) {
    return { status: VerificationStatus.INTENDED_AMOUNT_MISSING, mayOfferUpiHandoff: false, message: "Please enter or confirm the amount you intend to pay." };
  }
  if (!parsedQr?.isValid) {
    return { status: VerificationStatus.QR_INVALID, mayOfferUpiHandoff: false, message: "This is not a valid supported UPI payment request. Payment has not been opened." };
  }
  if (!Number.isInteger(parsedQr.amountPaise)) {
    return { status: VerificationStatus.QR_AMOUNT_MISSING, mayOfferUpiHandoff: false, message: "This QR has no fixed amount. DrishtiPay cannot verify the amount, so payment has not been opened." };
  }
  if (intendedPaise !== parsedQr.amountPaise) {
    return { status: VerificationStatus.MISMATCH_BLOCKED, mayOfferUpiHandoff: false, message: `The QR requests ${formatPaise(parsedQr.amountPaise)}. You said ${formatPaise(intendedPaise)}. The amounts do not match. Payment has not been opened.` };
  }
  return { status: VerificationStatus.MATCH_NEEDS_CONFIRMATION, mayOfferUpiHandoff: true, message: `The amounts match at ${formatPaise(intendedPaise)}. Please confirm the payee and amount before opening your UPI app.` };
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
