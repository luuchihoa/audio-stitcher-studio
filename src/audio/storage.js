import { getAudioContext } from './audioContext.js';
import { extractWaveformData } from './decoder.js';

const DB_NAME = 'AudioStitcherStudioDB';
const DB_VERSION = 1;
const STORE_NAME = 'project_session';
const SESSION_KEY = 'current_project';

/**
 * Opens and initializes IndexedDB
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Serializes an AudioBuffer to an array of Float32Array channel buffers
 */
function serializeAudioBuffer(audioBuffer) {
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;
  const channels = [];

  for (let ch = 0; ch < numChannels; ch++) {
    // Clone Float32Array buffer
    const channelData = audioBuffer.getChannelData(ch);
    channels.push(new Float32Array(channelData));
  }

  return {
    numChannels,
    sampleRate,
    length,
    duration: audioBuffer.duration,
    channels
  };
}

/**
 * Deserializes channel data back into a live AudioBuffer
 */
function deserializeAudioBuffer(serialized) {
  const ctx = getAudioContext();
  const buffer = ctx.createBuffer(
    serialized.numChannels,
    serialized.length,
    serialized.sampleRate
  );

  for (let ch = 0; ch < serialized.numChannels; ch++) {
    const channelData = buffer.getChannelData(ch);
    channelData.set(serialized.channels[ch]);
  }

  return buffer;
}

let saveTimeout = null;

/**
 * Saves current application state into IndexedDB with automatic debouncing
 * @param {Object} state
 * @param {Function} [onSavedCallback]
 */
export function autoSaveProject(state, onSavedCallback) {
  if (saveTimeout) clearTimeout(saveTimeout);

  saveTimeout = setTimeout(async () => {
    try {
      if (!state.tracks || state.tracks.length === 0) {
        await clearSavedProject();
        if (onSavedCallback) onSavedCallback(true, 0);
        return;
      }

      const serializedTracks = state.tracks.map(t => ({
        id: t.id,
        name: t.name,
        duration: t.duration,
        trimStart: t.trimStart || 0,
        trimEnd: t.trimEnd ?? t.duration,
        volume: t.volume ?? 1,
        muted: t.muted || false,
        fadeIn: t.fadeIn || 0,
        fadeOut: t.fadeOut || 0,
        silenceAfter: t.silenceAfter || 0,
        waveformPeaks: Array.from(t.waveformPeaks || []),
        serializedBuffer: serializeAudioBuffer(t.audioBuffer)
      }));

      const payload = {
        tracks: serializedTracks,
        globalOptions: state.globalOptions || { crossfade: 0, normalizeAll: false },
        savedAt: Date.now()
      };

      const db = await openDB();
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(payload, SESSION_KEY);

      tx.oncomplete = () => {
        if (onSavedCallback) onSavedCallback(true, state.tracks.length);
      };
      tx.onerror = (err) => {
        console.warn('Auto-save transaction error:', err);
        if (onSavedCallback) onSavedCallback(false, 0);
      };
    } catch (err) {
      console.warn('Could not auto-save project to IndexedDB:', err);
      if (onSavedCallback) onSavedCallback(false, 0);
    }
  }, 400); // 400ms debounce
}

/**
 * Restores project state from IndexedDB
 * @returns {Promise<Object|null>}
 */
export async function loadSavedProject() {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(SESSION_KEY);

      request.onsuccess = () => {
        const data = request.result;
        if (!data || !data.tracks || data.tracks.length === 0) {
          resolve(null);
          return;
        }

        try {
          const restoredTracks = data.tracks.map(t => {
            const buffer = deserializeAudioBuffer(t.serializedBuffer);
            const peaks = t.waveformPeaks?.length > 0 
              ? new Float32Array(t.waveformPeaks) 
              : extractWaveformData(buffer, 120).peaks;

            return {
              id: t.id,
              name: t.name,
              file: null,
              audioBuffer: buffer,
              duration: buffer.duration,
              trimStart: t.trimStart,
              trimEnd: t.trimEnd,
              volume: t.volume,
              muted: t.muted,
              fadeIn: t.fadeIn,
              fadeOut: t.fadeOut,
              silenceAfter: t.silenceAfter,
              waveformPeaks: peaks
            };
          });

          resolve({
            tracks: restoredTracks,
            globalOptions: data.globalOptions || { crossfade: 0, normalizeAll: false },
            savedAt: data.savedAt
          });
        } catch (err) {
          console.warn('Failed to deserialize saved audio buffers:', err);
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('IndexedDB not supported or accessible:', err);
    return null;
  }
}

/**
 * Clears saved session from IndexedDB
 */
export async function clearSavedProject() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(SESSION_KEY);
  } catch (e) {
    // ignore
  }
}
