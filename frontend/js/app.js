import { readProductLabel } from "./api.js";
import { cleanPriceString, formatPaise, parseRupeesToPaise, parseUpiRequest, verifyAmounts, VerificationStatus } from "./verification.js";
import { SpokenMessages } from "./messages.js";
import { speech } from "./speech.js";
import { sound } from "./sound.js";
import { FlowMachine, FlowPhase } from "./flow.js";

const $ = (id) => document.getElementById(id);

// Flow engine
const flow = new FlowMachine();
let activeStream = null;
let scanTimer = null;
let autoCaptureTimeout = null;
let latestQr = null;

// Speech and Sound Feedback
function announceState(text, { assertive = false, soundCue = null } = {}) {
  if (soundCue) {
    if (soundCue === "success") sound.playSuccess();
    else if (soundCue === "alert") sound.playAlert();
    else if (soundCue === "step") sound.playStep();
    else if (soundCue === "detected") sound.playDetected();
  }
  speech.announce(text, { assertive });
}

// Autonomous Screen Navigation & Immediate Camera Ignition
async function navigateTo(targetPageId, announcementText = null) {
  stopActiveCamera();

  const pages = [
    "welcome",
    "product-scan",
    "product-review",
    "qr-scan",
    "verification",
    "payment-consent",
    "outcome-report"
  ];

  pages.forEach((id) => {
    const el = $(id);
    if (el) {
      el.hidden = id !== targetPageId;
      if (id === targetPageId) el.classList.add("active");
      else el.classList.remove("active");
    }
  });

  // Progress Bar
  const stepIndex = pages.indexOf(targetPageId) + 1;
  const progressLabel = $("progress-label");
  const progressBar = $("progress-bar");
  if (progressLabel && progressBar) {
    progressLabel.textContent = `Step ${Math.min(stepIndex, 5)} of 5`;
    progressBar.style.width = `${Math.min(stepIndex * 20, 100)}%`;
  }

  // Automatic Focus Management (TalkBack reads the screen heading)
  const targetPage = $(targetPageId);
  if (targetPage) {
    const heading = targetPage.querySelector("h1");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus();
    }
  }

  if (announcementText) {
    announceState(announcementText, { soundCue: "step" });
  }

  // Autonomous Behavior: Camera auto-starts immediately on scan screens
  if (targetPageId === "product-scan") {
    await autoStartProductCamera();
  } else if (targetPageId === "qr-scan") {
    await autoStartQrCamera();
  } else if (targetPageId === "product-review") {
    // Automatically focus the giant intended amount input
    setTimeout(() => $("intended-amount")?.focus(), 400);
  }
}

// Stop any camera stream and clear timers
function stopActiveCamera() {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
  }
  if (autoCaptureTimeout) {
    clearTimeout(autoCaptureTimeout);
    autoCaptureTimeout = null;
  }
  if (activeStream) {
    activeStream.getTracks().forEach((t) => t.stop());
    activeStream = null;
  }
  const pVid = $("product-camera");
  const qVid = $("qr-camera");
  if (pVid) pVid.srcObject = null;
  if (qVid) qVid.srcObject = null;
}

// Step 2: Auto-Starting Product Label Camera
async function autoStartProductCamera() {
  const video = $("product-camera");
  const statusEl = $("product-scan-status");
  if (statusEl) statusEl.textContent = "Camera active. Hold product label steady...";

  try {
    const stream = await navigator.mediaDevices?.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    if (!stream) throw new Error("No camera stream");

    activeStream = stream;
    video.srcObject = stream;
    sound.playStep();

    // Auto-capture countdown for blind user: after 4 seconds of holding steady, auto-snap
    announceState("Camera is looking for product label. Hold steady.", { soundCue: "step" });

    autoCaptureTimeout = setTimeout(() => {
      triggerProductCapture();
    }, 4500);
  } catch (err) {
    console.error("Camera access:", err);
    if (statusEl) statusEl.textContent = "Camera unavailable. Enter amount manually.";
    announceState(SpokenMessages.M02_CAMERA_DENIED, { assertive: true, soundCue: "alert" });
  }
}

