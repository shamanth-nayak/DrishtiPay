import { SpokenMessages } from "./messages.js";

// Audio & Screen-reader speech manager
// Handbook Rule D17: Live regions first so TalkBack reads them without echo.
// App voice (Web Speech API synthesis) is toggled explicitly by the user.

// Helper: Extracts number/amount in rupees from spoken text (e.g., "35", "35 rupees", "thirty five")
function extractAmountFromText(text) {
  if (!text) return null;
  const cleaned = text.toLowerCase().replace(/,/g, "").trim();

  // 1. Check direct digits: e.g., "35", "₹35", "35 rupees", "40.50"
  const numMatch = cleaned.match(/(?:(?:rs\.?|inr|₹|rupees?)\s*)?(\d+(?:\.\d{1,2})?)(?:\s*(?:rs\.?|inr|₹|rupees?))?/);
  if (numMatch && numMatch[1]) {
    const val = parseFloat(numMatch[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // 2. Convert spoken word numbers (e.g., "thirty five", "one hundred fifty")
  const wordMap = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90
  };

  const words = cleaned.replace(/[^a-z\s]/g, " ").split(/\s+/);
  let total = 0;
  let current = 0;
  let found = false;

  for (const w of words) {
    if (wordMap[w] !== undefined) {
      current += wordMap[w];
      found = true;
    } else if (w === "hundred") {
      current = (current === 0 ? 1 : current) * 100;
      found = true;
    } else if (w === "thousand") {
      current = (current === 0 ? 1 : current) * 1000;
      total += current;
      current = 0;
      found = true;
    }
  }
  total += current;
  return found && total > 0 ? total : null;
}

class SpeechManager {
  constructor() {
    this.appVoiceEnabled = false;
    this.recognition = null;
    this.isListening = false;
    this.lastSpoken = "";
    this.unclearCount = 0;
    this.silenceTimer = null;

    this.activeCallbacks = {
      onStart: null,
      onResult: null,
      onError: null,
      onEnd: null
    };

    this.handlers = {
      onConfirm: null,
      onCancel: null,
      onRepeat: null,
      onStart: null,
      onDirectQr: null,
      onAmount: null,
      onGeneral: null
    };

    this.synth = window.speechSynthesis || null;

    // Automatically initialize recognition if available in browser
    this.initRecognition();
  }

  setAppVoice(enabled) {
    this.appVoiceEnabled = !!enabled;
    if (!this.appVoiceEnabled && this.synth) {
      this.synth.cancel();
    }
  }

  // Announces to both TalkBack live regions and optional speech synthesis
  announce(text, { assertive = false, speakWithSynth = true, onEnd = null } = {}) {
    if (!text) return;
    this.lastSpoken = text;

    // Update screen-reader live regions
    const assertiveRegion = document.getElementById("live-assertive");
    const politeRegion = document.getElementById("live-polite");

    if (assertive && assertiveRegion) {
      assertiveRegion.textContent = "";
      setTimeout(() => { assertiveRegion.textContent = text; }, 50);
    } else if (politeRegion) {
      politeRegion.textContent = "";
      setTimeout(() => { politeRegion.textContent = text; }, 50);
    }

    // App Voice Synthesis (only when explicitly enabled by user)
    if (this.appVoiceEnabled && speakWithSynth && this.synth) {
      this.synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.lang = "en-IN";
      if (onEnd) {
        utterance.onend = onEnd;
        utterance.onerror = onEnd;
      }
      this.synth.speak(utterance);
    } else if (onEnd) {
      setTimeout(onEnd, 100);
    }
  }

  repeatLast() {
    if (this.lastSpoken) {
      this.announce(this.lastSpoken, { speakWithSynth: true });
    }
  }

  initRecognition() {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn("Native SpeechRecognition not supported in this browser.");
      return false;
    }

    try {
      this.recognition = new SpeechRec();
      this.recognition.lang = navigator.language || "en-US";
      this.recognition.continuous = false;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 1;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.armSilenceTimeout(12);
        if (this.activeCallbacks.onStart) this.activeCallbacks.onStart();
      };

      this.recognition.onresult = (event) => {
        this.disarmSilenceTimeout();
        this.isListening = false;
        const transcript = event.results[0]?.[0]?.transcript?.trim() || "";
        console.log("Speech transcript:", transcript);
        if (this.activeCallbacks.onResult) this.activeCallbacks.onResult(transcript);
        this.handleCommand(transcript);
      };

      this.recognition.onerror = (event) => {
        this.disarmSilenceTimeout();
        this.isListening = false;
        const errorType = event.error || "unknown";
        console.warn("Speech recognition error:", errorType, event);

        let userMsg = "";
        let isFatal = false;

        switch (errorType) {
          case "not-allowed":
          case "service-not-allowed":
            userMsg = "Microphone access was denied. Please allow microphone permission in browser settings.";
            isFatal = true;
            break;
          case "no-speech":
            userMsg = "No speech detected. Tap Speak Command to try again.";
            break;
          case "network":
            userMsg = "Speech recognition network error. Chrome speech requires an internet connection.";
            break;
          case "audio-capture":
            userMsg = "No microphone found or microphone is busy.";
            isFatal = true;
            break;
          case "aborted":
            return;
          default:
            userMsg = `Voice error (${errorType}). Please use touch buttons.`;
        }

        if (this.activeCallbacks.onError) {
          this.activeCallbacks.onError({ error: errorType, message: userMsg, isFatal });
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this.disarmSilenceTimeout();
        if (this.activeCallbacks.onEnd) this.activeCallbacks.onEnd();
      };

      return true;
    } catch (e) {
      console.error("SpeechRec init error:", e);
      return false;
    }
  }

  // Starts native browser speech recognition
  startListening({ onStart, onResult, onError, onEnd } = {}) {
    if (!this.recognition) {
      const initialized = this.initRecognition();
      if (!initialized) return false;
    }

    this.activeCallbacks = { onStart, onResult, onError, onEnd };

    // Stop synthesis so mic doesn't hear synthetic audio
    if (this.synth && this.synth.speaking) {
      this.synth.cancel();
    }

    try {
      this.recognition.abort();
    } catch {}

    setTimeout(() => {
      try {
        this.recognition.start();
      } catch (e) {
        console.warn("Speech recognition start issue:", e);
        if (onError) onError({ error: "start-failed", message: "Could not start microphone." });
      }
    }, 150);

    return true;
  }

  stopListening() {
    this.disarmSilenceTimeout();
    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
    }
    this.isListening = false;
  }

  armSilenceTimeout(seconds = 12) {
    this.disarmSilenceTimeout();
    this.silenceTimer = setTimeout(() => {
      if (this.isListening) {
        this.stopListening();
        this.announce(SpokenMessages.M20_SILENCE_OR_TIMEOUT, { assertive: true });
        if (this.handlers.onCancel) this.handlers.onCancel();
      }
    }, seconds * 1000);
  }

  disarmSilenceTimeout() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  handleCommand(text) {
    const lower = text.toLowerCase().trim();

    // 1. Confirm Commands
    const confirmWords = ["yes", "confirm", "proceed", "okay", "ok", "continue", "pay"];
    if (confirmWords.some(w => lower === w || lower.includes(w))) {
      this.unclearCount = 0;
      if (this.handlers.onConfirm) this.handlers.onConfirm(lower);
      return;
    }

    // 2. Cancel / Back Commands
    const cancelWords = ["no", "cancel", "stop", "abort", "back"];
    if (cancelWords.some(w => lower === w || lower.includes(w))) {
      this.unclearCount = 0;
      if (this.handlers.onCancel) this.handlers.onCancel(lower);
      return;
    }

    // 3. Repeat Commands
    if (lower.includes("repeat") || lower.includes("say again")) {
      this.repeatLast();
      return;
    }

    // 4. Start Navigation Commands
    if (lower.includes("start") || lower.includes("shop") || lower.includes("inspect") || lower.includes("begin")) {
      if (this.handlers.onStart) this.handlers.onStart();
      return;
    }

    // 5. Direct QR Scan
    if (lower.includes("direct qr") || lower.includes("scan qr") || lower.includes("skip label")) {
      if (this.handlers.onDirectQr) this.handlers.onDirectQr();
      return;
    }

    // 6. Check for spoken monetary amount (e.g., "35", "35 rupees", "fifty")
    const extractedAmount = extractAmountFromText(lower);
    if (extractedAmount !== null && this.handlers.onAmount) {
      this.unclearCount = 0;
      this.handlers.onAmount(extractedAmount, lower);
      return;
    }

    // 7. General command fallback
    if (this.handlers.onGeneral) {
      this.handlers.onGeneral(lower);
      return;
    }

    // 8. Unclear response handling
    this.unclearCount++;
    if (this.unclearCount === 1) {
      this.announce(SpokenMessages.M19_UNCLEAR_REPLY);
    } else {
      this.unclearCount = 0;
      this.announce(SpokenMessages.M20_SILENCE_OR_TIMEOUT, { assertive: true });
      if (this.handlers.onCancel) this.handlers.onCancel();
    }
  }

  registerActions({ onConfirm, onCancel, onRepeat, onStart, onDirectQr, onAmount, onGeneral }) {
    this.handlers = { onConfirm, onCancel, onRepeat, onStart, onDirectQr, onAmount, onGeneral };
  }

  // Fallback: direct audio recording to backend Gemini STT
  async recordAudioCommand({ onStart, onTranscript, onError } = {}) {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (onError) onError("Microphone API not supported on this browser.");
      return;
    }

    try {
      if (this.synth && this.synth.speaking) {
        this.synth.cancel();
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstart = () => {
        this.isListening = true;
        if (onStart) onStart();
      };

      mediaRecorder.onstop = async () => {
        this.isListening = false;
        stream.getTracks().forEach(t => t.stop());
        const audioBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });

        try {
          const { transcribeVoiceAudio } = await import("./api.js");
          const result = await transcribeVoiceAudio(audioBlob);
          console.log("Audio transcribed via backend:", result);
          if (onTranscript) onTranscript(result);
          if (result.command) {
            this.handleCommand(result.command);
          } else if (result.text) {
            this.handleCommand(result.text);
          }
        } catch (err) {
          console.warn("Backend STT error:", err);
          if (onError) onError(err);
        }
      };

      mediaRecorder.start();

      setTimeout(() => {
        if (mediaRecorder.state === "recording") {
          mediaRecorder.stop();
        }
      }, 3500);

    } catch (err) {
      console.error("Audio recording error:", err);
      if (onError) onError(err);
    }
  }
}

export const speech = new SpeechManager();