# DrishtiPay

An accessibility and transaction-verification prototype for the Hackloop S05 hackathon.

> AI interprets. Deterministic code verifies. The user authorizes. The existing UPI app executes.

DrishtiPay is not a payment processor. It does not collect a UPI PIN, authenticate a merchant, move money, or claim that a handoff completed a payment.

---

## Hardware & IoT Requirements

* **No external IoT hardware is required** to run or test the prototype.
* The application runs directly in any modern web browser on a smartphone, tablet, or laptop.
* It utilizes built-in device hardware:
  * **Camera**: Built-in webcam or phone camera for QR code and label scanning (via browser `BarcodeDetector` and `getUserMedia`).
  * **Microphone & Speaker**: Built-in audio hardware for voice commands and speech feedback (via Web Speech API and TalkBack / screen-reader live regions).

---

## Run the Prototype

This prototype deliberately uses no third-party packages.

```powershell
npm start
```

Open `http://localhost:5173` in your browser.

Run the safety-rule tests with:

```powershell
npm test
```

---

## Voice & Accessibility Controls

DrishtiPay provides hands-free accessibility for visually impaired users:

* **App Voice (TTS)**: Tap **"Turn on app voice"** to have screens and instructions read aloud automatically using high-quality Indian English (`en-IN`) or Hindi (`hi-IN`) synthesis.
* **Screen Reader Support**: Integrated with ARIA live regions (`#live-polite`, `#live-assertive`) for native TalkBack and NVDA support without echo.
* **Voice Commands**: Tap **"🎙 Speak Command"** and speak naturally:
  * **Start / Navigation**: Say *"start"*, *"begin"*, *"shop"*, or *"shuru"*.
  * **Confirm**: Say *"confirm"*, *"yes"*, *"proceed"*, *"okay"*, *"haan"*, or *"sahi"*.
  * **Cancel / Back**: Say *"cancel"*, *"no"*, *"stop"*, *"back"*, *"nahi"*, or *"ruk"*.
  * **Repeat**: Say *"repeat"*, *"say again"*, *"phir se"*, or *"dobara"*.
  * **Direct QR**: Say *"direct qr"* or *"scan qr"* to bypass label capture.
  * **Amount**: Speak any payment amount (e.g., *"35"*, *"fifty rupees"*, *"100"*).

---

## Demonstrate It

1. Enter `35` as the intended amount (or say *"35 rupees"*).
2. Choose **Try matching ₹35 QR**, then **Verify payment request**.
3. Confirm the payee and amount, then enable **Open your UPI app**.
4. Reset, choose **Try ₹350 mismatch**, and verify that handoff is blocked.
5. Try the no-amount QR: it is explicitly reported as unverified.

QR-image and live-camera scanning use the browser's native `BarcodeDetector` when available. A pasted UPI request is always provided as an accessible fallback. Product-label upload is a manual-review placeholder; connect it to the planned OCR service before claiming automatic price reading.

---

## Team

- **Shamanth Nayak** — frontend and integration
- **Naman D Shetty** — QR parser and verification rules
- **Prapthi Shetty** — label/OCR integration
- **Vidhi Keshri** — accessibility, testing, and demo