// Process any label file (camera snapshot or uploaded image)
async function processLabelFile(file) {
  const statusEl = $("product-scan-status");
  sound.playDetected();
  if (statusEl) statusEl.textContent = "Analyzing label image with AI...";
  announceState("Analyzing label image. Reading printed price now...", { soundCue: "detected" });

  try {
    const data = await readProductLabel(file);
    console.log("DrishtiPay label response:", data);
    
    const getField = (f) => {
      const field = data[f];
      if (!field) return "";
      if (typeof field.value === "string" && field.value.trim() && field.value.toLowerCase() !== "null") return field.value.trim();
      if (typeof field.supporting_text === "string" && field.supporting_text.trim() && field.supporting_text.toLowerCase() !== "null") return field.supporting_text.trim();
      return "";
    };

    const rawMrpText = getField("printed_mrp");
    const cleanMrp = cleanPriceString(rawMrpText);
    const prodName = getField("product_name") || "Package";
    const expDate = getField("expiry_date") || "Not visible";

    // Stop camera before navigating
    stopActiveCamera();

    const readoutMsg = cleanMrp
      ? `Found printed MRP of ${cleanMrp} rupees for ${prodName}. Tap top of screen to confirm, or enter your agreed amount.`
      : `Read product ${prodName}, but could not confirm a printed MRP. Enter the amount you intend to pay.`;

    // First transition screen
    await navigateTo("product-review", readoutMsg);

    // Then update all inputs and context elements
    if ($("product-name")) $("product-name").value = prodName;
    if ($("printed-mrp")) $("printed-mrp").value = cleanMrp ? `₹${cleanMrp}` : (rawMrpText || "Not visible");
    if ($("expiry-date")) $("expiry-date").value = expDate;

    const mrpBadge = $("mrp-preview-badge");
    if (mrpBadge) mrpBadge.textContent = cleanMrp ? `₹${cleanMrp}` : (rawMrpText || "none");

    const intendedInput = $("intended-amount");
    if (intendedInput) {
      intendedInput.value = cleanMrp || "";
      intendedInput.placeholder = cleanMrp || "0.00";
    }

    const leadEl = $("product-readout-lead");
    if (leadEl) leadEl.textContent = readoutMsg;

  } catch (err) {
    console.warn("OCR read error:", err);
    stopActiveCamera();
    navigateTo("product-review", "Could not read label automatically. Enter your intended payment amount.");
  }
}

// Capture photo from video stream
function triggerProductCapture() {
  const video = $("product-camera");

  if (!activeStream || !video || video.videoWidth < 1) {
    announceState("Camera not ready. Tap Capture Now or Upload Image.", { soundCue: "alert" });
    return;
  }

  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d")?.drawImage(video, 0, 0);

  canvas.toBlob((blob) => {
    if (!blob) return;
    const file = new File([blob], "label.jpg", { type: "image/jpeg" });
    processLabelFile(file);
  }, "image/jpeg", 0.92);
}

// Step 4: Auto-Starting Merchant QR Scanner
async function autoStartQrCamera() {
  const video = $("qr-camera");
  const statusEl = $("qr-scan-status");
  if (statusEl) statusEl.textContent = "Camera live. Aiming for shop's UPI QR...";

  try {
    const stream = await navigator.mediaDevices?.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    if (!stream) throw new Error("No camera stream");

    activeStream = stream;
    video.srcObject = stream;
    sound.playStep();
    announceState(SpokenMessages.M10_QR_GUIDANCE, { soundCue: "step" });

    // Live continuous QR detection via BarcodeDetector API
    if ("BarcodeDetector" in window) {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      scanTimer = setInterval(async () => {
        try {
          if (video.readyState < 2) return;
          const codes = await detector.detect(video);
          if (codes.length > 0 && codes[0].rawValue) {
            const raw = codes[0].rawValue.trim();
            stopActiveCamera();
            $("qr-text").value = raw;
            sound.playDetected();
            announceState("Payment QR detected. Verifying amount.", { soundCue: "detected" });
            runVerification(raw);
          }
        } catch {}
      }, 400);
    } else {
      if (statusEl) statusEl.textContent = "Live QR scan unavailable. Paste UPI request in fallback below.";
    }
  } catch (err) {
    console.error("QR Camera access:", err);
    announceState(SpokenMessages.M02_CAMERA_DENIED, { assertive: true, soundCue: "alert" });
  }
}

