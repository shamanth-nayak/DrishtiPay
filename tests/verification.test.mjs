import test from "node:test";
import assert from "node:assert/strict";
import { cleanPriceString, parseRupeesToPaise, parseUpiRequest, verifyAmounts, VerificationStatus } from "../frontend/js/verification.js";

test("converts INR strings to integer paise without floats", () => { assert.equal(parseRupeesToPaise("35"), 3500); assert.equal(parseRupeesToPaise("35.5"), 3550); assert.equal(parseRupeesToPaise("35.555"), null); });
test("cleans noisy OCR price text like '₹ 10#' and 'Rs. 35.00/-'", () => {
  assert.equal(cleanPriceString("₹ 10#"), "10");
  assert.equal(parseRupeesToPaise("₹ 10#"), 1000);
  assert.equal(cleanPriceString("Rs. 35.00/-"), "35.00");
  assert.equal(parseRupeesToPaise("Rs. 35.00/-"), 3500);
  assert.equal(cleanPriceString("MRP ₹ 1,250.50 incl."), "1250.50");
  assert.equal(parseRupeesToPaise("MRP ₹ 1,250.50 incl."), 125050);
});
test("a matching encoded UPI amount still needs confirmation", () => { const qr = parseUpiRequest("upi://pay?pa=store@upi&pn=Store&am=35.00&cu=INR"); assert.equal(verifyAmounts(3500, qr).status, VerificationStatus.MATCH_NEEDS_CONFIRMATION); });
test("a mismatch is blocked", () => { const qr = parseUpiRequest("upi://pay?pa=store@upi&am=350.00&cu=INR"); assert.equal(verifyAmounts(3500, qr).status, VerificationStatus.MISMATCH_BLOCKED); });
test("a UPI QR without amount is unverified", () => { const qr = parseUpiRequest("upi://pay?pa=store@upi&cu=INR"); assert.equal(verifyAmounts(3500, qr).status, VerificationStatus.QR_AMOUNT_MISSING); });
test("unsupported QR strings are invalid", () => { assert.equal(parseUpiRequest("https://example.com").isValid, false); });

