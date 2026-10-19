# DrishtiPay

An accessibility and transaction-verification prototype for the Hackloop S05 hackathon.

> AI interprets. Deterministic code verifies. The user authorizes. The existing UPI app executes.

DrishtiPay is not a payment processor. It does not collect a UPI PIN, authenticate a merchant, move money, or claim that a handoff completed a payment.

## Run the prototype

This first prototype deliberately uses no third-party packages.

```powershell
npm start
```

Open `http://localhost:5173`. Run the safety-rule tests with:

```powershell
npm test
```

## Demonstrate it

1. Enter `35` as the intended amount.
2. Choose **Try matching ₹35 QR**, then **Verify payment request**.
3. Confirm the payee and amount, then enable **Open your UPI app**.
4. Reset, choose **Try ₹350 mismatch**, and verify that handoff is blocked.
5. Try the no-amount QR: it is explicitly reported as unverified.

QR-image and live-camera scanning use the browser's native `BarcodeDetector` when available. A pasted UPI request is always provided as an accessible fallback. Product-label upload is a manual-review placeholder; connect it to the planned OCR service before claiming automatic price reading.

## Team

- Shamanth Nayak — frontend and integration
- Naman D Shetty — QR parser and verification rules
- Prapthi Shetty — label/OCR integration
- Vidhi Keshri — accessibility, testing, and demo
