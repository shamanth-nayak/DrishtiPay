import test from "node:test";
import assert from "node:assert/strict";
import { FlowMachine, FlowPhase } from "../frontend/js/flow.js";

test("FlowMachine initializes in IDLE and cannot offer handoff", () => {
  const f = new FlowMachine();
  assert.equal(f.phase, FlowPhase.IDLE);
  assert.equal(f.canOfferHandoff(), false);
});

test("ST-01: Mismatch cannot hand off even after confirm attempts", () => {
  const f = new FlowMachine();
  f.start();
  f.setIntendedAmount(3500);
  f.qrScanned("upi://pay?pa=m@upi&am=350.00&cu=INR");
  f.verificationReceived({
    status: "MISMATCH",
    next_action: "BLOCK_HANDOFF"
  });
  assert.equal(f.phase, FlowPhase.RESULT_MISMATCH);
  assert.equal(f.canOfferHandoff(), false);
  f.confirm();
  assert.equal(f.canOfferHandoff(), false);
  assert.throws(() => f.handoffOpened(), /blocked/i);
});

test("ST-02: Invalid QR cannot hand off", () => {
  const f = new FlowMachine();
  f.start();
  f.setIntendedAmount(3500);
  f.qrScanned("https://evil.example.com");
  f.verificationReceived({
    status: "INVALID_OR_UNSUPPORTED_REQUEST",
    next_action: "BLOCK_HANDOFF"
  });
  assert.equal(f.phase, FlowPhase.RESULT_INVALID_OR_UNSUPPORTED);
  assert.equal(f.canOfferHandoff(), false);
  f.confirm();
  assert.equal(f.canOfferHandoff(), false);
});

test("ST-04: Match needs exactly one confirmation", () => {
  const f = new FlowMachine();
  f.start();
  f.setIntendedAmount(3500);
  const qr = "upi://pay?pa=m@upi&am=35.00&cu=INR";
  f.qrScanned(qr);
  f.verificationReceived({
    status: "MATCH_NEEDS_CONFIRMATION",
    next_action: "PROCEED_WITH_CONFIRMATION"
  });
  assert.equal(f.phase, FlowPhase.RESULT_MATCH);
  assert.equal(f.canOfferHandoff(), false); // Zero confirms insufficient

  f.confirm();
  assert.equal(f.canOfferHandoff(), true);
  assert.equal(f.phase, FlowPhase.HANDOFF_OFFERED);
});

test("ST-03: QR with missing amount needs two explicit confirmations", () => {
  const f = new FlowMachine();
  f.start();
  f.setIntendedAmount(3500);
  const qr = "upi://pay?pa=m@upi&cu=INR";
  f.qrScanned(qr);
  f.verificationReceived({
    status: "QR_AMOUNT_MISSING",
    next_action: "MANUAL_CHECK_REQUIRED"
  });
  assert.equal(f.phase, FlowPhase.RESULT_QR_AMOUNT_MISSING);
  assert.equal(f.canOfferHandoff(), false);

  // 1st confirm -> not yet
  f.confirm();
  assert.equal(f.canOfferHandoff(), false);
  assert.equal(f.ctx.confirmations, 1);

  // 2nd confirm -> approved
  f.confirm();
  assert.equal(f.canOfferHandoff(), true);
  assert.equal(f.phase, FlowPhase.HANDOFF_OFFERED);
});

test("ST-07: Rescanning invalidates previous confirmation", () => {
  const f = new FlowMachine();
  f.start();
  f.setIntendedAmount(3500);
  const qr1 = "upi://pay?pa=m@upi&am=35.00&cu=INR";
  f.qrScanned(qr1);
  f.verificationReceived({
    status: "MATCH_NEEDS_CONFIRMATION",
    next_action: "PROCEED_WITH_CONFIRMATION"
  });
  f.confirm();
  assert.equal(f.canOfferHandoff(), true);

  // New scan arrives!
  f.qrScanned("upi://pay?pa=m@upi&am=350.00&cu=INR");
  assert.equal(f.canOfferHandoff(), false);
  assert.equal(f.phase, FlowPhase.VERIFYING);
});

test("ST-12: Cancel from any phase clears verified context", () => {
  const f = new FlowMachine();
  f.start();
  f.setIntendedAmount(3500);
  f.qrScanned("upi://pay?pa=m@upi&am=35.00&cu=INR");
  f.cancel();
  assert.equal(f.phase, FlowPhase.CANCELLED);
  assert.equal(f.ctx.confirmations, 0);
  assert.equal(f.ctx.verified, null);
  assert.equal(f.canOfferHandoff(), false);
});
