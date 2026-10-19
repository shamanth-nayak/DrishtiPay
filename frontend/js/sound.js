// Accessibility Sound Cues (Earcons) using Web Audio API and Web Vibration API
// Provides distinct, non-speech sensory confirmation for blind/low-vision users

class AudioManager {
  constructor() {
    this.ctx = null;
  }

  _init() {
    if (!this.ctx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  // Success / Match: pleasant double beep ascending (e.g. 523Hz -> 659Hz)
  playSuccess() {
    this._init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    
    // Tone 1
    const osc1 = this.ctx.createOscillator();
    const gain1 = this.ctx.createGain();
    osc1.frequency.setValueAtTime(523.25, now); // C5
    gain1.gain.setValueAtTime(0.15, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc1.connect(gain1);
    gain1.connect(this.ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.12);

    // Tone 2
    const osc2 = this.ctx.createOscillator();
    const gain2 = this.ctx.createGain();
    osc2.frequency.setValueAtTime(659.25, now + 0.14); // E5
    gain2.gain.setValueAtTime(0.18, now + 0.14);
    gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc2.connect(gain2);
    gain2.connect(this.ctx.destination);
    osc2.start(now + 0.14);
    osc2.stop(now + 0.3);

    if (navigator.vibrate) {
      navigator.vibrate([60, 50, 80]);
    }
  }

  // Mismatch / Blocked / Alert: low descending warning tone (440Hz -> 220Hz)
  playAlert() {
    this._init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(320, now);
    osc.frequency.linearRampToValueAtTime(180, now + 0.35);
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.35);

    if (navigator.vibrate) {
      navigator.vibrate([150, 80, 200]);
    }
  }

  // Click / Step transition: soft ping
  playStep() {
    this._init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(800, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.08);

    if (navigator.vibrate) {
      navigator.vibrate(30);
    }
  }

  // Camera / Scan detection ping
  playDetected() {
    this._init();
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.frequency.setValueAtTime(1046.5, now); // C6
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.15);

    if (navigator.vibrate) {
      navigator.vibrate(50);
    }
  }
}

export const sound = new AudioManager();
