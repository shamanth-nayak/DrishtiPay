import { SpokenMessages } from "./messages.js";

// Helper: Extracts number/amount in rupees from spoken text (e.g., "35", "35 rupees", "thirty five")
function extractAmountFromText(text) {
  if (!text) return null;
  const cleaned = text.toLowerCase().replace(/,/g, "").trim();

  // 1. Direct digits (e.g., "35", "₹35", "35 rupees", "40.50")
  const numMatch = cleaned.match(/(?:(?:rs\.?|inr|₹|rupees?)\s*)?(\d+(?:\.\d{1,2})?)(?:\s*(?:rs\.?|inr|₹|rupees?))?/i);
  if (numMatch && numMatch[1]) {
    const val = parseFloat(numMatch[1]);
    if (!isNaN(val) && val > 0) return val;
  }

  // 2. Word numbers (e.g., "thirty five", "one hundred fifty")
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
    // App voice synthesis enabled by default for blind/low-vision accessibility
    this.appVoiceEnabled = true;
    this.continuousMode = true;
    this.recognition = null;
    this.isListening = false;
    this.isPausedForTTS = false;
    this.lastSpoken = "";
    this.restartTimer = null;
    this.statusTimer = null;

    this.handlers = {
      onConfirm: null,
      onCancel: null,
      onRepeat: null,
      onStart: null,
      onDirectQr: null,
      onAmount: null,
      onGeneral: null
    };

    this.synth = typeof window !== "undefined" ? window.speechSynthesis : null;
    this.voices = [];
    this.preferredVoice = null;

    if (this.synth) {
      this.initVoices();
    }

    this.initRecognition();
  }

  initVoices() {
    if (!this.synth) return;

    const refreshVoices = () => {
      this.voices = this.synth.getVoices() || [];
      this.preferredVoice = this.pickBestVoice();
    };

    refreshVoices();
    if (this.synth.onvoiceschanged !== undefined) {
      this.synth.onvoiceschanged = refreshVoices;
    }
  }

  pickBestVoice() {
    if (!this.voices || this.voices.length === 0) return null;

    // 1. Natural / Neural Indian English
    const indianEnNatural = this.voices.find(v =>
      (v.lang === "en-IN" || v.lang === "en_IN" || v.lang.toLowerCase().startsWith("en-in")) &&
      (/natural|online|google|neural|neerja|heera|ravi/i.test(v.name))
    );
    if (indianEnNatural) return indianEnNatural;

    // 2. Any Indian English voice
    const anyIndianEn = this.voices.find(v =>
      v.lang === "en-IN" || v.lang === "en_IN" || v.lang.toLowerCase().startsWith("en-in")
    );
    if (anyIndianEn) return anyIndianEn;

    // 3. Indian Hindi voice
    const indianHindi = this.voices.find(v =>
      v.lang.toLowerCase().startsWith("hi") || /hindi|swara|madhur/i.test(v.name)
    );
    if (indianHindi) return indianHindi;

    // 4. Any English voice
    const anyEn = this.voices.find(v => v.lang.toLowerCase().startsWith("en"));
    if (anyEn) return anyEn;

    return this.voices[0] || null;
  }

  setAppVoice(enabled) {
    this.appVoiceEnabled = !!enabled;
    if (!this.appVoiceEnabled && this.synth) {
      this.synth.cancel();
    }
  }

  updateIndicator(text, state = "active") {
    const statusTextEl = document.getElementById("speech-status-text");
    const indicatorEl = document.getElementById("voice-indicator");
    if (statusTextEl) statusTextEl.textContent = text;
    if (indicatorEl) {
      indicatorEl.classList.remove("active", "listening", "speaking", "recognized", "error");
      indicatorEl.classList.add(state);
    }
  }

  // Announces text via screen reader live region and synthesized speech
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

    // App Voice Synthesis
    if (this.appVoiceEnabled && speakWithSynth && this.synth) {
      this.synth.cancel();

      // Temporarily pause microphone recognition while phone speaks to prevent echo feedback
      this.isPausedForTTS = true;
      this.stopListening();
      this.updateIndicator("Speaking...", "speaking");

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.96;

      const voice = this.preferredVoice || this.pickBestVoice();
      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      } else {
        utterance.lang = "en-IN";
      }

      const finishTTS = () => {
        this.isPausedForTTS = false;
        if (onEnd) onEnd();
        // Resume continuous listening shortly after speech finishes
        if (this.continuousMode) {
          clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            this.startListening();
          }, 350);
        }
      };

      utterance.onend = finishTTS;
      utterance.onerror = finishTTS;

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
    if (typeof window === "undefined") return false;
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
      console.warn("SpeechRecognition not available in this browser environment.");
      this.updateIndicator("Voice: touch only", "error");
      return false;
    }

    try {
      this.recognition = new SpeechRec();
      this.recognition.lang = "en-IN";
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.maxAlternatives = 2;

      this.recognition.onstart = () => {
        this.isListening = true;
        this.updateIndicator("Listening: Start · Confirm · Repeat", "listening");
      };

      this.recognition.onresult = (event) => {
        if (!event.results || event.results.length === 0) return;
        const lastIdx = event.results.length - 1;
        const transcript = event.results[lastIdx]?.[0]?.transcript?.trim() || "";
        console.log("Recognized speech:", transcript);

        if (transcript) {
          this.handleCommand(transcript);
        }
      };

      this.recognition.onerror = (event) => {
        this.isListening = false;
        const err = event.error;
        console.warn("Speech recognition notice:", err);

        if (err === "not-allowed" || err === "service-not-allowed") {
          this.continuousMode = false;
          this.updateIndicator("Mic blocked (tap to allow)", "error");
        } else if (err === "no-speech" || err === "aborted") {
          // Normal on silence, let onend restart cleanly
        } else {
          this.updateIndicator("Voice waiting...", "active");
        }
      };

      this.recognition.onend = () => {
        this.isListening = false;
        // Continuous auto-restart loop unless explicitly paused for TTS or unallowed
        if (this.continuousMode && !this.isPausedForTTS) {
          clearTimeout(this.restartTimer);
          this.restartTimer = setTimeout(() => {
            if (this.continuousMode && !this.isListening && !this.isPausedForTTS) {
              this.startListening();
            }
          }, 250);
        }
      };

      return true;
    } catch (e) {
      console.warn("Speech recognition initialization error:", e);
      return false;
    }
  }

  // Starts continuous voice command listening
  startListening() {
    if (this.isPausedForTTS) return false;
    if (!this.recognition) {
      const ok = this.initRecognition();
      if (!ok) return false;
    }

    try {
      this.recognition.abort();
    } catch {}

    try {
      this.recognition.start();
      return true;
    } catch (e) {
      // If already started or browser is warming up, quietly schedule next attempt
      if (this.continuousMode && !this.isListening) {
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => {
          try { this.recognition.start(); } catch {}
        }, 500);
      }
      return false;
    }
  }

  stopListening() {
    if (this.recognition) {
      try { this.recognition.abort(); } catch {}
    }
    this.isListening = false;
  }

  // Start continuous mode (called on first user gesture or start)
  startContinuous() {
    this.continuousMode = true;
    this.startListening();
  }

  showRecognized(label) {
    this.updateIndicator(`Heard: "${label}" ✓`, "recognized");
    clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      if (this.isListening) {
        this.updateIndicator("Listening: Start · Confirm · Repeat", "listening");
      } else {
        this.updateIndicator("Voice Active", "active");
      }
    }, 2200);
  }

  handleCommand(text) {
    const raw = text.toLowerCase().trim();
    if (!raw) return;

    // 1. Confirm Commands (comprehensive phonetic match including "comform", "conform", "confirm", "proceed", "yes")
    const isConfirm = (
      /\b(confirm|conform|comform|confam|conferm|confirmed|confirming)\b/i.test(raw) ||
      /\b(yes|yeah|yup|proceed|continue|pay|done|ok|okay)\b/i.test(raw) ||
      /\b(haan|ha|sahi|theek|karo)\b/i.test(raw)
    );
    if (isConfirm) {
      this.showRecognized("CONFIRM");
      if (this.handlers.onConfirm) this.handlers.onConfirm(raw);
      return;
    }

    // 2. Start Commands (start inspecting, begin, scan, shuru)
    const isStart = (
      /\b(start|starts|starting|begin|begins|inspect|shuru|open|go|let's go|scan)\b/i.test(raw)
    );
    if (isStart) {
      this.showRecognized("START");
      if (this.handlers.onStart) this.handlers.onStart();
      return;
    }

    // 3. Repeat Commands (repeat, again, say again)
    const isRepeat = (
      /\b(repeat|again|say again|what did you say|what|phir se|dobara|pardon)\b/i.test(raw)
    );
    if (isRepeat) {
      this.showRecognized("REPEAT");
      this.repeatLast();
      return;
    }

    // 4. Cancel / Back Commands
    const isCancel = (
      /\b(cancel|stop|back|go back|abort|no|nope|nahi|nahin|ruk|roko)\b/i.test(raw)
    );
    if (isCancel) {
      this.showRecognized("CANCEL");
      if (this.handlers.onCancel) this.handlers.onCancel(raw);
      return;
    }

    // 5. Direct QR
    if (/\b(direct qr|skip label|skip product)\b/i.test(raw)) {
      this.showRecognized("DIRECT QR");
      if (this.handlers.onDirectQr) this.handlers.onDirectQr();
      return;
    }

    // 6. Monetary amount (e.g. "35", "thirty five", "40 rupees")
    const extractedAmount = extractAmountFromText(raw);
    if (extractedAmount !== null && this.handlers.onAmount) {
      this.showRecognized(`₹${extractedAmount}`);
      this.handlers.onAmount(extractedAmount, raw);
      return;
    }

    // Ambient chatter that doesn't match a command is quietly ignored in continuous mode
    console.log("Speech ignored (no command matched):", raw);
  }

  registerActions({ onConfirm, onCancel, onRepeat, onStart, onDirectQr, onAmount, onGeneral }) {
    this.handlers = { onConfirm, onCancel, onRepeat, onStart, onDirectQr, onAmount, onGeneral };
  }
}

export const speech = new SpeechManager();
