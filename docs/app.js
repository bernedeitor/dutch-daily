import { Scheduler, clone, freshDocument, normalizeProgress, normalizedDictation, parseCSV, toCSV, deckId, reconcileProgress, TRACKS } from './core.js';
import { ProgressDB, loadBundled, makeBackup, parseBackup, restorePoint, BACKUP_FORMAT } from './storage.js';
import { DutchSpeech } from './speech.js';
const $ = id => document.getElementById(id);
let state, db, scheduler, currentDeck, currentCard, speech, ready = false, locked = false;
let audioStarted = false, pendingImport = null, registration = null, offlineReady = false;
let saveSerial = 0, toastTimer = null, installPrompt = null, reloadForUpdate = false;
const modeLabel = mode => mode === 'listening' ? 'Listening + spelling' : 'Flashcards';
const deckLabel = deck => deck.name === '500_common_dutch_flashcards.csv' ? '500 common words' : deck.name === '100_common_dutch_phrases.csv' ? '100 everyday phrases' : deck.name.replace(/\.csv$/i, '').replace(/_/g, ' ');
function toast(message) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
function showDialog(id) {
  for (const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
  if (id === 'settings-dialog') {
    renderVoices(); $('undo-import').hidden = !state?.restorePoint;
    $('reset-caption').textContent = state ? `${deckLabel(currentDeck)} · ${modeLabel(state.ui.mode)}. The other mode is kept.` : '';
  }
  $(id).showModal();
}
function block(error) {
  locked = true;
  $('error-message').textContent = error.message || String(error);
  $('error-banner').hidden = false;
  $('save-status').textContent = 'Progress is not saved. Export a backup before closing.';
  document.querySelectorAll('[data-rating]').forEach(b => { b.disabled = true; });
}
async function persist() {
  if (!state || !db || locked) return false;
  const serial = ++saveSerial;
  $('save-status').textContent = 'Saving on this device…';
  try {
    await db.save(state);
    if (serial === saveSerial) $('save-status').textContent = 'Saved on this device';
    return true;
  } catch (error) { block(error); return false; }
}
function renderDecks() {
  const options = state.decks.map(deck => new Option(`${deckLabel(deck)} · ${deck.cards.length}`, deck.id));
  $('deck-select').replaceChildren(...options); $('deck-select').value = state.ui.deck; $('deck-select').disabled = false;
}
function renderStats() {
  if (!scheduler) return;
  const counts = scheduler.stats();
  for (const [id, key] of [['learning','learning'],['learned','review'],['due','due'],['remaining','unseen']]) $('stat-' + id).textContent = counts[key];
  $('session-count').textContent = scheduler.sessionAnswers;
  $('learned-bar').style.width = `${counts.review / currentDeck.cards.length * 100}%`;
  $('deck-caption').textContent = `${currentDeck.cards.length} cards · progress saved for each practice mode`;
}
function renderControls() {
  const listening = state.ui.mode === 'listening';
  $('mode-flashcards').setAttribute('aria-pressed', String(!listening));
  $('mode-listening').setAttribute('aria-pressed', String(listening));
  $('selection-normal').setAttribute('aria-pressed', String(!scheduler.reviewEverything));
  $('selection-mix').setAttribute('aria-pressed', String(scheduler.reviewEverything));
  $('selection-help').textContent = scheduler.reviewEverything ? 'Learning + learned in one uniform random pool.' : 'Four learning cards, then one learned card.';
  $('practice-title').textContent = listening ? 'Tune in to Dutch.' : 'Let’s keep going.';
  $('practice-eyebrow').textContent = listening ? 'A LITTLE LISTENING GOES A LONG WAY' : 'MAKE A LITTLE PROGRESS';
  $('autoplay').checked = state.ui.autoplay; $('speech-rate').value = String(state.ui.rate);
  speech.voiceURI = state.ui.voice; speech.rate = state.ui.rate;
  renderStats();
}
function audioStatus(text, type = 'ready') {
  $('audio-status').textContent = text; $('audio-status').classList.toggle('error', type === 'error');
  $('study-card').classList.toggle('speaking', type === 'speaking');
}
function playAudio(slow = false) {
  if (!currentCard) return;
  audioStarted = true;
  const oldRate = speech.rate;
  if (slow) speech.rate = Math.min(0.65, oldRate);
  speech.speak(currentCard.word); speech.rate = oldRate;
}
function showNext(fromGesture = false) {
  speech.stop();
  const word = scheduler.nextWord();
  currentCard = currentDeck.cards.find(c => c.word === word); ready = false;
  $('spelling').value = ''; $('spelling').disabled = false;
  $('dictation-result').hidden = true; $('dictation-result').textContent = '';
  $('rating-panel').hidden = true; $('meaning').hidden = true; $('meaning').textContent = '';
  const listening = state.ui.mode === 'listening', learned = scheduler.state[word].status === 'review';
  $('study-card').setAttribute('aria-label', listening ? 'Listening exercise' : 'Current flashcard');
  $('flash-face').hidden = listening; $('listening-face').hidden = !listening; $('dictation-form').hidden = !listening;
  $('word').textContent = listening ? '' : word;
  $('listening-word').textContent = ''; $('listening-word').hidden = true;
  $('listening-meaning').textContent = ''; $('listening-meaning').hidden = true;
  $('listen-prompt').hidden = false;
  $('flip-hint').textContent = 'Tap to reveal the meaning';
  $('flash-face').setAttribute('aria-label', `${word}. Reveal translation`);
  $('card-type').textContent = learned ? 'LEARNED · REVIEW' : 'LEARNING';
  $('card-type').classList.toggle('review', learned);
  $('card-footer-text').textContent = learned ? 'A familiar word, worth another look.' : 'A little more familiar, every time.';
  $('reveal-actions').hidden = listening;
  $('play-label').textContent = listening ? 'Play Dutch audio' : 'Listen';
  for (const id of ['flash-face','play-audio','slow-audio','reveal-answer']) $(id).disabled = locked;
  document.querySelectorAll('[data-rating]').forEach(b => { b.disabled = locked; });
  audioStatus(listening ? 'Tap Play to hear the Dutch word or phrase.' : 'Native Dutch audio, from your device.');
  renderControls();
  if (fromGesture && ((listening && audioStarted) || (!listening && state.ui.autoplay))) playAudio();
}
function activate(fromGesture = false) {
  currentDeck = state.decks.find(d => d.id === state.ui.deck) ?? state.decks[0];
  state.ui.deck = currentDeck.id;
  scheduler = new Scheduler(currentDeck.cards, currentDeck.progress, state.ui.mode);
  renderDecks(); showNext(fromGesture);
}
function reveal() {
  if (!scheduler || locked || ready || state.ui.mode !== 'flashcards') return;
  ready = true;
  $('meaning').textContent = currentCard.meaning; $('meaning').hidden = false;
  $('flip-hint').textContent = 'A little more familiar.';
  $('flash-face').setAttribute('aria-label', `${currentCard.word}. ${currentCard.meaning}`);
  $('reveal-actions').hidden = true; $('rating-panel').hidden = false;
  $('rating-prompt').textContent = 'How well did you remember?';
}
function checkSpelling(showAnswer = false) {
  if (!scheduler || locked || ready || state.ui.mode !== 'listening') return;
  const typed = $('spelling').value;
  if (!showAnswer && !typed.trim()) { toast('Type an answer first, or tap Show answer.'); $('spelling').focus(); return; }
  const correct = !showAnswer && normalizedDictation(typed) === normalizedDictation(currentCard.word);
  ready = true; $('spelling').blur(); $('dictation-form').hidden = true;
  $('listen-prompt').hidden = true;
  $('listening-word').textContent = currentCard.word; $('listening-word').hidden = false;
  $('listening-meaning').textContent = currentCard.meaning; $('listening-meaning').hidden = false;
  $('dictation-result').textContent = correct ? 'Correct — mooi zo!' : showAnswer ? 'Here’s the answer. Rate how well you remembered it.' : `You wrote: “${typed}”. Correct spelling is shown above.`;
  $('dictation-result').classList.toggle('incorrect', !correct); $('dictation-result').hidden = false;
  $('rating-prompt').textContent = 'How difficult was it?'; $('rating-panel').hidden = false;
}
function rate(rating) {
  if (!scheduler || !ready || locked) return;
  ready = false; scheduler.answer(rating); showNext(true); void persist();
}
function switchMode(mode) {
  if (!state || locked || mode === state.ui.mode) return;
  scheduler.save(); state.ui.mode = mode;
  if (mode === 'listening') audioStarted = true;
  activate(true); void persist();
}
function setSelection(mix) {
  if (!state || locked || mix === scheduler.reviewEverything) return;
  scheduler.setReviewEverything(mix); showNext(true); void persist();
}
function renderVoices() {
  if (!speech) return;
  const options = [new Option('Automatic · nl-NL', '')];
  for (const voice of speech.voices) options.push(new Option(`${voice.name} · ${voice.lang}${voice.localService ? ' · on device' : ' · network'}`, voice.voiceURI));
  $('voice-select').replaceChildren(...options);
  $('voice-select').value = speech.voices.some(v => v.voiceURI === state?.ui.voice) ? state.ui.voice : '';
  const voice = speech.selectedVoice();
  $('voice-detail').textContent = voice ? `${voice.name} · ${voice.lang}. ${voice.localService ? 'On-device voice available for offline use.' : 'This voice may need an internet connection.'}` : 'No Dutch voice is listed yet. The app will request nl-NL from your device. Download a Dutch voice in iPhone Settings for offline audio.';
}
function downloadFile(name, data, type = 'application/json') {
  const blob = new Blob([data], { type: `${type};charset=utf-8` }), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('Export ready. On iPhone, check Files → Downloads, or use Share → Save to Files.');
}
function exportAll() {
  if (!state) { toast('There is no loaded progress to export yet.'); return; }
  scheduler?.save();
  downloadFile(`dutch-daily-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(makeBackup(state), null, 2));
}
function importSummary() {
  if (!pendingImport || pendingImport.kind !== 'progress') return;
  const deck = state.decks.find(d => d.id === $('import-target').value);
  if (!deck) return;
  const document = clone(pendingImport.document), info = reconcileProgress(document, deck.cards);
  const words = new Set(deck.cards.map(c => c.word));
  const lines = pendingImport.tracks.map(t => {
    const entries = Object.entries(document.tracks[t].cards), matched = entries.filter(([word]) => words.has(word));
    const learned = matched.filter(([, data]) => data.status === 'review').length;
    return `${modeLabel(t)}: ${matched.length} matching cards, ${learned} learned.`;
  });
  const incoming = pendingImport.tracks.reduce((n,t) => n + Object.keys(document.tracks[t].cards).length, 0);
  const matched = pendingImport.tracks.reduce((n,t) => n + Object.keys(document.tracks[t].cards).filter(w => words.has(w)).length, 0);
  if (incoming > 0 && matched === 0) lines.push('No matching words. Choose the matching deck or add its CSV first.');
  else if (incoming > matched) lines.push(`${incoming - matched} unmatched card states will be kept for a corrected CSV.`);
  lines.push(`Replaces ${pendingImport.tracks.map(modeLabel).join(' and ')} progress for this deck.`);
  if (pendingImport.tracks.length === 1) lines.push('Listening progress is kept.');
  $('import-summary').textContent = lines.join('\n');
  $('confirm-import').disabled = locked || (incoming > 0 && matched === 0);
}
async function readProgress(file) {
  if (!state || locked) return;
  if (file.size > 25000000) throw new Error('Progress file is too large (25 MB maximum).');
  const raw = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Choose a full backup or a Python v2/v3 progress JSON.');
  $('target-deck-field').hidden = true; $('confirm-import').disabled = false;
  if (raw.format === BACKUP_FORMAT) {
    const imported = parseBackup(raw);
    pendingImport = { kind: 'backup', state: imported };
    $('import-title').textContent = 'Restore full backup';
    $('import-description').textContent = `Replace all current decks and progress with “${file.name}”.`;
    $('import-summary').textContent = imported.decks.map(d => `${deckLabel(d)} · ${d.cards.length} cards · both modes`).join('\n');
  } else {
    const named = typeof raw.deck === 'string' ? state.decks.find(d => d.id === deckId(raw.deck)) : null;
    const target = named ?? currentDeck;
    const doc = normalizeProgress(raw, target.name);
    const tracks = raw.tracks ? TRACKS.filter(t => raw.tracks[t] !== undefined) : ['flashcards'];
    pendingImport = { kind: 'progress', document: doc, tracks };
    $('import-title').textContent = 'Import Python progress';
    $('import-description').textContent = `Import “${file.name}”. Your ratings, scores, due dates, and selection settings are preserved.`;
    $('target-deck-field').hidden = false;
    $('import-target').replaceChildren(...state.decks.map(d => new Option(deckLabel(d), d.id)));
    $('import-target').value = target.id; importSummary();
  }
  $('confirm-import').textContent = 'Import progress'; showDialog('import-dialog');
}
async function readCSVs(files) {
  if (!state || locked || !files.length) return;
  if (files.length > 50) throw new Error('Add up to 50 decks at a time.');
  const decks = [], ids = new Set();
  for (const file of files) {
    if (!/\.csv$/i.test(file.name) || file.name.length > 240 || /[\/\\]/.test(file.name)) throw new Error('Choose a file ending in .csv.');
    const id = deckId(file.name);
    if (ids.has(id)) throw new Error('Two selected files have the same deck name. Add them separately.');
    ids.add(id);
    if (file.size > 15000000) throw new Error('CSV is too large (15 MB maximum).');
    const parsed = parseCSV(await file.text());
    decks.push({ id, name: file.name, cards: parsed.cards, skipped: parsed.skipped });
  }
  pendingImport = { kind: 'csv', decks };
  $('import-title').textContent = decks.length > 1 ? 'Add your decks' : 'Add your deck';
  $('import-description').textContent = 'The first two CSV columns are Dutch and meaning. A header row is required.';
  $('target-deck-field').hidden = true;
  $('import-summary').textContent = decks.map(d => `${d.name} · ${d.cards.length} cards${d.skipped ? ` · ${d.skipped} empty/duplicate rows skipped` : ''}\n${state.decks.some(old => old.id === d.id) ? 'Updates this deck. Matching progress is kept in both modes; unmatched states are retained.' : 'New deck, with separate progress for each mode.'}`).join('\n\n');
  $('confirm-import').disabled = false; $('confirm-import').textContent = 'Add CSV deck' + (decks.length > 1 ? 's' : '');
  showDialog('import-dialog');
}
async function applyImport() {
  if (!pendingImport || locked || $('confirm-import').disabled) return;
  scheduler.save(); const previous = restorePoint(state);
  if (pendingImport.kind === 'backup') state = pendingImport.state;
  else if (pendingImport.kind === 'progress') {
    const deck = state.decks.find(d => d.id === $('import-target').value), doc = clone(pendingImport.document);
    reconcileProgress(doc, deck.cards);
    for (const t of pendingImport.tracks) deck.progress.tracks[t] = doc.tracks[t];
    state.ui.deck = deck.id;
  } else {
    for (const imported of pendingImport.decks) {
      let deck = state.decks.find(d => d.id === imported.id);
      if (deck) { deck.cards = imported.cards; reconcileProgress(deck.progress, deck.cards); }
      else { deck = { id: imported.id, name: imported.name, cards: imported.cards, progress: freshDocument(imported.name) }; state.decks.push(deck); }
      state.ui.deck = deck.id;
    }
  }
  state.restorePoint = previous; pendingImport = null; $('import-dialog').close();
  audioStarted = false; activate();
  if (await persist()) toast('Imported and saved. Undo is available in Settings.');
}
async function undoImport() {
  if (!state?.restorePoint || locked) return;
  state = state.restorePoint; state.restorePoint = null; audioStarted = false; activate();
  $('undo-import').hidden = true;
  if (await persist()) toast('Previous decks and progress restored.');
}
function showReset() {
  if (!state || locked) return;
  $('confirm-title').textContent = 'Reset this mode?';
  $('confirm-description').textContent = `Reset ${modeLabel(state.ui.mode)} for “${deckLabel(currentDeck)}”? Your other decks and practice mode are kept. You can undo this in Settings.`;
  showDialog('confirm-dialog');
}
async function resetMode() {
  if (!state || locked) return;
  state.restorePoint = restorePoint(state); scheduler.reset(); $('confirm-dialog').close(); showNext();
  if (await persist()) toast('This mode was reset. Undo is available in Settings.');
}
function renderConnection() {
  const online = navigator.onLine;
  const label = !online ? offlineReady ? 'Offline · ready' : 'Offline' : offlineReady ? 'Ready offline' : 'Preparing offline';
  $('connection').querySelector('span').textContent = label;
  $('connection').classList.toggle('offline', !online);
  $('offline-detail').textContent = offlineReady ? 'The app and both bundled decks are saved for offline use. Imported decks and progress stay on this device. Speech needs an installed Dutch voice.' : 'Open the hosted HTTPS app while online and wait for “Ready offline”. Offline caching may be unavailable in a chat preview or Private Browsing.';
}
async function setupOffline() {
  renderConnection();
  if (!('serviceWorker' in navigator) || !isSecureContext || location.protocol === 'file:') {
    $('offline-detail').textContent = 'Install from an HTTPS address. Opening index.html directly cannot enable offline mode.'; return;
  }
  try {
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'CACHE_STATUS') { offlineReady = event.data.ready === true; renderConnection(); }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloadForUpdate) location.reload();
      else navigator.serviceWorker.controller?.postMessage({ type: 'CACHE_STATUS' });
    });
    registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    const showUpdate = () => { if (registration.waiting && navigator.serviceWorker.controller) $('update-banner').hidden = false; };
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') showUpdate(); });
    });
    const active = await navigator.serviceWorker.ready;
    active.active?.postMessage({ type: 'CACHE_STATUS' });
  } catch (error) {
    $('connection').querySelector('span').textContent = 'Online only';
    $('offline-detail').textContent = 'Offline preparation did not finish. Connect to the internet and reload the hosted app in Safari.';
  }
}
function bindEvents() {
  $('flash-face').addEventListener('click', reveal); $('reveal-answer').addEventListener('click', reveal);
  $('play-audio').addEventListener('click', () => playAudio()); $('slow-audio').addEventListener('click', () => playAudio(true));
  $('dictation-form').addEventListener('submit', event => { event.preventDefault(); checkSpelling(); });
  $('show-spelling').addEventListener('click', () => checkSpelling(true));
  document.querySelectorAll('[data-rating]').forEach(b => b.addEventListener('click', () => rate(Number(b.dataset.rating))));
  $('mode-flashcards').addEventListener('click', () => switchMode('flashcards')); $('mode-listening').addEventListener('click', () => switchMode('listening'));
  $('selection-normal').addEventListener('click', () => setSelection(false)); $('selection-mix').addEventListener('click', () => setSelection(true));
  $('deck-select').addEventListener('change', () => { if (!state || locked) return; scheduler.save(); state.ui.deck = $('deck-select').value; activate(true); void persist(); });
  $('open-settings').addEventListener('click', () => showDialog('settings-dialog'));
  document.querySelectorAll('.close-dialog').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
  $('install-help').addEventListener('click', () => showDialog('install-dialog')); $('show-install').addEventListener('click', () => showDialog('install-dialog'));
  $('voice-select').addEventListener('change', () => { if (!state || locked) return; state.ui.voice = $('voice-select').value; speech.voiceURI = state.ui.voice; renderVoices(); void persist(); });
  $('speech-rate').addEventListener('change', () => { if (!state || locked) return; state.ui.rate = Number($('speech-rate').value); speech.rate = state.ui.rate; void persist(); });
  $('autoplay').addEventListener('change', () => { if (!state || locked) return; state.ui.autoplay = $('autoplay').checked; void persist(); });
  $('test-voice').addEventListener('click', () => { audioStarted = true; speech.speak('Goedemorgen'); });
  $('export-all').addEventListener('click', exportAll); $('emergency-export').addEventListener('click', exportAll);
  $('export-python').addEventListener('click', () => { if (!currentDeck) return; scheduler.save(); downloadFile(currentDeck.name.replace(/\.csv$/i, '.json'), JSON.stringify(currentDeck.progress, null, 2)); });
  $('export-csv').addEventListener('click', () => { if (currentDeck) downloadFile(currentDeck.name, toCSV(currentDeck.cards), 'text/csv'); });
  $('import-progress').addEventListener('click', () => { if (!locked) $('progress-file').click(); });
  $('add-deck').addEventListener('click', () => { if (!locked) $('csv-file').click(); });
  $('progress-file').addEventListener('change', async () => { try { const f = $('progress-file').files[0]; if (f) await readProgress(f); } catch (e) { toast(e.message); } finally { $('progress-file').value = ''; } });
  $('csv-file').addEventListener('change', async () => { try { await readCSVs(Array.from($('csv-file').files)); } catch (e) { toast(e.message); } finally { $('csv-file').value = ''; } });
  $('import-target').addEventListener('change', importSummary); $('confirm-import').addEventListener('click', () => void applyImport());
  $('cancel-import').addEventListener('click', () => { pendingImport = null; $('import-dialog').close(); });
  $('undo-import').addEventListener('click', () => void undoImport()); $('reset-mode').addEventListener('click', showReset);
  $('confirm-cancel').addEventListener('click', () => $('confirm-dialog').close()); $('confirm-action').addEventListener('click', () => void resetMode());
  $('reload-app').addEventListener('click', () => location.reload());
  $('persist-storage').addEventListener('click', async () => {
    try {
      const granted = await navigator.storage?.persist?.();
      $('persistence-status').textContent = granted ? 'Persistent storage is enabled. Keep regular exported backups too.' : 'Your browser manages storage automatically. Adding to Home Screen and exporting backups helps keep your progress safe.';
    } catch { $('persistence-status').textContent = 'Storage is managed by this browser. Export a backup to keep a copy.'; }
  });
  $('apply-update').addEventListener('click', async () => {
    if (registration?.waiting && !locked && await persist()) { reloadForUpdate = true; registration.waiting.postMessage({ type: 'SKIP_WAITING' }); }
  });
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; $('native-install').hidden = false; });
  $('native-install').addEventListener('click', async () => { if (installPrompt) { await installPrompt.prompt(); installPrompt = null; $('native-install').hidden = true; } });
  window.addEventListener('online', renderConnection); window.addEventListener('offline', renderConnection);
  window.addEventListener('pagehide', () => speech?.stop());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') speech?.stop(); else { renderStats(); renderConnection(); } });
  document.addEventListener('keydown', event => {
    if (!scheduler || locked || event.repeat || event.metaKey || event.ctrlKey || event.altKey || document.querySelector('dialog[open]')) return;
    const target = event.target, typing = target instanceof Element && (target.closest('input,textarea,select') || target.isContentEditable);
    if (typing) return;
    // Native Enter/Space on a focused button must not trigger a second action.
    if (target instanceof Element && target.closest('button,a') && ['Enter',' '].includes(event.key)) return;
    if (/^[1-4]$/.test(event.key)) { event.preventDefault(); rate(Number(event.key) - 1); }
    else if (event.key.toLowerCase() === 'l') { event.preventDefault(); playAudio(); }
    else if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (state.ui.mode === 'flashcards') reveal(); else if (event.key === ' ') playAudio(); else checkSpelling(); }
  });
}
async function boot() {
  bindEvents();
  speech = new DutchSpeech({ status: audioStatus, voicesChanged: () => renderVoices() });
  void setupOffline();
  try {
    db = await new ProgressDB().open();
    state = await db.load();
    if (!state) state = await loadBundled();
    else {
      const savedRestorePoint = state.restorePoint;
      state = parseBackup(makeBackup(state)); state.restorePoint = savedRestorePoint;
    }
    activate(); renderVoices();
    $('main-content').setAttribute('aria-busy', 'false');
    await persist();
  } catch (error) { block(error); $('main-content').setAttribute('aria-busy', 'false'); }
}
void boot();