// Verification Pipeline
function runVerification(rawQrText) {
  const raw = rawQrText || $("qr-text")?.value.trim();
  if (!raw) {
    announceState(SpokenMessages.M15_UNUSABLE_QR, { assertive: true, soundCue: "alert" });
    return;
  }

  const intended = parseRupeesToPaise($("intended-amount").value);
  if (!Number.isInteger(intended)) {
    announceState(SpokenMessages.M08_INTENDED_REQUEST, { assertive: true, soundCue: "alert" });
    navigateTo("product-review");
    return;
  }

  try {
    flow.qrScanned(raw);
  } catch {
    announceState(SpokenMessages.M15_UNUSABLE_QR, { assertive: true, soundCue: "alert" });
    return;
  }

  const parsed = parseUpiRequest(raw);
  latestQr = parsed;
  const verified = verifyAmounts(intended, parsed);
  flow.verificationReceived(verified);

  const resultContainer = $("result");
  const summary = $("qr-summary");
  const proceedBtn = $("payment-consent-button");

  if (parsed.isValid) {
    summary.hidden = false;
    summary.innerHTML = `
      <dt>Payee</dt><dd>${parsed.payeeName || "Unverified Name"}</dd>
      <dt>UPI Address</dt><dd>${parsed.payeeVpa}</dd>
      <dt>QR Amount</dt><dd>${Number.isInteger(parsed.amountPaise) ? formatPaise(parsed.amountPaise) : "No fixed amount"}</dd>
    `;
  } else {
    summary.hidden = true;
  }

  if (verified.status === VerificationStatus.MATCH_NEEDS_CONFIRMATION) {
    resultContainer.className = "result match";
    resultContainer.innerHTML = `<strong>AMOUNTS MATCH</strong><p>${verified.message}</p>`;
    if (proceedBtn) proceedBtn.hidden = false;
    announceState(verified.message, { soundCue: "success" });
  } else if (verified.status === VerificationStatus.QR_AMOUNT_MISSING) {
    resultContainer.className = "result warning";
    resultContainer.innerHTML = `<strong>UNVERIFIED AMOUNT</strong><p>${verified.message}</p>`;
    if (proceedBtn) proceedBtn.hidden = false;
    announceState(verified.message, { soundCue: "alert" });
  } else {
    // Mismatch or unusable QR: strictly blocked!
    resultContainer.className = "result mismatch";
    resultContainer.innerHTML = `<strong>PAYMENT BLOCKED</strong><p>${verified.message}</p>`;
    if (proceedBtn) proceedBtn.hidden = true;
    announceState(verified.message, { assertive: true, soundCue: "alert" });
  }

  navigateTo("verification");
}

// Global Touch Gestures for Blind Navigation (2-finger tap = repeat)
function initGlobalGestures() {
  let touchCount = 0;
  window.addEventListener("touchstart", (e) => {
    touchCount = e.touches.length;
    if (touchCount === 2) {
      e.preventDefault();
      speech.repeatLast();
    }
  }, { passive: false });
}

