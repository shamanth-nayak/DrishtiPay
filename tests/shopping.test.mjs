import test from "node:test";
import assert from "node:assert/strict";
import { FlowMachine, FlowPhase } from "../frontend/js/flow.js";
import {
  calculateItemSubtotal,
  calculateShoppingTotal,
  parseUpiRequest,
  verifyAmounts,
  VerificationStatus,
  formatPaise
} from "../frontend/js/verification.js";

test("1. Adding one product to shopping list", () => {
  const f = new FlowMachine();
  f.start();
  const item = f.addShoppingItem({
    productName: "Tata Salt",
    brand: "Tata",
    detectedMrp: "28.00",
    unitPricePaise: 2800,
    quantity: 1
  });

  assert.equal(f.ctx.shoppingList.length, 1);
  assert.equal(item.productName, "Tata Salt");
  assert.equal(item.brand, "Tata");
  assert.equal(item.unitPricePaise, 2800);
  assert.equal(item.quantity, 1);
  assert.equal(item.subtotalPaise, 2800);
  assert.equal(f.getShoppingTotalPaise(), 2800);
  assert.equal(f.ctx.intendedPaise, 2800);
});

test("2. Adding multiple products and verifying list", () => {
  const f = new FlowMachine();
  f.start();
  f.addShoppingItem({ productName: "Product A", unitPricePaise: 2000, quantity: 1 });
  f.addShoppingItem({ productName: "Product B", unitPricePaise: 3550, quantity: 1 });
  f.addShoppingItem({ productName: "Product C", unitPricePaise: 1500, quantity: 2 });

  assert.equal(f.ctx.shoppingList.length, 3);
  // Total: 20.00 + 35.50 + (15.00 * 2) = 85.50 -> 8550 paise
  assert.equal(f.getShoppingTotalPaise(), 8550);
  assert.equal(formatPaise(f.getShoppingTotalPaise()).includes("85.5"), true);
});

test("3. Returning to scanning without losing previously added products", () => {
  const f = new FlowMachine();
  f.start();
  f.addShoppingItem({ productName: "Product 1", unitPricePaise: 1000, quantity: 1 });
  assert.equal(f.ctx.shoppingList.length, 1);

  // Return to scan next product
  f.scanAnotherProduct();
  assert.equal(f.phase, FlowPhase.CAPTURING_LABEL);
  assert.equal(f.ctx.shoppingList.length, 1);
  assert.equal(f.ctx.shoppingList[0].productName, "Product 1");

  // Add 2nd product
  f.addShoppingItem({ productName: "Product 2", unitPricePaise: 2500, quantity: 1 });
  assert.equal(f.ctx.shoppingList.length, 2);
  assert.equal(f.getShoppingTotalPaise(), 3500);
});

test("4. Correctly calculating the total for multiple prices using integer paise", () => {
  const items = [
    { subtotalPaise: 199 },    // ₹1.99
    { subtotalPaise: 100050 }, // ₹1000.50
    { subtotalPaise: 49 },     // ₹0.49
    { subtotalPaise: 7500 }    // ₹75.00
  ];
  const total = calculateShoppingTotal(items);
  // 199 + 100050 + 49 + 7500 = 107798
  assert.equal(total, 107798);
  assert.equal(Number.isInteger(total), true);
});

test("5. Correct quantity and subtotal calculations", () => {
  assert.equal(calculateItemSubtotal(3550, 1), 3550);
  assert.equal(calculateItemSubtotal(3550, 3), 10650);
  assert.equal(calculateItemSubtotal(1200, 5), 6000);

  const f = new FlowMachine();
  const item = f.addShoppingItem({ productName: "Soap", unitPricePaise: 4500, quantity: 2 });
  assert.equal(item.subtotalPaise, 9000);

  // Update quantity to 4
  const ok = f.updateShoppingItemQuantity(item.id, 4);
  assert.equal(ok, true);
  assert.equal(item.quantity, 4);
  assert.equal(item.subtotalPaise, 18000);
  assert.equal(f.getShoppingTotalPaise(), 18000);
});

