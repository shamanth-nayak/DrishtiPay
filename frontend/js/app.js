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
    "shopping-list",
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

  // Progress Bar (6 primary user stages)
  const stepIndex = pages.indexOf(targetPageId) + 1;
  const progressLabel = $("progress-label");
  const progressBar = $("progress-bar");
  if (progressLabel && progressBar) {
    progressLabel.textContent = `Step ${Math.min(stepIndex, 6)} of 6`;
    progressBar.style.width = `${Math.min(stepIndex * 16.66, 100)}%`;
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
  const mainShell = $("main-content");
  if (targetPageId === "shopping-list") {
    if (mainShell) mainShell.classList.add("shopping-list-active");
    renderShoppingList();
    setTimeout(() => $("shopping-list-title")?.focus(), 300);
  } else {
    if (mainShell) mainShell.classList.remove("shopping-list-active");
  }

  if (targetPageId === "product-scan") {
    await autoStartProductCamera();
  } else if (targetPageId === "qr-scan") {
    await autoStartQrCamera();
  } else if (targetPageId === "product-review") {
    setTimeout(() => $("btn-add-another")?.focus(), 400);
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

// Camera Stream Helper with mobile fallback constraints
async function requestMobileCameraStream() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error("SECURE_CONTEXT_REQUIRED");
  }
  const constraintsList = [
    { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: { facingMode: "environment" }, audio: false },
    { video: true, audio: false }
  ];

  let lastErr = null;
  for (const c of constraintsList) {
    try {
      const s = await navigator.mediaDevices.getUserMedia(c);
      if (s) return s;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error("Camera could not be opened");
}

// Step 2: Auto-Starting Product Label Camera
async function autoStartProductCamera() {
  const video = $("product-camera");
  const statusEl = $("product-scan-status");

  if (video) {
    video.muted = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const originUrl = window.location.origin;
    if (statusEl) {
      statusEl.innerHTML = "<strong>Live Camera Blocked on Mobile (HTTP)</strong><br>Chrome requires enabling: <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> and adding: <code>" + originUrl + "</code>";
    }
    announceState("Live camera requires enabling the Chrome insecure origins flag for " + originUrl + ", or using HTTPS.", { assertive: true, soundCue: "alert" });
    return;
  }

  if (statusEl) statusEl.textContent = "Live camera active. Hold product label steady...";

  try {
    const stream = await requestMobileCameraStream();
    activeStream = stream;
    video.srcObject = stream;
    try { await video.play(); } catch {}
    sound.playStep();

    announceState("Live camera is looking for product label. Hold steady.", { soundCue: "step" });

    autoCaptureTimeout = setTimeout(() => {
      triggerProductCapture();
    }, 4500);
  } catch (err) {
    console.error("Camera access error:", err);
    if (err.message === "SECURE_CONTEXT_REQUIRED") {
      const originUrl = window.location.origin;
      if (statusEl) {
        statusEl.innerHTML = "<strong>Live Camera Blocked on Mobile (HTTP)</strong><br>Enable <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> and add <code>" + originUrl + "</code>";
      }
      announceState("Live camera blocked. Enable Chrome flag or run over HTTPS.", { assertive: true, soundCue: "alert" });
    } else {
      if (statusEl) statusEl.textContent = "Camera access error (" + err.message + "). Check permissions.";
      announceState("Camera permission denied or camera unavailable. Check phone permissions.", { assertive: true, soundCue: "alert" });
    }
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
    const brandName = getField("brand") || "";
    const expDate = getField("expiry_date") || "Not visible";

    stopActiveCamera();

    const priceDetectedCard = $("detected-price-card");
    const missingPriceCard = $("missing-price-card");
    const priceValueEl = $("detected-price-value");

    const detailProdName = $("detail-product-name");
    const detailBrand = $("detail-brand-name");
    const detailMrp = $("detail-printed-mrp");
    const detailExp = $("detail-expiry-date");

    if (detailProdName) detailProdName.textContent = prodName;
    if (detailBrand) detailBrand.textContent = brandName || "Not visible";
    if (detailMrp) detailMrp.textContent = cleanMrp ? `₹${cleanMrp}` : (rawMrpText || "Not visible");
    if (detailExp) detailExp.textContent = expDate;

    // Prefill unit price input and reset quantity
    const priceInputEl = $("review-unit-price");
    if (priceInputEl) {
      priceInputEl.value = cleanMrp || "";
    }
    const qtyInputEl = $("review-quantity");
    if (qtyInputEl) {
      qtyInputEl.value = "1";
    }

    const intendedInput = $("intended-amount");
    if (intendedInput) {
      intendedInput.value = cleanMrp || "";
    }

    // Initialize new review session token to prevent accidental duplicate additions
    currentReviewSessionId = `session-${Date.now()}`;
    currentReviewSessionAdded = false;

    // View shopping list button state
    const viewListBtn = $("btn-view-shopping-list");
    const viewListSub = $("view-shopping-list-sub");
    if (viewListBtn) {
      const cartCount = flow.ctx.shoppingList.length;
      viewListBtn.hidden = cartCount === 0;
      if (viewListSub) {
        viewListSub.textContent = `${cartCount} item${cartCount === 1 ? "" : "s"} in shopping list (Total ${formatPaise(flow.getShoppingTotalPaise())})`;
      }
    }

    let readoutMsg = "";
    if (cleanMrp) {
      if (priceDetectedCard) priceDetectedCard.hidden = false;
      if (missingPriceCard) missingPriceCard.hidden = true;
      if (priceValueEl) priceValueEl.textContent = `₹${cleanMrp}`;
      readoutMsg = `Warning: Detected printed MRP of ${cleanMrp} rupees for ${prodName}. Review details, then tap Add Another Product or Continue to Payment Verification.`;
    } else {
      if (priceDetectedCard) priceDetectedCard.hidden = true;
      if (missingPriceCard) missingPriceCard.hidden = false;
      readoutMsg = `Warning: Read product ${prodName}, but could not find a printed price on this label. Please enter the price below, or tap Re-Scan.`;
    }

    const leadEl = $("product-readout-lead");
    if (leadEl) leadEl.textContent = readoutMsg;

    await navigateTo("product-review", readoutMsg);

  } catch (err) {
    console.warn("OCR read error:", err);
    stopActiveCamera();
    const priceDetectedCard = $("detected-price-card");
    const missingPriceCard = $("missing-price-card");
    const detailProdName = $("detail-product-name");
    const detailBrand = $("detail-brand-name");
    const detailMrp = $("detail-printed-mrp");
    const priceInputEl = $("review-unit-price");

    if (priceDetectedCard) priceDetectedCard.hidden = true;
    if (missingPriceCard) {
      missingPriceCard.hidden = false;
      const desc = missingPriceCard.querySelector(".alert-desc");
      if (desc) desc.textContent = `Label scan unavailable: ${err.message}. Please enter the price manually below.`;
    }
    if (detailProdName) detailProdName.textContent = "Package";
    if (detailBrand) detailBrand.textContent = "Not visible";
    if (detailMrp) detailMrp.textContent = "Not visible";
    if (priceInputEl) {
      priceInputEl.value = "";
      setTimeout(() => priceInputEl.focus(), 300);
    }

    currentReviewSessionId = `session-${Date.now()}`;
    currentReviewSessionAdded = false;

    if (statusEl) {
      statusEl.textContent = `Could not read label: ${err.message}.`;
    }
    announceState(`Could not read label automatically: ${err.message}. Please enter the item price manually.`, { soundCue: "alert" });
    await navigateTo("product-review", "Could not read label automatically. Please enter the price manually below.");
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

// Step 4: Auto-Starting Merchant QR Scanner with ZXing (Live Video Stream)
async function autoStartQrCamera() {
  const video = $("qr-camera");
  const statusEl = $("qr-scan-status");

  if (video) {
    video.muted = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("webkit-playsinline", "true");
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    const originUrl = window.location.origin;
    if (statusEl) {
      statusEl.innerHTML = "<strong>Live Camera Blocked on Mobile (HTTP)</strong><br>Chrome requires enabling: <code>chrome://flags/#unsafely-treat-insecure-origin-as-secure</code> and adding: <code>" + originUrl + "</code>";
    }
    announceState("Live QR scanner requires enabling the Chrome insecure origins flag for " + originUrl + ", or using HTTPS.", { assertive: true, soundCue: "alert" });
    return;
  }

  if (statusEl) statusEl.textContent = "Live camera scanning... Aim at payment QR.";

  try {
    // 1. Primary: Use ZXing Browser decodeFromConstraints on live video element
    if (window.ZXingBrowser && window.ZXingBrowser.BrowserQRCodeReader) {
      if (!zxingReader) {
        zxingReader = new window.ZXingBrowser.BrowserQRCodeReader();
      }
      sound.playStep();
      announceState(SpokenMessages.M10_QR_GUIDANCE, { soundCue: "step" });

      try {
        let found = false;
        zxingControls = await zxingReader.decodeFromConstraints({
          audio: false,
          video: { facingMode: { ideal: "environment" } }
        }, video, (result) => {
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
        console.warn("ZXing decodeFromConstraints error, trying manual stream fallback:", zxErr);
      }
    }

    // 2. Fallback: Direct getUserMedia stream with BarcodeDetector or ZXing decodeFromVideoElement
    const stream = await requestMobileCameraStream();
    activeStream = stream;
    video.srcObject = stream;
    try { await video.play(); } catch {}
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
      }, 300);
    } else if (window.ZXingBrowser && zxingReader) {
      scanTimer = setInterval(async () => {
        try {
          if (video.readyState < 2) return;
          const result = await zxingReader.decodeFromVideoElement(video);
          if (result) {
            const raw = result.getText().trim();
            stopActiveCamera();
            if ($("qr-text")) $("qr-text").value = raw;
            sound.playDetected();
            runVerification(raw);
          }
        } catch {}
      }, 350);
    } else {
      if (statusEl) statusEl.textContent = "Point live camera at merchant QR code, or paste UPI link below.";
    }
  } catch (err) {
    console.error("QR Camera access error:", err);
    if (statusEl) statusEl.textContent = "Live QR camera unavailable. Paste UPI payment link below.";
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

  const intended = flow.ctx.intendedPaise || parseRupeesToPaise($("intended-amount")?.value);
  if (!Number.isInteger(intended) || intended <= 0) {
    announceState(SpokenMessages.M36_EMPTY_LIST_WARNING, { assertive: true, soundCue: "alert" });
    navigateTo("shopping-list");
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
  const qrReadout = `Payee: ${payeeNameStr}. UPI ID: ${parsed.payeeVpa}. QR amount: ${qrAmountStr}. Total shopping amount: ${formatPaise(intended)}.`;

  if (summary) {
    summary.hidden = false;
    summary.innerHTML = `
      <dt>Payee</dt><dd>${payeeNameStr}</dd>
      <dt>UPI ID</dt><dd>${parsed.payeeVpa}</dd>
      <dt>QR Amount</dt><dd>${qrAmountStr}</dd>
      <dt>Total Shopping Amount</dt><dd>${formatPaise(intended)}</dd>
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

// Shopping List and Review Session State
let isAddingProduct = false;
let currentReviewSessionId = null;
let currentReviewSessionAdded = false;
let isClearConfirming = false;
let clearConfirmTimer = null;

async function handleSaveCurrentProduct(destination = "summary") {
  if (isAddingProduct) return;
  isAddingProduct = true;

  try {
    // Prevent accidental duplicate additions caused by double-taps or rapid handlers
    if (currentReviewSessionAdded) {
      if (destination === "scan") {
        flow.scanAnotherProduct();
        await navigateTo("product-scan", SpokenMessages.M04_CAPTURE_GUIDANCE);
      } else {
        renderShoppingList();
        await navigateTo("shopping-list");
      }
      return;
    }

    const priceInput = $("review-unit-price")?.value?.trim();
    const unitPricePaise = parseRupeesToPaise(priceInput);

    if (!Number.isInteger(unitPricePaise) || unitPricePaise <= 0) {
      announceState(SpokenMessages.M35_MISSING_PRICE_WARNING, { assertive: true, soundCue: "alert" });
      $("review-unit-price")?.focus();
      return;
    }

    const qtyInput = parseInt($("review-quantity")?.value, 10);
    const qty = Number.isInteger(qtyInput) && qtyInput > 0 ? qtyInput : 1;
    const prodName = $("detail-product-name")?.textContent?.trim() || "Product";
    const brandEl = $("detail-brand-name");
    const brandText = (brandEl && brandEl.textContent !== "Not visible") ? brandEl.textContent.trim() : "";

    const added = flow.addShoppingItem({
      productName: prodName,
      brand: brandText,
      detectedMrp: priceInput,
      unitPricePaise,
      quantity: qty
    });

    currentReviewSessionAdded = true;
    const subtotalFormatted = formatPaise(added.subtotalPaise);
    const totalFormatted = formatPaise(flow.getShoppingTotalPaise());

    if (destination === "scan") {
      announceState(SpokenMessages.M30_PRODUCT_ADDED(prodName, qty, subtotalFormatted, totalFormatted) + " Ready for next product.", { soundCue: "success" });
      currentReviewSessionId = null;
      currentReviewSessionAdded = false;
      flow.scanAnotherProduct();
      await navigateTo("product-scan", SpokenMessages.M04_CAPTURE_GUIDANCE);
    } else {
      announceState(SpokenMessages.M30_PRODUCT_ADDED(prodName, qty, subtotalFormatted, totalFormatted), { soundCue: "success" });
      renderShoppingList();
      await navigateTo("shopping-list");
    }
  } finally {
    setTimeout(() => {
      isAddingProduct = false;
    }, 400);
  }
}

function renderShoppingList() {
  const tbody = $("shopping-list-tbody");
  const emptyNotice = $("empty-list-notice");
  const totalDisplay = $("shopping-total-display");
  const proceedBtn = $("summary-proceed-pay-btn");

  const items = flow.ctx.shoppingList;
  const totalPaise = flow.getShoppingTotalPaise();
  const totalFormatted = formatPaise(totalPaise);

  if (totalDisplay) totalDisplay.textContent = totalFormatted;

  if (tbody) {
    tbody.innerHTML = "";
    if (items.length === 0) {
      if (emptyNotice) emptyNotice.hidden = false;
      if (proceedBtn) {
        proceedBtn.setAttribute("disabled", "true");
        proceedBtn.style.opacity = "0.5";
        proceedBtn.style.cursor = "not-allowed";
        proceedBtn.textContent = "Continue to Pay";
      }
      return;
    }

    if (emptyNotice) emptyNotice.hidden = true;
    if (proceedBtn) {
      proceedBtn.removeAttribute("disabled");
      proceedBtn.style.opacity = "1";
      proceedBtn.style.cursor = "pointer";
      proceedBtn.textContent = "Continue to Pay";
    }

    items.forEach((item, index) => {
      const tr = document.createElement("tr");
      const brandHtml = item.brand ? `<span class="sl-brand">(${item.brand})</span>` : "";
      tr.innerHTML = `
        <td class="sl-col-name">
          <span class="sl-item-index">${index + 1}.</span>
          <span class="sl-item-name">${item.productName} ${brandHtml}</span>
        </td>
        <td class="sl-col-qty">${item.quantity}</td>
        <td class="sl-col-price">
          <span class="sl-price-val">${formatPaise(item.subtotalPaise)}</span>
          <button class="sl-remove-btn" type="button" data-id="${item.id}" aria-label="Remove ${item.productName} from list">✕</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".sl-remove-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        const removed = flow.removeShoppingItem(id);
        if (removed) {
          const newTotalFormatted = formatPaise(flow.getShoppingTotalPaise());
          announceState(SpokenMessages.M31_PRODUCT_REMOVED(removed.productName, newTotalFormatted), { soundCue: "step" });
          renderShoppingList();
        }
      });
    });
  }
}

function setupClearListButton() {
  const clearBtn = $("summary-clear-list-btn");
  if (!clearBtn) return;
  const clearTitle = $("clear-btn-title");
  const clearSub = $("clear-btn-sub");

  const resetClearButtonState = () => {
    isClearConfirming = false;
    clearTimeout(clearConfirmTimer);
    if (clearBtn) clearBtn.classList.remove("confirm-clear-active");
    if (clearTitle) clearTitle.textContent = "🗑 CLEAR SHOPPING LIST";
    if (clearSub) clearSub.textContent = "Tap to clear all items (requires confirmation)";
  };

  clearBtn?.addEventListener("click", () => {
    if (flow.ctx.shoppingList.length === 0) {
      announceState("Your shopping list is already empty.", { soundCue: "step" });
      return;
    }

    if (!isClearConfirming) {
      isClearConfirming = true;
      if (clearBtn) clearBtn.classList.add("confirm-clear-active");
      if (clearTitle) clearTitle.textContent = "⚠️ CONFIRM CLEAR ALL ITEMS";
      if (clearSub) clearSub.textContent = "Tap again to clear all products from shopping list";

      announceState(SpokenMessages.M37_CONFIRM_CLEAR_LIST, { assertive: true, soundCue: "alert" });

      clearConfirmTimer = setTimeout(resetClearButtonState, 7000);
    } else {
      resetClearButtonState();
      flow.clearShoppingList();
      renderShoppingList();
      announceState(SpokenMessages.M33_LIST_CLEARED, { soundCue: "step" });
    }
  });
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
  setupClearListButton();

  // Continuous Speech Activation on First User Interaction (required by mobile browsers)
  const initSpeechOnGesture = () => {
    speech.startContinuous();
  };
  window.addEventListener("pointerdown", initSpeechOnGesture, { once: true, passive: true });
  window.addEventListener("touchstart", initSpeechOnGesture, { once: true, passive: true });
  window.addEventListener("click", initSpeechOnGesture, { once: true, passive: true });

  // Register command handlers for continuous hands-free speech
  speech.registerActions({
    onStart: () => {
      const active = document.querySelector(".page.active")?.id;
      if (active === "welcome") $("start-button")?.click();
      else if (active === "shopping-list") $("summary-add-another-btn")?.click();
    },
    onDirectQr: () => {
      const active = document.querySelector(".page.active")?.id;
      if (active === "welcome") $("direct-qr-button")?.click();
    },
    onConfirm: () => {
      const active = document.querySelector(".page.active")?.id;
      if (active === "welcome") $("start-button")?.click();
      else if (active === "product-scan") triggerProductCapture();
      else if (active === "product-review") handleSaveCurrentProduct("summary");
      else if (active === "shopping-list") $("summary-proceed-pay-btn")?.click();
      else if (active === "verification") $("payment-consent-button")?.click();
      else if (active === "payment-consent") $("upi-link")?.click();
      else if (active === "outcome-report") navigateTo("welcome", SpokenMessages.M01_WELCOME);
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
      if (intendedInput) intendedInput.value = rupees;
      const reviewPriceInput = $("review-unit-price");
      if (reviewPriceInput) reviewPriceInput.value = rupees;
      const priceDetectedCard = $("detected-price-card");
      const missingPriceCard = $("missing-price-card");
      const priceValueEl = $("detected-price-value");

      if (priceDetectedCard) priceDetectedCard.hidden = false;
      if (missingPriceCard) missingPriceCard.hidden = true;
      if (priceValueEl) priceValueEl.textContent = `₹${rupees}`;
      announceState(`Price set to ${rupees} rupees. Tap Add Another Product or Continue to Payment Verification.`, { soundCue: "detected" });
    }
  });

  // Step 1: Start Button
  $("start-button")?.addEventListener("click", () => {
    speech.startContinuous();
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

  // Step 2: Product Image File Upload (Gallery backup)
  const fileInput = $("product-file-input");
  const uploadLabel = document.querySelector('label[for="product-file-input"]');

  const cancelAutoOnUpload = () => {
    if (autoCaptureTimeout) {
      clearTimeout(autoCaptureTimeout);
      autoCaptureTimeout = null;
    }
    stopActiveCamera();
    const statusEl = $("product-scan-status");
    if (statusEl) statusEl.textContent = "Live camera paused. Select your label photo...";
  };

  uploadLabel?.addEventListener("click", cancelAutoOnUpload);
  fileInput?.addEventListener("click", cancelAutoOnUpload);

  fileInput?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processLabelFile(file);
    }
  });

  // Step 3: Product Review Quantity Adjustments
  $("qty-minus-btn")?.addEventListener("click", () => {
    const qEl = $("review-quantity");
    if (qEl) {
      const cur = Math.max(1, (parseInt(qEl.value, 10) || 1) - 1);
      qEl.value = cur;
    }
  });
  $("qty-plus-btn")?.addEventListener("click", () => {
    const qEl = $("review-quantity");
    if (qEl) {
      const cur = Math.min(99, (parseInt(qEl.value, 10) || 1) + 1);
      qEl.value = cur;
    }
  });

  // Step 3: Product Review Actions
  $("btn-add-another")?.addEventListener("click", () => handleSaveCurrentProduct("scan"));
  $("btn-continue-summary")?.addEventListener("click", () => handleSaveCurrentProduct("summary"));
  $("btn-view-shopping-list")?.addEventListener("click", () => navigateTo("shopping-list"));
  $("btn-rescan-product")?.addEventListener("click", () => {
    flow.scanAnotherProduct();
    navigateTo("product-scan", SpokenMessages.M04_CAPTURE_GUIDANCE);
  });

  // Step 4: Shopping List Summary Actions
  $("summary-proceed-pay-btn")?.addEventListener("click", () => {
    const totalPaise = flow.getShoppingTotalPaise();
    if (!Number.isInteger(totalPaise) || totalPaise <= 0 || flow.ctx.shoppingList.length === 0) {
      announceState(SpokenMessages.M36_EMPTY_LIST_WARNING, { assertive: true, soundCue: "alert" });
      return;
    }

    flow.proceedToPaymentFromShoppingList();
    const formattedTotal = formatPaise(totalPaise);
    if ($("intended-amount")) $("intended-amount").value = (totalPaise / 100).toFixed(2);

    announceState(SpokenMessages.M34_PROCEED_TO_QR_WITH_TOTAL(formattedTotal), { soundCue: "step" });
    navigateTo("qr-scan", SpokenMessages.M10_QR_GUIDANCE);
  });

  $("summary-add-another-btn")?.addEventListener("click", () => {
    flow.scanAnotherProduct();
    navigateTo("product-scan", SpokenMessages.M04_CAPTURE_GUIDANCE);
  });

  $("summary-back-btn")?.addEventListener("click", () => {
    flow.scanAnotherProduct();
    navigateTo("product-scan", SpokenMessages.M04_CAPTURE_GUIDANCE);
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
        // Prepare properly formatted 2-decimal UPI URI (e.g. am=45.00)
        let launchUri = raw;
        try {
          const url = new URL(raw);
          const params = new URLSearchParams(url.search);
          const paise = flow.ctx.intendedPaise;
          if (Number.isInteger(paise) && paise > 0) {
            params.set("am", (paise / 100).toFixed(2));
          } else if (params.has("am")) {
            const p = parseRupeesToPaise(params.get("am"));
            if (Number.isInteger(p)) params.set("am", (p / 100).toFixed(2));
          }
          params.set("cu", "INR");
          if (params.has("pa")) params.set("pa", params.get("pa").trim());
          if (params.has("pn")) params.set("pn", params.get("pn").trim());
          launchUri = `upi://pay?${params.toString()}`;
        } catch {}

        window.location.href = launchUri;
      }

      setTimeout(() => {
        navigateTo("outcome-report", SpokenMessages.M25_ASK_OUTCOME);
      }, 1200);
    } catch (err) {
      announceState(SpokenMessages.M24_UPI_NOT_OPENED, { assertive: true, soundCue: "alert" });
    }
  });

  // Copy UPI ID & Amount button
  $("btn-copy-upi")?.addEventListener("click", () => {
    if (!latestQr) return;
    const vpa = latestQr.payeeVpa;
    const paise = flow.ctx.intendedPaise || latestQr.amountPaise;
    const amtStr = Number.isInteger(paise) ? (paise / 100).toFixed(2) : "";
    const copyText = amtStr ? `${vpa} (₹${amtStr})` : vpa;

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(vpa).then(() => {
        announceState(`UPI ID ${vpa} copied to clipboard. Open your UPI app and paste to pay directly.`, { soundCue: "detected" });
        const sub = $("copy-upi-sub");
        if (sub) sub.textContent = `Copied ${vpa}! Paste in UPI app`;
      }).catch(() => {
        announceState(`Payee UPI ID is ${vpa}.`, { soundCue: "step" });
      });
    } else {
      announceState(`Payee UPI ID is ${vpa}.`, { soundCue: "step" });
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