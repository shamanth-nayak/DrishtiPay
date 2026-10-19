import { SpokenMessages } from "./messages.js";

// Audio & Screen-reader speech manager
// Handbook Rule D17: Live regions first so TalkBack reads them without echo.
// App voice (Web Speech API synthesis) is toggled explicitly by the user.

class SpeechManager {
  constructor() {
    this.appVoiceEnabled = false;
    this.recognition = null;
    this.isListening = false;
    this.lastSpoken = "";
    this.unclearCount = 0;
    this.silenceTimer = null;
    this.handlers = {
      onConfirm: null,
      onCancel: null,
      onRepeat: null,
      onStart: null,
      onGeneral: null
    };

    this.synth = window.speechSynthesis || null;
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

    // App Voice Synthesis (only when enabled)
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
      // If synth is off, trigger callback immediately
      setTimeout(onEnd, 100);
    }
  }

  repeatLast() {
    if (this.lastSpoken) {
      this.announce(this.lastSpoken, { speakWithSynth: true });
    }
  }

  initRecognition({ onResult, onError, onStart, onEnd } = {}) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRec) {
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
        if (onStart) onStart();
      };

      this.recognition.onresult = (event) => {
        this.disarmSilenceTimeout();
        this.isListening = false;
        const transcript = event.results[0]?.[0]?.transcript?.trim() || "";
        if (onResult) onResult(transcript);
        this.handleCommand(transcript);
      };

      this.recognition.onerror = (event) => {
        this.disarmSilenceTimeout();
        this.isListening = false;
        const errorType = event.error || "unknown";
        console.warn("Speech recognition error:", errorType, event);

        // Friendly error classification
        let userMsg = "";
        let isFatal = false;

        switch (errorType) {
          case "not-allowed":
          case "service-not-allowed":
            userMsg = "Microphone access was denied. Please allow microphone permission in browser settings.";
            isFatal = true;
            break;
          case "no-speech":
            userMsg = "No speech detected. Press speak to try again or use the buttons.";
            break;
          case "network":
            userMsg = "Speech recognition network error. Chrome speech requires an internet connection.";
            break;
          case "audio-capture":
            userMsg = "No microphone was found or microphone is busy.";
            isFatal = true;
            break;
          case "aborted":
            // Normal when aborted intentionally
            return;
          default:
            userMsg = `Voice input error (${errorType}). You can use buttons and inputs.`;
        }

        if (onError) onError({ error: errorType, message: userMsg, isFatal });
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this.disarmSilenceTimeout();
        if (onEnd) onEnd();
      };

      return true;
    } catch (e) {
      console.error("SpeechRec init error:", e);
      return false;
    }
  }

  listenOnce() {
    if (!this.recognition) return;

    // Stop synthesis before starting mic so microphone does not pick up synthesized speech
    if (this.synth && this.synth.speaking) {
      this.synth.cancel();
    }

    try {
      this.recognition.abort();
    } catch {}

    // Small delay to allow audio hardware channel to free up
    setTimeout(() => {
      try {
        this.recognition.start();
      } catch (e) {
        console.warn("Speech recognition start issue:", e);
      }
    }, 150);
  }

  // Dual engine: records audio chunk directly from mic and transcribes via backend Gemini
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

      // Automatically capture a 3.5 second spoken utterance
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
    
    // Exact word lists per Section 10.3 / 13.1
    const confirmWords = ["yes", "confirm", "proceed", "okay", "ok"];
    const cancelWords = ["no", "cancel", "stop", "abort"];

    if (confirmWords.some(w => lower.includes(w))) {
      this.unclearCount = 0;
      if (this.handlers.onConfirm) this.handlers.onConfirm(lower);
      return;
    }

    if (cancelWords.some(w => lower.includes(w))) {
      this.unclearCount = 0;
      if (this.handlers.onCancel) this.handlers.onCancel(lower);
      return;
    }

    if (lower.includes("repeat") || lower.includes("say again")) {
      this.repeatLast();
      return;
    }

    if (lower.includes("start") || lower.includes("shop")) {
      if (this.handlers.onStart) this.handlers.onStart();
      return;
    }

    // Unclear response handling (Section 13.2 M19 / M20)
    this.unclearCount++;
    if (this.unclearCount === 1) {
      this.announce(SpokenMessages.M19_UNCLEAR_REPLY);
    } else {
      this.unclearCount = 0;
      this.announce(SpokenMessages.M20_SILENCE_OR_TIMEOUT, { assertive: true });
      if (this.handlers.onCancel) this.handlers.onCancel();
    }
  }

  registerActions({ onConfirm, onCancel, onRepeat, onStart, onGeneral }) {
    this.handlers = { onConfirm, onCancel, onRepeat, onStart, onGeneral };
  }
}

export const speech = new SpeechManager();