test("6. Removing an item and recalculating the total", () => {
  const f = new FlowMachine();
  const itemA = f.addShoppingItem({ productName: "A", unitPricePaise: 2000, quantity: 1 });
  const itemB = f.addShoppingItem({ productName: "B", unitPricePaise: 3500, quantity: 1 });
  assert.equal(f.getShoppingTotalPaise(), 5500);

  const removed = f.removeShoppingItem(itemA.id);
  assert.equal(removed.productName, "A");
  assert.equal(f.ctx.shoppingList.length, 1);
  assert.equal(f.getShoppingTotalPaise(), 3500);
  assert.equal(f.ctx.intendedPaise, 3500);
});

test("7. Rejecting invalid or missing prices", () => {
  const f = new FlowMachine();
  assert.throws(() => f.addShoppingItem({ productName: "Bad", unitPricePaise: 0 }), /positive integer/);
  assert.throws(() => f.addShoppingItem({ productName: "Bad", unitPricePaise: -500 }), /positive integer/);
  assert.throws(() => f.addShoppingItem({ productName: "Bad", unitPricePaise: null }), /positive integer/);
  assert.throws(() => f.addShoppingItem({ productName: "Bad", unitPricePaise: 35.5 }), /positive integer/);
  assert.throws(() => f.addShoppingItem(null), /required/);

  assert.equal(calculateItemSubtotal(0, 1), null);
  assert.equal(calculateItemSubtotal(-100, 1), null);
  assert.equal(calculateItemSubtotal("invalid", 1), null);
});

test("8. Preventing accidental double additions using review session guard", () => {
  // Simulate the UI double-addition guard
  let isAdding = false;
  let sessionAdded = false;
  const f = new FlowMachine();

  const addAttempt = () => {
    if (isAdding || sessionAdded) return false;
    isAdding = true;
    try {
      f.addShoppingItem({ productName: "Tea", unitPricePaise: 12000, quantity: 1 });
      sessionAdded = true;
      return true;
    } finally {
      isAdding = false;
    }
  };

  // First tap succeeds
  assert.equal(addAttempt(), true);
  assert.equal(f.ctx.shoppingList.length, 1);

  // Rapid second tap is blocked by sessionAdded guard
  assert.equal(addAttempt(), false);
  assert.equal(f.ctx.shoppingList.length, 1);
});

test("9. Preserving explicitly added duplicate products as separate items", () => {
  const f = new FlowMachine();
  // First explicit scan of Biscuit
  const item1 = f.addShoppingItem({ productName: "Biscuit", unitPricePaise: 1000, quantity: 1 });
  // Second explicit scan of Biscuit
  const item2 = f.addShoppingItem({ productName: "Biscuit", unitPricePaise: 1000, quantity: 1 });

  assert.equal(f.ctx.shoppingList.length, 2);
  assert.notEqual(item1.id, item2.id);
  assert.equal(f.getShoppingTotalPaise(), 2000);
});

test("10. Passing the final shopping total to payment verification", () => {
  const f = new FlowMachine();
  f.addShoppingItem({ productName: "A", unitPricePaise: 2000, quantity: 1 });
  f.addShoppingItem({ productName: "B", unitPricePaise: 3550, quantity: 1 });
  f.addShoppingItem({ productName: "C", unitPricePaise: 1500, quantity: 2 });
  // Total: 8550 paise (₹85.50)

  f.proceedToPaymentFromShoppingList();
  assert.equal(f.phase, FlowPhase.SCANNING_QR);
  assert.equal(f.ctx.intendedPaise, 8550);
});

