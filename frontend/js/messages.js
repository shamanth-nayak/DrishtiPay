// Exact spoken and screen-reader messages per DrishtiPay Blueprint Section 13.2
// Enforces wording rule: No "safe", "verified merchant", "payment successful", or "secure".

export const SpokenMessages = Object.freeze({
  M01_WELCOME: "DrishtiPay helps you check a product label and a payment request. It does not make payments. You will confirm every step. Say start, or press the Start button.",
  M02_CAMERA_DENIED: "I cannot use the camera. You can enable it in your browser settings, choose a photo, or type the price instead.",
  M03_MIC_DENIED: "Voice input is not available. You can type or use the buttons. I will still read everything aloud.",
  M04_CAPTURE_GUIDANCE: "Hold the label in front of the camera, close and steady. Press Capture when ready.",
  M05_UNCERTAIN_OCR_ONE: (amount) => `I found a possible price of ${amount} on the label. I am not certain. Is that correct? Say yes, say no, or type it.`,
  M06_UNCERTAIN_OCR_MANY: (list) => `I found more than one possible price: ${list}. Which one is the printed price, or type your own.`,
  M07_NO_PRICE_FOUND: "I could not read a price on this label. Please retake the photo or type the price.",
  M08_INTENDED_REQUEST: "How much do you intend to pay? Say the amount in rupees, or type it.",
  M09_INTENDED_READBACK: (amount) => `You intend to pay ${amount}. Say yes to continue, or no to change it.`,
  M10_QR_GUIDANCE: "Point the camera at the shop's payment QR code and hold steady.",
  M11_QR_UNREADABLE: "I could not read a QR code. Move closer, add light, and try again.",
  M12_MATCH: (amount) => `The amounts match at ${amount}. This does not confirm who the merchant is. Please confirm the payee and amount before continuing.`,
  M13_MISMATCH: (qrAmount, intendedAmount) => `The QR requests ${qrAmount}. You said ${intendedAmount}. The amounts do not match. Payment has not been opened.`,
  M14_UNKNOWN_QR_AMOUNT: "I could not read a fixed amount from this QR, so I cannot compare it. Please check the amount in your UPI app before paying.",
  M15_UNUSABLE_QR: "I could not read a valid UPI payment request from this QR. Payment has not been opened. Please scan again or ask the shopkeeper.",
  M16_PAYEE_READBACK: (id, name, amount) => `The QR shows the payee ID ${id}, and the name ${name || "unspecified"}. The name comes from the QR and I cannot confirm it belongs to the shop. The amount is ${amount}.`,
  M17_CONFIRM_PROMPT: "Say confirm to open your UPI app, or say cancel.",
  M18_SECOND_CONFIRM: "This amount is unverified. You must check it in your UPI app. Say confirm again only if you want to continue, or say cancel.",
  M19_UNCLEAR_REPLY: "I did not understand. Say confirm or cancel.",
  M20_SILENCE_OR_TIMEOUT: "I did not hear a clear answer, so I have cancelled. Nothing was opened.",
  M21_CANCELLED: "Cancelled. No payment was opened.",
  M22_NETWORK_FAILURE: "I cannot reach the service, so I cannot verify this. I will not continue without verification. Try again, or cancel.",
  M23_OPENING_UPI: "Opening your UPI app. You will enter your PIN there. Return here afterwards.",
  M24_UPI_NOT_OPENED: "I could not open a UPI app. Nothing has been paid.",
  M25_ASK_OUTCOME: "Did the payment complete? Please check your UPI app. Say paid, failed, cancelled, still waiting, or not sure.",
  M26_REPORTED_PAID: "You reported the payment as completed. I could not verify this myself.",
  M27_REPORTED_STATUS: (status) => `You reported the payment as ${status}. I could not verify this myself.`,
  M28_UNKNOWN_OUTCOME: "The payment status is unknown. Please check your UPI app history before assuming anything.",
  M30_PRODUCT_ADDED: (name, qty, subtotal, total) => `Added ${qty} ${name}, subtotal ${subtotal}. Total shopping amount is ${total}.`,
  M31_PRODUCT_REMOVED: (name, total) => `Removed ${name} from shopping list. Total shopping amount is now ${total}.`,
  M32_SHOPPING_LIST_SUMMARY: (count, total) => `Shopping list has ${count} item${count === 1 ? "" : "s"}. Total shopping amount is ${total}.`,
  M33_LIST_CLEARED: "Shopping list cleared. Total is zero rupees.",
  M34_PROCEED_TO_QR_WITH_TOTAL: (total) => `Total shopping amount is ${total}. Point camera at merchant payment QR code and hold steady.`,
  M35_MISSING_PRICE_WARNING: "No price detected on label. Please enter or speak the price before adding to shopping list.",
  M36_EMPTY_LIST_WARNING: "Your shopping list is empty. Add a product before proceeding to payment verification.",
  M37_CONFIRM_CLEAR_LIST: "Are you sure you want to clear your shopping list? Tap Confirm Clear to empty your list, or tap anywhere else to keep items."
});

export const FORBIDDEN_WORDS = ["safe", "verified merchant", "payment successful", "secure"];

export function validateNoForbiddenWords(text) {
  const lower = String(text).toLowerCase();
  for (const word of FORBIDDEN_WORDS) {
    if (lower.includes(word)) {
      throw new Error(`Accessibility policy violation: forbidden word "${word}" found in spoken message: "${text}"`);
    }
  }
  return true;
}
