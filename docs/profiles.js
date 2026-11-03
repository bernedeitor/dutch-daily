import { makeBackup, parseBackup } from './storage.js';

export function profileName(value) {
  if (typeof value !== 'string') throw new Error('Enter a profile name.');
  const name = value.normalize('NFC').trim();
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Use a profile name between 1 and 40 characters.');
  return name;
}

function studyState(raw) {
  const state = parseBackup(makeBackup(raw));
  if (raw.restorePoint) state.restorePoint = parseBackup(makeBackup(raw.restorePoint));
  return state;
}

// Migrate the original single-learner database in place, including its undo point.
export function profileWorkspace(raw) {
  if (raw?.schema !== 2) {
    return { schema: 2, activeProfile: 'default', profiles: [{ id: 'default', name: 'My progress', data: studyState(raw) }] };
  }
  if (!Array.isArray(raw.profiles) || !raw.profiles.length || raw.profiles.length > 50) throw new Error('Invalid saved profiles.');
  const ids = new Set(), names = new Set();
  const profiles = raw.profiles.map(profile => {
    if (typeof profile.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(profile.id) || ids.has(profile.id)) throw new Error('Invalid saved profile identifier.');
    const name = profileName(profile.name), key = name.toLowerCase();
    if (names.has(key)) throw new Error('Saved profile names must be different.');
    ids.add(profile.id); names.add(key);
    return { id: profile.id, name, data: studyState(profile.data) };
  });
  if (!ids.has(raw.activeProfile)) throw new Error('The selected profile could not be found.');
  return { schema: 2, activeProfile: raw.activeProfile, profiles };
}

export function currentProfile(workspace) {
  const profile = workspace.profiles.find(p => p.id === workspace.activeProfile);
  if (!profile) throw new Error('Select an existing profile.');
  return profile;
}

function availableName(workspace, value, exceptId) {
  const name = profileName(value);
  if (workspace.profiles.some(p => p.id !== exceptId && p.name.toLowerCase() === name.toLowerCase())) throw new Error('That profile already exists. Choose another name or switch to it.');
  return name;
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function addProfile(workspace, value, starter, id = newId()) {
  if (workspace.profiles.length >= 50) throw new Error('This device already has 50 profiles.');
  const name = availableName(workspace, value);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || workspace.profiles.some(p => p.id === id)) throw new Error('Could not create a unique profile. Try again.');
  const profile = { id, name, data: studyState(starter) };
  workspace.profiles.push(profile);
  return profile;
}

export function renameProfile(workspace, value) {
  const profile = currentProfile(workspace);
  profile.name = availableName(workspace, value, profile.id);
}