test("11. Blocking handoff when QR amount mismatches the shopping total", () => {
  const f = new FlowMachine();
  f.addShoppingItem({ productName: "A", unitPricePaise: 5000, quantity: 1 });
  f.addShoppingItem({ productName: "B", unitPricePaise: 3550, quantity: 1 });
  // Intended Total: 8550 paise (₹85.50)
  f.proceedToPaymentFromShoppingList();

  // QR requests ₹100.00 (10000 paise)
  const qrRaw = "upi://pay?pa=merchant@upi&pn=Merchant&am=100.00&cu=INR";
  f.qrScanned(qrRaw);
  const parsed = parseUpiRequest(qrRaw);
  const verifyResult = verifyAmounts(f.ctx.intendedPaise, parsed);

  assert.equal(verifyResult.status, VerificationStatus.MISMATCH_BLOCKED);
  f.verificationReceived(verifyResult);

  assert.equal(f.phase, FlowPhase.RESULT_MISMATCH);
  assert.equal(f.canOfferHandoff(), false);

  // Attempt to confirm is rejected
  assert.equal(f.confirm(), false);
  assert.equal(f.canOfferHandoff(), false);
  assert.throws(() => f.handoffOpened(), /blocked/i);
});

test("12. Requiring existing two confirmations for QR without embedded amount against shopping total", () => {
  const f = new FlowMachine();
  f.addShoppingItem({ productName: "A", unitPricePaise: 5000, quantity: 1 });
  f.proceedToPaymentFromShoppingList();

  const qrNoAmt = "upi://pay?pa=merchant@upi&pn=Merchant&cu=INR";
  f.qrScanned(qrNoAmt);
  const parsed = parseUpiRequest(qrNoAmt);
  const verifyResult = verifyAmounts(f.ctx.intendedPaise, parsed);

  assert.equal(verifyResult.status, VerificationStatus.QR_AMOUNT_MISSING);
  f.verificationReceived(verifyResult);

  assert.equal(f.phase, FlowPhase.RESULT_QR_AMOUNT_MISSING);
  assert.equal(f.canOfferHandoff(), false);

  // 1st confirmation
  const firstConfirm = f.confirm();
  assert.equal(firstConfirm, false);
  assert.equal(f.canOfferHandoff(), false);
  assert.equal(f.ctx.confirmations, 1);
  assert.equal(f.phase, FlowPhase.AWAITING_CONFIRMATION);

  // 2nd confirmation
  const secondConfirm = f.confirm();
  assert.equal(secondConfirm, true);
  assert.equal(f.canOfferHandoff(), true);
  assert.equal(f.phase, FlowPhase.HANDOFF_OFFERED);
});

test("13. Resetting confirmations after the shopping total changes", () => {
  const f = new FlowMachine();
  const item = f.addShoppingItem({ productName: "A", unitPricePaise: 3500, quantity: 1 });
  f.proceedToPaymentFromShoppingList();

  const qrMatch = "upi://pay?pa=m@upi&pn=M&am=35.00&cu=INR";
  f.qrScanned(qrMatch);
  f.verificationReceived({ status: "MATCH_NEEDS_CONFIRMATION", next_action: "PROCEED_WITH_CONFIRMATION" });

  f.confirm();
  assert.equal(f.canOfferHandoff(), true);

  // User adds another item to the shopping list
  f.addShoppingItem({ productName: "B", unitPricePaise: 1500, quantity: 1 });
  // Total is now 5000 paise; prior verification and confirmations MUST be reset
  assert.equal(f.getShoppingTotalPaise(), 5000);
  assert.equal(f.ctx.verified, null);
  assert.equal(f.ctx.confirmations, 0);
  assert.equal(f.canOfferHandoff(), false);
});

test("14. Cannot proceed to payment with empty shopping list", () => {
  const f = new FlowMachine();
  assert.throws(() => f.proceedToPaymentFromShoppingList(), /empty/i);

  f.addShoppingItem({ productName: "A", unitPricePaise: 2000, quantity: 1 });
  f.clearShoppingList();
  assert.throws(() => f.proceedToPaymentFromShoppingList(), /empty/i);
});
