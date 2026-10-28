// Scheduler port of dutch_flashcards(4).py. No browser dependencies.
export const ACTIVE_POOL_SIZE = 20;
export const TRACKS = ['flashcards', 'listening'];
export const clone = value => JSON.parse(JSON.stringify(value));
export const casefold = text => text.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ');
export const defaultSettings = () => ({ learning_cards_since_review: 0, review_everything: false });
export const defaultState = (status = 'unseen') => ({
  status, score: 1.5, reviews: 0, interval_days: 0, due_at: null,
  last_seen_at: null, ratings: [0, 0, 0, 0],
});
export function freshDocument(deck, now = new Date()) {
  return { version: 3, deck, saved_at: now.toISOString(), tracks: Object.fromEntries(
    TRACKS.map(track => [track, { settings: defaultSettings(), cards: {} }])) };
}
export function parseTime(value) {
  if (!value || typeof value !== 'string') return null;
  // Python's timezone-less datetime strings are UTC, not the device's timezone.
  let text = value.trim().replace(/^(\d{4}-\d\d-\d\d) /, '$1T');
  if (/^\d{4}-\d\d-\d\d$/.test(text)) text += 'T00:00:00Z';
  else if (!/(Z|[+-]\d\d:\d\d)$/i.test(text)) text += 'Z';
  // Python writes microseconds; normalize to the ECMAScript millisecond format.
  text = text.replace(/(\.\d{3})\d+(?=Z|[+-]\d\d:\d\d$)/i, '$1');
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}
function rounded(value, digits) {
  return Number(value.toFixed(digits));
}
function finite(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid ${label} in progress file.`);
  }
  return value;
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function normalizeProgress(input, deckName) {
  if (!object(input)) throw new Error('Expected a Python v2/v3 progress document.');
  let data = clone(input);
  if (object(data.cards) && !data.tracks) {
    data = { ...freshDocument(deckName), tracks: {
      flashcards: { settings: data.settings ?? defaultSettings(), cards: data.cards },
      listening: { settings: defaultSettings(), cards: {} },
    } };
  }
  if (!object(data.tracks) || !TRACKS.some(t => object(data.tracks[t]))) {
    throw new Error('This JSON is not a supported progress file.');
  }
  const doc = freshDocument(deckName);
  doc.saved_at = typeof data.saved_at === 'string' ? data.saved_at : doc.saved_at;
  for (const name of TRACKS) {
    const track = data.tracks[name];
    if (track === undefined) continue;
    if (!object(track) || !object(track.cards ?? {})) throw new Error(`Invalid ${name} track.`);
    const settings = track.settings ?? {};
    const count = settings.learning_cards_since_review ?? 0;
    finite(count, 'review counter');
    if (!Number.isInteger(count)) throw new Error('Invalid review counter.');
    if (settings.review_everything !== undefined && typeof settings.review_everything !== 'boolean') {
      throw new Error('Invalid selection setting.');
    }
    doc.tracks[name].settings = { learning_cards_since_review: count, review_everything: settings.review_everything ?? false };
    const cards = [];
    for (const [word, saved] of Object.entries(track.cards ?? {})) {
      if (!word || word.length > 10000 || !object(saved)) throw new Error('Invalid card in progress file.');
      const state = { ...defaultState(), ...Object.fromEntries(
        Object.entries(saved).filter(([key]) => Object.hasOwn(defaultState(), key))) };
      if (!['unseen', 'learning', 'review'].includes(state.status)) throw new Error(`Unknown card status for “${word}”.`);
      finite(state.score, 'score', 0, 3);
      finite(state.reviews, 'review count');
      finite(state.interval_days, 'interval');
      if (!Number.isInteger(state.reviews)) throw new Error('Review counts must be whole numbers.');
      if (!Array.isArray(state.ratings) || state.ratings.length !== 4 || state.ratings.some(n => !Number.isInteger(n) || n < 0)) {
        throw new Error(`Invalid rating history for “${word}”.`);
      }
      for (const key of ['due_at', 'last_seen_at']) {
        if (state[key] !== null && (typeof state[key] !== 'string' || parseTime(state[key]) === null)) {
          throw new Error(`Invalid ${key} for “${word}”.`);
        }
      }
      cards.push([word, state]);
    }
    doc.tracks[name].cards = Object.fromEntries(cards);
  }
  return doc;
}
export function normalizedDictation(text) {
  return casefold(text.trim()).normalize('NFC').replace(/\s+/gu, ' ').replace(/[.!?…]+$/u, '').trim();
}
export function validateCards(cards) {
  if (!Array.isArray(cards) || !cards.length || cards.length > 50000) throw new Error('A deck must contain 1–50,000 cards.');
  const seen = new Set();
  return cards.map(card => {
    if (!object(card) || typeof card.word !== 'string' || typeof card.meaning !== 'string') throw new Error('Invalid deck card.');
    const word = card.word.trim(), meaning = card.meaning.trim(), key = casefold(word);
    if (!word || !meaning || word.length > 10000 || meaning.length > 20000 || seen.has(key)) throw new Error('Empty or duplicate card in deck.');
    seen.add(key);
    return { word, meaning };
  });
}
export function parseCSV(raw) {
  if (typeof raw !== 'string' || raw.length > 15000000) throw new Error('CSV is too large (15 MB maximum).');
  const text = raw.replace(/^\uFEFF/, '');
  // Detect Excel's semicolon/tab delimiter only in the unquoted header.
  const header = text.split(/\r?\n/, 1)[0];
  let quoted = false;
  const counts = { ',': 0, ';': 0, '\t': 0 };
  for (let i = 0; i < header.length; i++) {
    if (header[i] === '"') { if (quoted && header[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted && Object.hasOwn(counts, header[i])) counts[header[i]]++;
  }
  const delimiter = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = [];
  let row = [], field = '', inQuotes = false, endedQuote = false;
  const endField = () => { row.push(field); field = ''; endedQuote = false; };
  const endRow = () => { endField(); if (row.some(value => value.trim())) rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; endedQuote = true; }
      } else field += char;
    } else if (char === '"' && !field && !endedQuote) inQuotes = true;
    else if (char === delimiter) endField();
    else if (char === '\n' || char === '\r') { endRow(); if (char === '\r' && text[i + 1] === '\n') i++; }
    else if (endedQuote) { if (!/\s/.test(char)) throw new Error('Malformed CSV after a closing quote.'); }
    else field += char;
  }
  if (inQuotes) throw new Error('CSV contains an unclosed quotation mark.');
  if (field || row.length || endedQuote) endRow();
  if (!rows.length || rows[0].length < 2) throw new Error('CSV needs a header and at least two columns: Dutch, meaning.');
  const seen = new Set(), cards = [];
  let skipped = 0;
  for (const row of rows.slice(1)) {
    const word = (row[0] ?? '').trim(), meaning = (row[1] ?? '').trim(), key = casefold(word);
    if (!word || !meaning || seen.has(key)) { skipped++; continue; }
    seen.add(key); cards.push({ word, meaning });
  }
  return { cards: validateCards(cards), skipped };
}
export function toCSV(cards) {
  const quote = value => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  return '\uFEFFDutch,Meaning\r\n' + cards.map(c => `${quote(c.word)},${quote(c.meaning)}`).join('\r\n') + '\r\n';
}
export const deckId = name => name.normalize('NFC').toLowerCase();
export function reconcileProgress(doc, cards) {
  // Exact spelling first; NFC/case fallback permits harmless CSV casing edits.
  // Unmatched states are retained for a later corrected CSV, never discarded.
  let matched = 0, total = 0;
  for (const name of TRACKS) {
    const state = doc.tracks[name].cards;
    const folded = new Map(Object.keys(state).map(w => [casefold(w.normalize('NFC')), w]));
    for (const card of cards) {
      let key = Object.hasOwn(state, card.word) ? card.word : folded.get(casefold(card.word.normalize('NFC')));
      if (key !== undefined) {
        matched++;
        if (key !== card.word) Object.defineProperty(state, card.word, { value: clone(state[key]), enumerable: true, writable: true, configurable: true });
      }
    }
    total += Object.keys(state).length;
  }
  return { matched, total };
}
export class Scheduler {
  constructor(cards, document, trackName, { now = () => new Date(), random = Math.random } = {}) {
    this.cards = cards; this.document = document; this.trackName = trackName;
    this.track = document.tracks[trackName]; this.state = this.track.cards;
    this.now = now; this.random = random; this.currentWord = null; this.sessionAnswers = 0;
    this.counter = Math.max(0, this.track.settings.learning_cards_since_review ?? 0);
    this.reviewEverything = !!this.track.settings.review_everything;
    for (const { word } of cards) {
      if (!Object.hasOwn(this.state, word)) Object.defineProperty(this.state, word, {
        value: defaultState(), enumerable: true, writable: true, configurable: true,
      });
    }
    this.fillLearningPool(); this.save();
  }
  words(status) { return this.cards.map(c => c.word).filter(w => this.state[w].status === status); }
  fillLearningPool() {
    const unseen = this.words('unseen'), needed = Math.max(0, ACTIVE_POOL_SIZE - this.words('learning').length);
    for (let n = 0; n < Math.min(needed, unseen.length); n++) {
      const i = n + Math.floor(this.random() * (unseen.length - n));
      [unseen[n], unseen[i]] = [unseen[i], unseen[n]];
      this.state[unseen[n]] = defaultState('learning');
    }
  }
  dueWords() {
    const now = this.now().getTime();
    return this.words('review').filter(w => { const due = parseTime(this.state[w].due_at); return due === null || due <= now; });
  }
  save() {
    this.track.settings = { learning_cards_since_review: this.counter, review_everything: this.reviewEverything };
    this.document.saved_at = this.now().toISOString();
  }
  nextWord() {
    const learning = this.words('learning'), learned = this.words('review'), due = this.dueWords();
    let candidates;
    if (this.reviewEverything) candidates = learning.concat(learned);
    else if (learned.length && this.counter >= 4) { candidates = due.length ? due : learned; this.counter = 0; }
    else if (learning.length) { candidates = learning; if (learned.length) this.counter++; }
    else candidates = due.length ? due : learned;
    if (!candidates.length) throw new Error('There are no cards available.');
    if (candidates.length > 1 && candidates.includes(this.currentWord)) candidates = candidates.filter(w => w !== this.currentWord);
    this.currentWord = candidates[Math.floor(this.random() * candidates.length)];
    // Persist the selection counter even if iOS closes the app before a rating.
    this.save();
    return this.currentWord;
  }
  answer(rating) {
    if (this.currentWord === null || !Number.isInteger(rating) || rating < 0 || rating > 3) return;
    const data = this.state[this.currentWord], now = this.now();
    data.score = rounded(Math.max(0, Math.min(3, data.reviews === 0 ? rating : 0.7 * data.score + 0.30 * rating)), 4);
    data.reviews++; data.ratings[rating]++; data.last_seen_at = now.toISOString(); this.sessionAnswers++;
    const wasReview = data.status === 'review', due = parseTime(data.due_at);
    const wasDue = wasReview && (due === null || due <= now.getTime());
    if (rating === 0) { data.status = 'learning'; data.interval_days = 0; data.due_at = null; }
    else if (data.reviews >= 4 && data.score >= 2.4) {
      data.status = 'review';
      const old = Math.max(0, data.interval_days);
      const interval = !wasReview || old === 0 ? [0, 1, 2, 4][rating] : wasDue ? old * [0, 1.25, 2, 2.8][rating] : null;
      if (interval !== null) {
        data.interval_days = rounded(Math.min(180, interval), 2);
        // Match the source's due timestamp, including its uncapped date arithmetic.
        data.due_at = new Date(now.getTime() + interval * 86400000).toISOString();
      }
    }
    this.fillLearningPool(); this.save();
  }
  stats() { return { learning: this.words('learning').length, review: this.words('review').length, unseen: this.words('unseen').length, due: this.dueWords().length }; }
  setReviewEverything(enabled) { this.reviewEverything = !!enabled; this.save(); }
  reset() {
    for (const { word } of this.cards) this.state[word] = defaultState();
    this.currentWord = null; this.sessionAnswers = 0; this.counter = 0; this.reviewEverything = false;
    this.fillLearningPool(); this.save();
  }
}
