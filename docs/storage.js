import { clone, freshDocument, normalizeProgress, validateCards, deckId, reconcileProgress } from './core.js';
export const BACKUP_FORMAT = 'dutch-daily-backup';
export const defaultUI = () => ({ deck: '500_common_dutch_flashcards.csv', mode: 'flashcards', autoplay: false, voice: '', rate: 0.9 });
export function makeBackup(state) {
  return { format: BACKUP_FORMAT, version: 1, exported_at: new Date().toISOString(), decks: clone(state.decks), ui: clone(state.ui) };
}
export function parseBackup(raw) {
  if (raw?.format !== BACKUP_FORMAT || raw.version !== 1 || !Array.isArray(raw.decks) || !raw.decks.length || raw.decks.length > 200) {
    throw new Error('Not a supported Dutch, daily backup.');
  }
  const ids = new Set();
  const decks = raw.decks.map(deck => {
    if (typeof deck.name !== 'string' || !deck.name.toLowerCase().endsWith('.csv') || deck.name.length > 240 || /[\/\\]/.test(deck.name)) throw new Error('Invalid CSV deck name.');
    const id = deckId(deck.name);
    if (ids.has(id)) throw new Error('Backup contains duplicate decks.');
    ids.add(id);
    const cards = validateCards(deck.cards), progress = normalizeProgress(deck.progress, deck.name);
    reconcileProgress(progress, cards);
    return { id, name: deck.name, cards, progress };
  });
  const ui = { ...defaultUI(), ...Object.fromEntries(Object.entries(raw.ui ?? {}).filter(([k]) => Object.hasOwn(defaultUI(), k))) };
  if (!decks.some(d => d.id === ui.deck)) ui.deck = decks[0].id;
  if (!['flashcards', 'listening'].includes(ui.mode)) ui.mode = 'flashcards';
  ui.autoplay = !!ui.autoplay; ui.voice = typeof ui.voice === 'string' ? ui.voice : '';
  ui.rate = typeof ui.rate === 'number' && Number.isFinite(ui.rate) ? Math.max(0.5, Math.min(1.2, ui.rate)) : 0.9;
  return { schema: 1, decks, ui, restorePoint: null };
}
export function restorePoint(state) { const snapshot = clone(state); snapshot.restorePoint = null; return snapshot; }
export class ProgressDB {
  constructor(factory = globalThis.indexedDB) { this.factory = factory; this.db = null; this.revision = 0; this.queue = Promise.resolve(); }
  async open() {
    if (!this.factory) throw new Error('This browser cannot save study progress. Open the app in Safari outside Private Browsing.');
    this.db = await new Promise((resolve, reject) => {
      const request = this.factory.open('dutch-daily', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other copies of the app and try again.'));
    });
    this.db.onversionchange = () => this.db.close();
    return this;
  }
  async load() {
    const record = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('state', 'readonly'), request = tx.objectStore('state').get('main');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    this.revision = record?.revision ?? 0;
    return record?.data ?? null;
  }
  save(data) {
    const snapshot = clone(data);
    const result = this.queue.then(() => new Promise((resolve, reject) => {
      const tx = this.db.transaction('state', 'readwrite'), store = tx.objectStore('state');
      let conflict = false;
      const read = store.get('main');
      read.onsuccess = () => {
        if ((read.result?.revision ?? 0) !== this.revision) { conflict = true; tx.abort(); return; }
        store.put({ revision: this.revision + 1, data: snapshot }, 'main');
      };
      tx.oncomplete = () => { this.revision++; resolve(); };
      tx.onerror = tx.onabort = () => reject(conflict
        ? new Error('Progress changed in another tab. Export this session as a backup, then reload to continue.')
        : new Error('Progress could not be saved. Export a backup before closing the app, then free some device storage.'));
    }));
    // A failed write blocks all subsequent writes until the page is reloaded.
    this.queue = result;
    return result;
  }
}
export async function loadBundled(fetcher = fetch) {
  const names = ['500_common_dutch_flashcards.csv', '100_common_dutch_phrases.csv'];
  const { parseCSV } = await import('./core.js');
  const decks = await Promise.all(names.map(async name => {
    const stem = name.slice(0, -4);
    const [csv, json] = await Promise.all([fetcher(`./decks/${name}`), fetcher(`./progress/${stem}.json`)]);
    if (!csv.ok || !json.ok) throw new Error('The bundled decks could not load. Connect to the internet and reload.');
    const cards = parseCSV(await csv.text()).cards;
    const progress = normalizeProgress(await json.json(), name);
    reconcileProgress(progress, cards);
    return { id: deckId(name), name, cards, progress };
  }));
  return { schema: 1, decks, ui: defaultUI(), restorePoint: null };
}