// Event Bindings
document.addEventListener("DOMContentLoaded", () => {
  initGlobalGestures();

  // App Voice Toggle
  const voiceToggle = $("voice-toggle");
  voiceToggle?.addEventListener("click", () => {
    const isEnabled = voiceToggle.getAttribute("aria-pressed") === "true";
    const nextState = !isEnabled;
    voiceToggle.setAttribute("aria-pressed", String(nextState));
    voiceToggle.textContent = nextState ? "Turn off app voice" : "Turn on app voice";
    speech.setAppVoice(nextState);

    if (nextState) {
      announceState("App voice enabled. Speech will read all screens automatically.", { soundCue: "step" });
    } else {
      announceState("App voice turned off. TalkBack handles screen reading.", { soundCue: "step" });
    }
  });

  // Voice Command Button (Direct audio recording to Gemini STT)
  const voiceCmdBtn = $("voice-cmd-btn");
  voiceCmdBtn?.addEventListener("click", () => {
    sound.playStep();
    speech.recordAudioCommand({
      onStart: () => {
        voiceCmdBtn.textContent = "🔴 Listening... Speak now";
        announceState("Listening for command. Speak now.", { soundCue: "step" });
      },
      onTranscript: (res) => {
        voiceCmdBtn.textContent = "🎙 Speak Command";
        if (res.text) {
          announceState(`Heard: "${res.text}"`, { soundCue: "detected" });
        }
        if (res.amount_rupees && $("intended-amount")) {
          $("intended-amount").value = res.amount_rupees;
        }
      },
      onError: () => {
        voiceCmdBtn.textContent = "🎙 Speak Command";
        announceState("Could not hear command. Please try again or tap the screen.", { soundCue: "alert" });
      }
    });
  });

  // Register command handlers for speech
  speech.registerActions({
    onStart: () => $("start-button")?.click(),
    onConfirm: () => {
      const active = document.querySelector(".page.active")?.id;
      if (active === "welcome") $("start-button")?.click();
      else if (active === "product-review") $("product-form")?.requestSubmit();
      else if (active === "verification") $("payment-consent-button")?.click();
      else if (active === "payment-consent") $("upi-link")?.click();
    },
    onCancel: () => {
      flow.cancel();
      stopActiveCamera();
      announceState(SpokenMessages.M21_CANCELLED, { soundCue: "alert" });
      navigateTo("welcome");
    },
    onRepeat: () => speech.repeatLast()
  });

  // Step 1: Start Button
  $("start-button")?.addEventListener("click", () => {
    flow.start();
    navigateTo("product-scan", SpokenMessages.M04_CAPTURE_GUIDANCE);
  });

  // Direct QR Button (Skip product)
  $("direct-qr-button")?.addEventListener("click", () => {
    flow.start();
    flow.skipLabelCapture();
    navigateTo("product-review", "Enter the amount you intend to pay before scanning.");
  });

  // Step 2: Product Capture manual override
  $("manual-capture-btn")?.addEventListener("click", () => triggerProductCapture());

  // Step 2: Product Image File Upload
  const fileInput = $("product-file-input");
  const uploadLabel = fileInput?.closest("label");

  const cancelAutoOnUpload = () => {
    if (autoCaptureTimeout) {
      clearTimeout(autoCaptureTimeout);
      autoCaptureTimeout = null;
    }
    stopActiveCamera();
    const statusEl = $("product-scan-status");
    if (statusEl) statusEl.textContent = "Camera paused. Select your label image...";
  };

  uploadLabel?.addEventListener("click", cancelAutoOnUpload);
  fileInput?.addEventListener("click", cancelAutoOnUpload);

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processLabelFile(file);
    }
  });

  // Step 3: Confirm Intended Amount
  $("product-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const paise = parseRupeesToPaise($("intended-amount").value);
    if (!Number.isInteger(paise) || paise <= 0) {
      announceState("Please enter a valid positive amount in rupees.", { assertive: true, soundCue: "alert" });
      $("intended-amount")?.focus();
      return;
    }

    try {
      flow.setIntendedAmount(paise);
      const formatted = formatPaise(paise);
      announceState(SpokenMessages.M09_INTENDED_READBACK(formatted), { soundCue: "step" });
      navigateTo("qr-scan", SpokenMessages.M10_QR_GUIDANCE);
    } catch (err) {
      announceState(err.message, { assertive: true, soundCue: "alert" });
    }
  });

  // Manual QR input fallback button
  $("verify-button")?.addEventListener("click", () => runVerification());

  // Step 5: Verification Proceed
  $("payment-consent-button")?.addEventListener("click", () => {
    navigateTo("payment-consent");
    if (latestQr) {
      const amountStr = Number.isInteger(latestQr.amountPaise) ? formatPaise(latestQr.amountPaise) : "unverified";
      const summaryMsg = SpokenMessages.M16_PAYEE_READBACK(latestQr.payeeVpa, latestQr.payeeName, amountStr);
      $("payee-summary").textContent = summaryMsg;
      announceState(summaryMsg, { soundCue: "step" });
    }
  });

  // Step 6: Payment Consent Handoff
  $("upi-link")?.addEventListener("click", () => {
    flow.confirm();
    if (!flow.canOfferHandoff()) {
      announceState("Handoff blocked. Please verify amount again.", { assertive: true, soundCue: "alert" });
      return;
    }

    try {
      flow.handoffOpened();
      announceState(SpokenMessages.M23_OPENING_UPI, { soundCue: "success" });
      
      const raw = flow.ctx.confirmedQrRaw;
      if (raw && raw.toLowerCase().startsWith("upi://pay?")) {
        window.location.href = raw;
      }

      setTimeout(() => {
        navigateTo("outcome-report", SpokenMessages.M25_ASK_OUTCOME);
      }, 1200);
    } catch (err) {
      announceState(SpokenMessages.M24_UPI_NOT_OPENED, { assertive: true, soundCue: "alert" });
    }
  });

  // Outcome Reporting
  document.querySelectorAll("[data-outcome]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const outcome = btn.dataset.outcome;
      flow.reportOutcome(outcome);
      if (outcome === "paid") {
        announceState(SpokenMessages.M26_REPORTED_PAID, { soundCue: "success" });
      } else {
        announceState(SpokenMessages.M27_REPORTED_STATUS(outcome), { soundCue: "step" });
      }
      setTimeout(() => {
        flow.reset();
        navigateTo("welcome", SpokenMessages.M01_WELCOME);
      }, 2500);
    });
  });

  // Universal Repeat & Cancel
  document.querySelectorAll(".btn-repeat").forEach((b) => {
    b.addEventListener("click", () => speech.repeatLast());
  });

  document.querySelectorAll(".btn-cancel").forEach((b) => {
    b.addEventListener("click", () => {
      flow.cancel();
      stopActiveCamera();
      announceState(SpokenMessages.M21_CANCELLED, { soundCue: "alert" });
      navigateTo("welcome");
    });
  });

  // Generic navigation hooks
  document.querySelectorAll("[data-next]").forEach((b) => {
    b.addEventListener("click", () => navigateTo(b.dataset.next));
  });

  // Safe teardown
  window.addEventListener("beforeunload", () => {
    stopActiveCamera();
  });
});
