const isDutch = voice => /^nl(?:[-_]|$)/i.test(voice.lang?.trim() ?? '');
const missingVoice = 'No Dutch voice is available in this browser. On iPhone, download a Dutch / Nederlands voice in Settings → Accessibility → Read & Speak (or Spoken Content) → Voices, then return and tap Refresh Dutch voices.';

export class DutchSpeech {
  constructor({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, online = () => globalThis.navigator?.onLine !== false, status = () => {}, voicesChanged = () => {}, schedule = (fn, ms) => setTimeout(fn, ms), unschedule = handle => clearTimeout(handle) } = {}) {
    this.synth = synth; this.Utterance = Utterance; this.online = online; this.status = status;
    this.voicesChanged = voicesChanged; this.voices = []; this.voiceURI = ''; this.rate = 0.9; this.serial = 0;
    this.schedule = (fn, ms) => { const handle = schedule(fn, ms); handle?.unref?.(); return handle; };
    this.unschedule = unschedule;
    this.refresh = () => {
      try { this.voices = (this.synth?.getVoices() ?? []).filter(isDutch); }
      catch { this.voices = []; }
      this.voicesChanged(this.voices);
      return this.voices;
    };
    this.synth?.addEventListener?.('voiceschanged', this.refresh);
    this.refresh();
    // Some Safari versions populate voices after boot without firing voiceschanged.
    if (this.synth && !this.voices.length) for (const delay of [250, 800, 2000]) {
      this.schedule(() => { if (!this.voices.length) this.refresh(); }, delay);
    }
  }
  selectedVoice() {
    return (this.voiceURI && this.voices.find(v => v.voiceURI === this.voiceURI))
      || this.voices.find(v => /^nl[-_]NL$/i.test(v.lang.trim()) && v.localService)
      || this.voices.find(v => /^nl[-_]NL$/i.test(v.lang.trim()))
      || this.voices.find(v => v.localService) || this.voices[0] || null;
  }
  clearStartTimer() {
    if (this.startTimer !== undefined) this.unschedule(this.startTimer);
    this.startTimer = undefined;
  }
  stop() {
    this.serial++; this.clearStartTimer();
    const active = this.utterance || this.synth?.speaking || this.synth?.pending;
    this.utterance = null;
    // Avoid cancelling an idle native engine immediately before its first speak().
    if (active) { try { this.synth?.cancel(); } catch {} }
  }
  errorMessage(code) {
    if (['language-unavailable', 'voice-unavailable'].includes(code)) return 'The selected Dutch voice is unavailable. Download it, or choose another Dutch voice in Settings and tap Refresh Dutch voices.';
    if (code === 'not-allowed') return 'Speech was blocked by the browser. Tap Listen again directly, or tap Try “Goedemorgen” in Settings.';
    if (code === 'network') return 'This Dutch voice needs an internet connection. Go online or select an on-device Dutch voice.';
    if (code === 'audio-hardware') return 'The browser could not use the audio output. Check media volume, headphones, and Bluetooth, then tap Listen again.';
    return 'Dutch audio did not start. Check media volume and audio output, then try another Dutch voice in Settings.';
  }
  speak(text) {
    if (!this.synth || !this.Utterance) { this.status('Speech is unavailable in this browser. Try Safari on your iPhone.', 'error'); return false; }
    this.refresh();
    const voice = this.selectedVoice();
    if (!voice) { this.stop(); this.status(missingVoice, 'error'); return false; }
    if (!this.online() && !voice.localService) {
      this.stop(); this.status('Offline audio needs an installed Dutch voice. Download one in iPhone Settings → Accessibility → Read & Speak (or Spoken Content) → Voices.', 'error');
      return false;
    }
    this.stop();
    const serial = this.serial, utterance = new this.Utterance(text);
    const label = `${voice.name} · ${voice.lang}`;
    // Always bind the actual Dutch voice: never ask the OS to guess a fallback.
    utterance.voice = voice;
    utterance.lang = /^nl$/i.test(voice.lang.trim()) ? 'nl-NL' : voice.lang.trim().replace('_', '-');
    utterance.rate = this.rate; utterance.pitch = 1; utterance.volume = 1;
    this.utterance = utterance;
    let started = false;
    utterance.onstart = () => {
      if (serial !== this.serial) return;
      started = true; this.clearStartTimer(); this.status(`Speaking Dutch: ${label}`, 'speaking');
    };
    utterance.onend = () => {
      if (serial !== this.serial) return;
      this.clearStartTimer(); this.utterance = null; this.status(`Dutch voice: ${label}. Tap to listen again.`, 'ready');
    };
    utterance.onerror = event => {
      if (serial !== this.serial) return;
      this.clearStartTimer(); this.utterance = null;
      if (!['canceled', 'interrupted'].includes(event.error)) this.status(this.errorMessage(event.error), 'error');
    };
    this.status(`Starting Dutch audio: ${label}…`, 'ready');
    try {
      // Stay inside the user's tap. Do not wait for voices or a timer before speak.
      if (this.synth.paused) this.synth.resume();
      this.synth.speak(utterance);
      if (!started && this.utterance === utterance) this.startTimer = this.schedule(() => {
        if (serial !== this.serial || started || this.utterance !== utterance) return;
        this.stop(); this.status('The Dutch voice did not respond. Tap Listen once more. If it stays silent, try another Dutch voice in Settings and check media volume, silent mode, and Bluetooth output.', 'error');
      }, 4000);
      return true;
    } catch {
      this.stop(); this.status(this.errorMessage('synthesis-failed'), 'error'); return false;
    }
  }
}
