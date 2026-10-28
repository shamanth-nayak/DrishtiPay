# DrishtiPay

DrishtiPay is a voice-first payment amount checker for blind and low-vision shoppers in India. It helps a user confirm the amount they intend to pay, compare it with the amount in a UPI QR code, and hear the result before opening their own UPI app.

## About

**NMAMIT Hackloop**

This project idea was made for the Hackloop 2026 event held by the Finite Loop Club.

This was built exclusively for Hackloop '26.

> **Status:** Fully tested.

## How it works

1. Read the product label (camera or upload), or scan the QR directly.
2. Confirm the amount you intend to pay.
3. Scan the UPI QR and compare amounts.
4. Hear the result, then explicitly confirm to continue to your UPI app.

## Screens

### Start

![Start](https://raw.githubusercontent.com/shamanth-nayak/DrishtiPay/main/docs/screenshots/01-start.jpg)

### Camera

![Camera](https://raw.githubusercontent.com/shamanth-nayak/DrishtiPay/main/docs/screenshots/02-camera.jpg)

### Confirm amount

![Confirm amount](https://raw.githubusercontent.com/shamanth-nayak/DrishtiPay/main/docs/screenshots/03-confirm-amount.jpg)

### Review

![Review](https://raw.githubusercontent.com/shamanth-nayak/DrishtiPay/main/docs/screenshots/04-review.jpg)

## Running the project

### Prerequisites

- [Node.js](https://nodejs.org/) and npm installed.
- Git installed, or a downloaded copy of the project.

### 1. Install dependencies

Open a terminal in the project root directory and run:
```
npm install

```

### 2. Start the application
```
npm start

```

The server should start at:
```
http://localhost:5173

```

Open this URL in your browser to use DrishtiPay.

### 3. Stop the application

Press `Ctrl + C` in the terminal.

### Notes

- Allow camera access when prompted.
- Camera access on a phone may require HTTPS or another secure context.
- This prototype checks payment amounts; it does not process payments or verify merchants.

## Planned stack

**Major:** OpenCV

**Minor:** React, TypeScript, Vite · Python, FastAPI · EasyOCR · ZXing · browser speech

## Limitations

- Does not process payments, handle PINs, verify merchants or detect fraud.
- A match only means two amounts are equal.
- OCR can be wrong, so the user confirms every price.

## Future

Better voice commands, more languages, testing on more devices and with more users.
