export class DutchSpeech {
  constructor({ synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, online = () => globalThis.navigator.onLine, status = () => {}, voicesChanged = () => {} } = {}) {
    this.synth = synth; this.Utterance = Utterance; this.online = online; this.status = status;
    this.voicesChanged = voicesChanged; this.voices = []; this.voiceURI = ''; this.rate = 0.9; this.serial = 0;
    this.refresh = () => { this.voices = (this.synth?.getVoices() ?? []).filter(v => /^nl([_-]|$)/i.test(v.lang)); this.voicesChanged(this.voices); };
    this.synth?.addEventListener('voiceschanged', this.refresh);
    this.refresh();
  }
  selectedVoice() {
    return this.voices.find(v => v.voiceURI === this.voiceURI)
      ?? this.voices.find(v => /^nl[-_]NL$/i.test(v.lang) && v.localService)
      ?? this.voices.find(v => /^nl[-_]NL$/i.test(v.lang))
      ?? this.voices.find(v => v.localService) ?? this.voices[0] ?? null;
  }
  stop() { this.serial++; this.synth?.cancel(); this.utterance = null; }
  speak(text) {
    if (!this.synth || !this.Utterance) { this.status('Speech is unavailable in this browser. Try Safari on your iPhone.', 'error'); return false; }
    this.refresh();
    const voice = this.selectedVoice();
    if (!this.online() && !voice?.localService) {
      this.status('Offline audio needs an installed Dutch voice. Download one in iPhone Settings → Accessibility → Spoken Content / Read & Speak → Voices.', 'error');
      return false;
    }
    this.stop();
    const serial = this.serial, utterance = new this.Utterance(text);
    utterance.lang = 'nl-NL';
    if (voice) utterance.voice = voice;
    utterance.rate = this.rate; utterance.pitch = 1; utterance.volume = 1;
    this.utterance = utterance; // Retain a reference for Safari's speech lifecycle.
    utterance.onstart = () => { if (serial === this.serial) this.status('Speaking…', 'speaking'); };
    utterance.onend = () => { if (serial === this.serial) { this.status('Tap to listen again.', 'ready'); this.utterance = null; } };
    utterance.onerror = event => {
      if (serial !== this.serial || ['canceled', 'interrupted'].includes(event.error)) return;
      this.status('Audio did not start. Tap Listen again; check that a Dutch voice is installed.', 'error');
      this.utterance = null;
    };
    this.status(voice ? 'Starting Dutch audio…' : 'Using the device’s nl-NL voice. Tap again if needed.', 'ready');
    // Stay in the tap/keyboard gesture: no promises or timers before speak().
    this.synth.resume(); this.synth.speak(utterance);
    return true;
  }
}
