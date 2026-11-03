import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadBundled, makeBackup, parseBackup, ProgressDB, restorePoint } from '../docs/storage.js';
import { Scheduler, clone } from '../docs/core.js';
import { profileWorkspace, currentProfile, addProfile, renameProfile } from '../docs/profiles.js';
import { FakeIDB } from './fake-indexeddb.mjs';

const fresh = () => loadBundled(async path => new Response(readFileSync(new URL('../docs/' + path.slice(2), import.meta.url))));

test('single-profile migration preserves both modes, settings, decks, and the undo point', async () => {
  const old = await fresh(), deck = old.decks[0];
  for (const mode of ['flashcards', 'listening']) {
    const scheduler = new Scheduler(deck.cards, deck.progress, mode);
    scheduler.nextWord(); scheduler.answer(3); scheduler.setReviewEverything(true);
  }
  old.restorePoint = restorePoint(await fresh());
  const snapshot = clone(old), workspace = profileWorkspace(old);
  assert.equal(workspace.schema, 2); assert.equal(workspace.profiles.length, 1);
  assert.deepEqual(currentProfile(workspace).data, snapshot); assert.deepEqual(old, snapshot);
});

test('two learners have independent progress after save, reload, backup restore, and reset', async () => {
  const workspace = profileWorkspace(await fresh()), first = currentProfile(workspace);
  const friend = addProfile(workspace, 'Friend', await fresh(), 'friend');
  const ownDeck = first.data.decks[0], otherDeck = friend.data.decks[0];
  const scheduler = new Scheduler(ownDeck.cards, ownDeck.progress, 'flashcards');
  scheduler.nextWord(); for (let i = 0; i < 4; i++) scheduler.answer(3);
  assert.equal(scheduler.stats().review, 1); assert.deepEqual(otherDeck.progress.tracks.flashcards.cards, {});
  workspace.activeProfile = friend.id;
  const secondScheduler = new Scheduler(otherDeck.cards, otherDeck.progress, 'listening');
  secondScheduler.setReviewEverything(true); secondScheduler.nextWord(); secondScheduler.answer(1);
  const idb = new FakeIDB(), db = await new ProgressDB(idb).open(); await db.load(); await db.save(workspace);
  const reopened = await new ProgressDB(idb).open(), saved = profileWorkspace(await reopened.load());
  assert.equal(currentProfile(saved).name, 'Friend'); assert.equal(saved.profiles.length, 2);
  const ownBefore = clone(saved.profiles[0].data);
  currentProfile(saved).data = parseBackup(makeBackup(await fresh()));
  new Scheduler(currentProfile(saved).data.decks[0].cards, currentProfile(saved).data.decks[0].progress, 'flashcards').reset();
  assert.deepEqual(saved.profiles[0].data, ownBefore);
});

test('invalid or duplicate profile names never mutate the saved profiles', async () => {
  const workspace = profileWorkspace(await fresh()), starter = await fresh();
  addProfile(workspace, ' Friend ', starter, 'friend');
  const before = clone(workspace);
  for (const name of ['', '  ', 'FRIEND', '\u0000oops', 'a'.repeat(41)]) assert.throws(() => addProfile(workspace, name, starter, 'invalid'));
  assert.throws(() => renameProfile(workspace, 'friend')); assert.deepEqual(workspace, before);
  renameProfile(workspace, 'Benjamin'); assert.equal(currentProfile(workspace).name, 'Benjamin');
  assert.equal(workspace.profiles[1].name, 'Friend');
  const invalid = clone(workspace); invalid.activeProfile = 'missing'; assert.throws(() => profileWorkspace(invalid));
});
