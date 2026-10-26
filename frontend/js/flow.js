// Deterministic Client-Side Flow State Machine per Blueprint Section 10.3 & 18.1
// Guards every state transition. Handoff is only reachable via explicit confirmation.

export const FlowPhase = Object.freeze({
  IDLE: "IDLE",
  CAPTURING_LABEL: "CAPTURING_LABEL",
  REVIEWING_PRICE: "REVIEWING_PRICE",
  ENTERING_AMOUNT: "ENTERING_AMOUNT",
  SCANNING_QR: "SCANNING_QR",
  VERIFYING: "VERIFYING",
  RESULT_MATCH: "RESULT_MATCH",
  RESULT_MISMATCH: "RESULT_MISMATCH",
  RESULT_QR_AMOUNT_MISSING: "RESULT_QR_AMOUNT_MISSING",
  RESULT_INVALID_OR_UNSUPPORTED: "RESULT_INVALID_OR_UNSUPPORTED",
  ERROR_NETWORK: "ERROR_NETWORK",
  AWAITING_CONFIRMATION: "AWAITING_CONFIRMATION",
  HANDOFF_OFFERED: "HANDOFF_OFFERED",
  AWAITING_USER_REPORT: "AWAITING_USER_REPORT",
  REPORTED_PAID: "REPORTED_PAID",
  REPORTED_FAILED: "REPORTED_FAILED",
  REPORTED_CANCELLED: "REPORTED_CANCELLED",
  REPORTED_WAITING: "REPORTED_WAITING",
  REPORTED_UNKNOWN: "REPORTED_UNKNOWN",
  CANCELLED: "CANCELLED"
});

export class FlowMachine {
  constructor() {
    this.phase = FlowPhase.IDLE;
    this.ctx = {
      intendedPaise: null,
      qrRaw: null,
      confirmedQrRaw: null,
      verified: null,
      confirmations: 0,
      candidates: [],
      outcome: null
    };
    this.listeners = [];
  }

