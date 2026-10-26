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
let zxingControls = null;
let zxingReader = null;

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
    // Automatically focus the intended amount input
    setTimeout(() => $("intended-amount")?.focus(), 400);
  }
}

// Stop any camera stream and clear timers
function stopActiveCamera() {
  if (zxingControls) {
    try { zxingControls.stop(); } catch {}
    zxingControls = null;
  }
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

let isProcessingLabel = false;

// Process any label file (camera snapshot or uploaded image)
async function processLabelFile(file) {
  if (isProcessingLabel) return;
  isProcessingLabel = true;

  if (autoCaptureTimeout) {
    clearTimeout(autoCaptureTimeout);
    autoCaptureTimeout = null;
  }
  stopActiveCamera();
  const statusEl = $("product-scan-status");
  sound.playDetected();
  if (statusEl) statusEl.textContent = "Analyzing label image with AI...";
  announceState("Analyzing label image. Reading printed price now...", { soundCue: "detected" });

  try {
    const data = await readProductLabel(file);
    console.log("DrishtiPay label response:", data);

    const getField = (f) => {
      const field = data?.[f];
      if (!field) return "";
      if (field.value !== null && field.value !== undefined) {
        const valStr = String(field.value).trim();
        if (valStr && valStr.toLowerCase() !== "null") return valStr;
      }
      if (field.supporting_text !== null && field.supporting_text !== undefined) {
        const supStr = String(field.supporting_text).trim();
        if (supStr && supStr.toLowerCase() !== "null") return supStr;
      }
      return "";
    };

    const rawMrpText = getField("printed_mrp");
    const cleanMrp = cleanPriceString(rawMrpText);
    const prodName = getField("product_name") || "Package";
    const expDate = getField("expiry_date") || "Not visible";

    stopActiveCamera();

    const readoutMsg = cleanMrp
      ? `Found printed MRP of ${cleanMrp} rupees for ${prodName}. Tap top of screen to confirm, or enter your agreed amount.`
      : `Read product ${prodName}, but could not confirm a printed MRP. Enter the amount you intend to pay.`;

    await navigateTo("product-review", readoutMsg);

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
    if (statusEl) {
      statusEl.textContent = `Could not read label: ${err.message}.`;
    }
    announceState(`Could not read label automatically: ${err.message}. Enter your intended payment amount.`, { soundCue: "alert" });
    await navigateTo("product-review", "Could not read label automatically. Enter your intended payment amount.");
  } finally {
    isProcessingLabel = false;
    const fi = $("product-file-input");
    if (fi) fi.value = "";
  }
}

// Capture photo from video stream
function triggerProductCapture() {
  if (isProcessingLabel) return;
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

// Step 4: Auto-Starting Merchant QR Scanner with ZXing
async function autoStartQrCamera() {
  const video = $("qr-camera");
  const statusEl = $("qr-scan-status");
  if (statusEl) statusEl.textContent = "Camera live. Aiming for shop's UPI QR...";

  try {
    // 1. Primary: Use ZXing Browser for universal cross-platform camera QR scanning
    if (window.ZXingBrowser && window.ZXingBrowser.BrowserQRCodeReader) {
      if (!zxingReader) {
        zxingReader = new window.ZXingBrowser.BrowserQRCodeReader();
      }
      sound.playStep();
      announceState(SpokenMessages.M10_QR_GUIDANCE, { soundCue: "step" });

      try {
        let found = false;
        zxingControls = await zxingReader.decodeFromVideoDevice(undefined, video, (result) => {
          if (result && !found) {
            found = true;
            const raw = result.getText().trim();
            stopActiveCamera();
            if ($("qr-text")) $("qr-text").value = raw;
            sound.playDetected();
            runVerification(raw);
          }
        });
        return;
      } catch (zxErr) {
        console.warn("ZXing device scan error, falling back to manual getUserMedia:", zxErr);
      }
    }

    // 2. Fallback: getUserMedia stream with BarcodeDetector
    const stream = await navigator.mediaDevices?.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false
    });
    if (!stream) throw new Error("No camera stream");

    activeStream = stream;
    video.srcObject = stream;
    sound.playStep();
    announceState(SpokenMessages.M10_QR_GUIDANCE, { soundCue: "step" });

    if ("BarcodeDetector" in window) {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      scanTimer = setInterval(async () => {
        try {
          if (video.readyState < 2) return;
          const codes = await detector.detect(video);
          if (codes.length > 0 && codes[0].rawValue) {
            const raw = codes[0].rawValue.trim();
            stopActiveCamera();
            if ($("qr-text")) $("qr-text").value = raw;
            sound.playDetected();
            runVerification(raw);
          }
        } catch {}
      }, 400);
    } else {
      if (statusEl) statusEl.textContent = "Point camera at merchant QR code, or paste the UPI link below.";
    }
  } catch (err) {
    console.error("QR Camera access:", err);
    if (statusEl) statusEl.textContent = "Camera unavailable. Paste UPI payment link below.";
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

  const intended = parseRupeesToPaise($("intended-amount")?.value);
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

  const resultContainer = $("result");
  const summary = $("qr-summary");
  const proceedBtn = $("payment-consent-button");

  if (!parsed.isValid) {
    if (summary) summary.hidden = true;
    if (resultContainer) {
      resultContainer.className = "result mismatch";
      resultContainer.innerHTML = `<strong>UNSUPPORTED QR</strong><p>${parsed.error}</p>`;
    }
    if (proceedBtn) proceedBtn.hidden = true;
    announceState(`Unsupported QR: ${parsed.error}. Payment handoff is blocked.`, { assertive: true, soundCue: "alert" });
    navigateTo("verification");
    return;
  }

  const verified = verifyAmounts(intended, parsed);
  flow.verificationReceived(verified);

  const payeeNameStr = parsed.payeeName || "Name not provided in QR";
  const qrAmountStr = Number.isInteger(parsed.amountPaise) ? formatPaise(parsed.amountPaise) : "No fixed amount";
  const qrReadout = `Payee: ${payeeNameStr}. UPI ID: ${parsed.payeeVpa}. QR amount: ${qrAmountStr}.`;

  if (summary) {
    summary.hidden = false;
    summary.innerHTML = `
      <dt>Payee</dt><dd>${payeeNameStr}</dd>
      <dt>UPI ID</dt><dd>${parsed.payeeVpa}</dd>
      <dt>QR Amount</dt><dd>${qrAmountStr}</dd>
      <dt>Intended Amount</dt><dd>${formatPaise(intended)}</dd>
    `;
  }

  if (verified.status === VerificationStatus.MATCH_NEEDS_CONFIRMATION) {
    resultContainer.className = "result match";
    resultContainer.innerHTML = `<strong>AMOUNTS MATCH</strong><p>${verified.message}</p><p class="hint">1 explicit confirmation required before opening UPI app.</p>`;
    if (proceedBtn) {
      proceedBtn.hidden = false;
      const t = proceedBtn.querySelector(".zone-title");
      const s = proceedBtn.querySelector(".zone-sub");
      if (t) t.textContent = "CONFIRM (1 OF 1)";
      if (s) s.textContent = "Tap top half to review and proceed";
    }
    announceState(`${qrReadout} ${verified.message}. Tap top half to confirm.`, { soundCue: "success" });
  } else if (verified.status === VerificationStatus.QR_AMOUNT_MISSING) {
    resultContainer.className = "result warning";
    resultContainer.innerHTML = `<strong>UNVERIFIED QR AMOUNT</strong><p>${verified.message}</p><p class="hint">Two explicit confirmations required before handoff.</p>`;
    if (proceedBtn) {
      proceedBtn.hidden = false;
      const t = proceedBtn.querySelector(".zone-title");
      const s = proceedBtn.querySelector(".zone-sub");
      if (t) t.textContent = "CONFIRM (1 OF 2)";
      if (s) s.textContent = "Tap top half to confirm you will check amount in UPI app";
    }
    announceState(`${qrReadout} WARNING: This QR has no fixed amount. You must check the amount in your UPI app. Two confirmations required.`, { soundCue: "alert" });
  } else {
    // MISMATCH_BLOCKED
    resultContainer.className = "result mismatch";
    resultContainer.innerHTML = `<strong>PAYMENT BLOCKED - AMOUNT MISMATCH</strong><p>${verified.message}</p><p class="hint">Payment handoff is blocked. Scan again or ask the shopkeeper.</p>`;
    if (proceedBtn) proceedBtn.hidden = true;
    announceState(`${qrReadout} ${verified.message}`, { assertive: true, soundCue: "alert" });
  }

  navigateTo("verification");
}

// Global Touch Gestures for Blind Navigation (2-finger tap = repeat)
function initGlobalGestures() {
  window.addEventListener("touchstart", (e) => {
    if (e.touches.length === 2) {
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

  // Voice Command Button (Native Web Speech with toggle state & graceful fallback)
  const voiceCmdBtn = $("voice-cmd-btn");
  voiceCmdBtn?.addEventListener("click", () => {
    sound.playStep();

    // If currently listening, stop it cleanly
    if (speech.isListening) {
      speech.stopListening();
      voiceCmdBtn.textContent = "🎙 Speak Command";
      voiceCmdBtn.setAttribute("aria-pressed", "false");
      announceState("Voice listening stopped.", { soundCue: "step" });
      return;
    }

    const started = speech.startListening({
      onStart: () => {
        voiceCmdBtn.textContent = "🔴 Listening... Speak now";
        voiceCmdBtn.setAttribute("aria-pressed", "true");
        announceState("Listening for command. Say Start, Confirm, or an amount.", { soundCue: "step" });
      },
      onResult: (transcript) => {
        voiceCmdBtn.textContent = "🎙 Speak Command";
        voiceCmdBtn.setAttribute("aria-pressed", "false");
        announceState(`Heard: "${transcript}"`, { soundCue: "detected" });
      },
      onError: (errInfo) => {
        voiceCmdBtn.textContent = "🎙 Speak Command";
        voiceCmdBtn.setAttribute("aria-pressed", "false");
        announceState(errInfo.message || "Could not hear command. Please try again or tap buttons.", { soundCue: "alert" });
      },
      onEnd: () => {
        voiceCmdBtn.textContent = "🎙 Speak Command";
        voiceCmdBtn.setAttribute("aria-pressed", "false");
      }
    });

    // If native speech recognition is not supported in this browser, fallback to audio recording
    if (!started) {
      console.warn("Native SpeechRecognition unavailable, trying media recording fallback...");
      speech.recordAudioCommand({
        onStart: () => {
          voiceCmdBtn.textContent = "🔴 Recording... Speak now";
          voiceCmdBtn.setAttribute("aria-pressed", "true");
          announceState("Recording command. Speak now.", { soundCue: "step" });
        },
        onTranscript: (res) => {
          voiceCmdBtn.textContent = "🎙 Speak Command";
          voiceCmdBtn.setAttribute("aria-pressed", "false");
          if (res.text) announceState(`Heard: "${res.text}"`, { soundCue: "detected" });
          if (res.amount_rupees && $("intended-amount")) {
            $("intended-amount").value = res.amount_rupees;
          }
        },
        onError: () => {
          voiceCmdBtn.textContent = "🎙 Speak Command";
          voiceCmdBtn.setAttribute("aria-pressed", "false");
          announceState("Could not hear command. Tap the screen to continue.", { soundCue: "alert" });
        }
      });
    }
  });

  // Register command handlers for speech
  speech.registerActions({
    onStart: () => $("start-button")?.click(),
    onDirectQr: () => $("direct-qr-button")?.click(),
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
    onRepeat: () => speech.repeatLast(),
    onAmount: (rupees) => {
      const intendedInput = $("intended-amount");
      if (intendedInput) {
        intendedInput.value = rupees;
        announceState(`Amount set to ${rupees} rupees. Tap Confirm or say Confirm to proceed.`, { soundCue: "detected" });
      }
    }
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
  const uploadLabel = document.querySelector('label[for="product-file-input"]');

  const cancelAutoOnUpload = () => {
    if (autoCaptureTimeout) {
      clearTimeout(autoCaptureTimeout);
      autoCaptureTimeout = null;
    }
    stopActiveCamera();
    const statusEl = $("product-scan-status");
    if (statusEl) statusEl.textContent = "Camera paused. Select your label photo...";
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

  // Demo QR Buttons
  $("demo-qr-btn")?.addEventListener("click", () => {
    const demo = "upi://pay?pa=demo.merchant@upi&pn=Demo%20Merchant&am=35.00&cu=INR";
    if ($("qr-text")) $("qr-text").value = demo;
    runVerification(demo);
  });

  $("demo-noamt-qr-btn")?.addEventListener("click", () => {
    const demo = "upi://pay?pa=demo.merchant@upi&pn=Demo%20Merchant&cu=INR";
    if ($("qr-text")) $("qr-text").value = demo;
    runVerification(demo);
  });

  // Step 5: Verification Proceed (Enforces 1 or 2 confirmations based on rules)
  $("payment-consent-button")?.addEventListener("click", () => {
    const verified = flow.ctx.verified;
    if (!verified || verified.status === VerificationStatus.MISMATCH_BLOCKED) {
      announceState("Payment handoff is blocked because the amounts do not match.", { assertive: true, soundCue: "alert" });
      return;
    }

    const confirmed = flow.confirm();

    if (verified.status === VerificationStatus.QR_AMOUNT_MISSING) {
      if (!confirmed) {
        // First of 2 confirmations done!
        const btn = $("payment-consent-button");
        if (btn) {
          const t = btn.querySelector(".zone-title");
          const s = btn.querySelector(".zone-sub");
          if (t) t.textContent = "CONFIRM AGAIN (2 OF 2)";
          if (s) s.textContent = "Tap again to confirm you will verify amount in UPI app";
        }
        announceState("First confirmation recorded. WARNING: This QR has no fixed amount. You must check the amount in your UPI app before authorising anything. Confirm again to proceed.", { assertive: true, soundCue: "alert" });
        return;
      }
    }

    // Guard passed! Proceed to handoff screen
    if (flow.canOfferHandoff()) {
      navigateTo("payment-consent");
      if (latestQr) {
        const amountStr = Number.isInteger(latestQr.amountPaise) ? formatPaise(latestQr.amountPaise) : "unverified / no fixed amount";
        const summaryMsg = SpokenMessages.M16_PAYEE_READBACK(latestQr.payeeVpa, latestQr.payeeName, amountStr);
        $("payee-summary").textContent = summaryMsg;
        announceState(summaryMsg, { soundCue: "step" });
      }
    }
  });

  // Step 6: Payment Consent Handoff (Only opens after guard passes!)
  $("upi-link")?.addEventListener("click", () => {
    if (!flow.canOfferHandoff()) {
      announceState("Payment handoff blocked. Required confirmations must pass before opening UPI.", { assertive: true, soundCue: "alert" });
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