  subscribe(fn) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }

  _notify() {
    for (const fn of this.listeners) {
      try { fn(this.phase, this.ctx); } catch (e) { console.error(e); }
    }
  }

  reset() {
    this.phase = FlowPhase.IDLE;
    this.ctx = {
      intendedPaise: null,
      qrRaw: null,
      confirmedQrRaw: null,
      verified: null,
      confirmations: 0,
      candidates: [],
      outcome: null
    };
    this._notify();
  }

  start() {
    this.phase = FlowPhase.CAPTURING_LABEL;
    this._notify();
  }

  skipLabelCapture() {
    this.phase = FlowPhase.ENTERING_AMOUNT;
    this._notify();
  }

  candidatesReceived(candidates) {
    this.ctx.candidates = candidates || [];
    this.phase = FlowPhase.REVIEWING_PRICE;
    this._notify();
  }

  setIntendedAmount(paise) {
    if (!Number.isInteger(paise) || paise <= 0) {
      throw new Error("Intended amount must be a positive integer in paise.");
    }
    // Invalidation rule: changing amount discards prior verification
    this.ctx.intendedPaise = paise;
    this.ctx.verified = null;
    this.ctx.confirmations = 0;
    this.phase = FlowPhase.SCANNING_QR;
    this._notify();
  }

  qrScanned(qrRaw) {
    if (!qrRaw || typeof qrRaw !== "string") {
      throw new Error("Invalid raw QR string.");
    }
    this.ctx.qrRaw = qrRaw.trim();
    // Invalidation rule: new scan discards earlier confirmation
    this.ctx.verified = null;
    this.ctx.confirmations = 0;
    this.phase = FlowPhase.VERIFYING;
    this._notify();
  }

  verificationReceived(verifyResult) {
    this.ctx.verified = verifyResult;
    this.ctx.confirmations = 0;

    switch (verifyResult.status) {
      case "MATCH":
      case "MATCH_NEEDS_CONFIRMATION":
        this.phase = FlowPhase.RESULT_MATCH;
        break;
      case "MISMATCH":
      case "MISMATCH_BLOCKED":
        this.phase = FlowPhase.RESULT_MISMATCH;
        break;
      case "QR_AMOUNT_MISSING":
        this.phase = FlowPhase.RESULT_QR_AMOUNT_MISSING;
        break;
      case "QR_INVALID":
      case "INVALID_OR_UNSUPPORTED_REQUEST":
        this.phase = FlowPhase.RESULT_INVALID_OR_UNSUPPORTED;
        break;
      case "INTENDED_AMOUNT_MISSING":
        this.phase = FlowPhase.ENTERING_AMOUNT;
        break;
      default:
        this.phase = FlowPhase.ERROR_NETWORK;
    }
    this._notify();
  }

  networkError() {
    this.phase = FlowPhase.ERROR_NETWORK;
    this._notify();
  }

  readyForConfirmation() {
    // Only reachable from MATCH or QR_AMOUNT_MISSING
    if (this.phase === FlowPhase.RESULT_MATCH || this.phase === FlowPhase.RESULT_QR_AMOUNT_MISSING) {
      this.phase = FlowPhase.AWAITING_CONFIRMATION;
      this._notify();
    }
  }

  // Explicit confirmation event
  confirm() {
    if (this.phase !== FlowPhase.AWAITING_CONFIRMATION &&
        this.phase !== FlowPhase.RESULT_MATCH &&
        this.phase !== FlowPhase.RESULT_QR_AMOUNT_MISSING) {
      return false;
    }

    this.ctx.confirmations++;
    this.ctx.confirmedQrRaw = this.ctx.qrRaw;

    if (this.canOfferHandoff()) {
      this.phase = FlowPhase.HANDOFF_OFFERED;
      this._notify();
      return true;
    } else {
      // For QR_AMOUNT_MISSING, 1st confirmation enters AWAITING_CONFIRMATION for 2nd prompt
      this.phase = FlowPhase.AWAITING_CONFIRMATION;
      this._notify();
      return false;
    }
  }

  cancel() {
    this.phase = FlowPhase.CANCELLED;
    this.ctx.confirmations = 0;
    this.ctx.verified = null;
    this.ctx.confirmedQrRaw = null;
    this._notify();
  }

  handoffOpened() {
    if (!this.canOfferHandoff()) {
      throw new Error("Handoff blocked by state machine guards.");
    }
    this.phase = FlowPhase.AWAITING_USER_REPORT;
    this._notify();
  }

  reportOutcome(outcome) {
    const validOutcomes = {
      paid: FlowPhase.REPORTED_PAID,
      failed: FlowPhase.REPORTED_FAILED,
      cancelled: FlowPhase.REPORTED_CANCELLED,
      waiting: FlowPhase.REPORTED_WAITING,
      unknown: FlowPhase.REPORTED_UNKNOWN
    };
    const nextPhase = validOutcomes[outcome.toLowerCase()] || FlowPhase.REPORTED_UNKNOWN;
    this.phase = nextPhase;
    this.ctx.outcome = outcome;
    this._notify();
  }

  // The ONLY function allowed to approve the UPI handoff transition (Handbook 10.3)
  canOfferHandoff() {
    const v = this.ctx.verified;
    if (!v) return false;
    if (!this.ctx.qrRaw || this.ctx.qrRaw !== this.ctx.confirmedQrRaw) return false;

    // MATCH requires 1 explicit confirmation
    if (v.status === "MATCH_NEEDS_CONFIRMATION") {
      return this.ctx.confirmations >= 1;
    }

    // QR_AMOUNT_MISSING requires 2 explicit confirmations
    if (v.status === "QR_AMOUNT_MISSING") {
      return this.ctx.confirmations >= 2;
    }

    // MISMATCH, INVALID_OR_UNSUPPORTED_REQUEST, INTENDED_AMOUNT_MISSING are strictly blocked
    return false;
  }
}
