import { decodeAudioData, extractWaveformData } from './audio/decoder.js';
import { calculateTimeline } from './audio/concatenator.js';
import { MasterPlayer } from './audio/masterPlayer.js';
import { getSampleDemoTracks } from './audio/sampleGenerator.js';
import { createTrackElement, formatTime } from './ui/trackCard.js';
import { ExportModal } from './ui/exportModal.js';
import { BatchSilenceModal } from './ui/batchSilenceModal.js';
import { MicRecorderModal } from './ui/micRecorderModal.js';
import { AudioCutterModal } from './ui/audioCutterModal.js';
import { SilenceTruncatorModal } from './ui/silenceTruncatorModal.js';
import { autoSaveProject, loadSavedProject, clearSavedProject } from './audio/storage.js';
import { getAudioContext } from './audio/audioContext.js';
import { icons } from './ui/icons.js';

// Application State
const state = {
  tracks: [],
  globalOptions: {
    crossfade: 0,
    normalizeAll: false
  }
};

// Player and Modals
const masterPlayer = new MasterPlayer();
const exportModal = new ExportModal();
let batchSilenceModal;
let micRecorderModal;
let audioCutterModal;
let silenceTruncatorModal;

// DOM Elements
const dropzone = document.getElementById('audio-dropzone');
const fileInput = document.getElementById('file-input');
const btnSelectFiles = document.getElementById('btn-select-files');
const btnOpenMic = document.getElementById('btn-open-mic');
const btnLoadSamples = document.getElementById('btn-load-samples');
const studioToolbar = document.getElementById('studio-toolbar');
const timelineSection = document.getElementById('timeline-section');
const trackListContainer = document.getElementById('track-list-container');
const masterPlayerBar = document.getElementById('master-player-bar');

const statClipsCount = document.getElementById('stat-clips-count');
const statTotalDuration = document.getElementById('stat-total-duration');
const btnClearAll = document.getElementById('btn-clear-all');
const checkNormalize = document.getElementById('check-normalize');
const selectCrossfade = document.getElementById('select-crossfade');

const autosaveStatus = document.getElementById('autosave-status');
const autosaveDot = document.getElementById('autosave-dot');
const autosaveText = document.getElementById('autosave-text');

// Master Player DOM
const btnMasterPlay = document.getElementById('btn-master-play');
const btnMasterStop = document.getElementById('btn-master-stop');
const playerCurrentTime = document.getElementById('player-current-time');
const playerTotalTime = document.getElementById('player-total-time');
const masterScrubber = document.getElementById('master-scrubber');
const selectPlaybackSpeed = document.getElementById('select-playback-speed');
const btnMasterLoop = document.getElementById('btn-master-loop');
const btnOpenExport = document.getElementById('btn-open-export');

/**
 * Initialize Application & Restore Saved Session
 */
async function init() {
  batchSilenceModal = new BatchSilenceModal((gapDuration) => {
    applySilenceToAll(gapDuration);
  });

  micRecorderModal = new MicRecorderModal((newTrack) => {
    addTracks([newTrack]);
  });

  audioCutterModal = new AudioCutterModal({
    onUpdateTrack: (updatedTrack) => {
      render();
    },
    onAddTrack: (newTrack, originalTrack) => {
      const idx = state.tracks.findIndex(t => t.id === originalTrack.id);
      if (idx !== -1) {
        state.tracks.splice(idx + 1, 0, newTrack);
      } else {
        state.tracks.push(newTrack);
      }
      render();
    },
    onSplitTrack: (trackA, trackB) => {
      const idx = state.tracks.findIndex(t => t.id === trackA.id);
      if (idx !== -1) {
        state.tracks.splice(idx, 1, trackA, trackB);
      }
      render();
    }
  });

  silenceTruncatorModal = new SilenceTruncatorModal({
    onTruncated: ({ totalRegions, totalSaved }) => {
      render();
      if (totalSaved > 0) {
        showAutosaveStatus(`Đã rút gọn ${totalRegions} đoạn lặng (${totalSaved.toFixed(1)}s)`);
      }
    }
  });

  setupEventListeners();
  setupPlayerListeners();
  setupWakeupListeners();

  // Try to restore previous session from IndexedDB
  await restoreSession();
}

/**
 * Restores project from IndexedDB if available
 */
async function restoreSession() {
  try {
    const saved = await loadSavedProject();
    if (saved && saved.tracks && saved.tracks.length > 0) {
      state.tracks = saved.tracks;
      state.globalOptions = saved.globalOptions || { crossfade: 0, normalizeAll: false };
      
      if (checkNormalize) checkNormalize.checked = !!state.globalOptions.normalizeAll;
      if (selectCrossfade) selectCrossfade.value = state.globalOptions.crossfade || 0;

      showAutosaveStatus('Đã khôi phục phiên trước');
      render(false); // render without re-triggering save
    } else {
      render(false);
    }
  } catch (err) {
    console.warn('Failed to restore session:', err);
    render(false);
  }
}

/**
 * Triggers auto-save to IndexedDB with UI status updates
 */
function triggerAutoSave() {
  if (state.tracks.length === 0) {
    if (autosaveStatus) autosaveStatus.style.display = 'none';
    clearSavedProject();
    return;
  }

  if (autosaveStatus) {
    autosaveStatus.style.display = 'flex';
    autosaveDot.classList.add('saving');
    autosaveText.textContent = 'Đang lưu...';
  }

  autoSaveProject(state, (success, trackCount) => {
    if (autosaveStatus) {
      autosaveDot.classList.remove('saving');
      if (success) {
        autosaveText.textContent = `Đã tự động lưu (${trackCount} clip)`;
      } else {
        autosaveText.textContent = 'Lỗi tự động lưu';
      }
    }
  });
}

function showAutosaveStatus(msg) {
  if (autosaveStatus) {
    autosaveStatus.style.display = 'flex';
    autosaveDot.classList.remove('saving');
    autosaveText.textContent = msg;
  }
}

/**
 * Handle MacBook sleep / wakeup and tab focus
 */
function setupWakeupListeners() {
  // Resume AudioContext when waking up or returning to tab
  const handleWakeup = async () => {
    if (document.visibilityState === 'visible') {
      try {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
      } catch (e) {
        // ignore
      }
    }
  };

  document.addEventListener('visibilitychange', handleWakeup);
  window.addEventListener('focus', handleWakeup);
  window.addEventListener('pageshow', handleWakeup);
}

/**
 * Sets up user interaction listeners
 */
function setupEventListeners() {
  // File selection
  btnSelectFiles.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(Array.from(e.target.files));
      fileInput.value = '';
    }
  });

  // Dropzone drag & drop
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dragover');
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  // Global window drag over
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    if (!dropzone.contains(e.target) && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      e.preventDefault();
      handleFiles(Array.from(e.dataTransfer.files));
    }
  });

  // Open Mic Recorder
  btnOpenMic.addEventListener('click', () => {
    micRecorderModal.open();
  });

  // Load Demo Samples
  btnLoadSamples.addEventListener('click', async () => {
    btnLoadSamples.disabled = true;
    btnLoadSamples.innerHTML = `<span style="font-size:0.8rem">Đang tạo mẫu...</span>`;
    try {
      const demoTracks = await getSampleDemoTracks();
      addTracks(demoTracks);
    } catch (err) {
      console.error(err);
      alert('Không thể tạo sample audio: ' + err.message);
    } finally {
      btnLoadSamples.disabled = false;
      btnLoadSamples.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
        Thêm Audio Mẫu
      `;
    }
  });

  // Clear All
  btnClearAll.addEventListener('click', async () => {
    if (state.tracks.length === 0) return;
    if (confirm('Bạn có chắc chắn muốn xóa toàn bộ danh sách audio không?')) {
      masterPlayer.stop();
      state.tracks = [];
      await clearSavedProject();
      render();
    }
  });

  // Batch Silence Modal Trigger
  const btnBatchSilence = document.getElementById('btn-batch-silence-modal');
  btnBatchSilence.addEventListener('click', () => {
    batchSilenceModal.open();
  });

  // Silence Truncator Modal Trigger (Auto shorten silence to 0.5s)
  const btnTruncateSilence = document.getElementById('btn-truncate-silence-modal');
  if (btnTruncateSilence) {
    btnTruncateSilence.addEventListener('click', () => {
      silenceTruncatorModal.open(state.tracks);
    });
  }

  // Normalize Toggle
  checkNormalize.addEventListener('change', (e) => {
    state.globalOptions.normalizeAll = e.target.checked;
    updateMasterTimeline();
    triggerAutoSave();
  });

  // Crossfade Select
  selectCrossfade.addEventListener('change', (e) => {
    state.globalOptions.crossfade = parseFloat(e.target.value) || 0;
    updateMasterTimeline();
    triggerAutoSave();
  });

  // Open Export Modal
  btnOpenExport.addEventListener('click', () => {
    masterPlayer.pause();
    exportModal.open(state.tracks, state.globalOptions);
  });

  // Keyboard Shortcuts (Space to toggle Master play/pause)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      if (state.tracks.length > 0) {
        if (masterPlayer.isPlaying) {
          masterPlayer.pause();
        } else {
          masterPlayer.play();
        }
      }
    }
  });
}

/**
 * Setup Master Player Controls
 */
function setupPlayerListeners() {
  btnMasterPlay.addEventListener('click', () => {
    if (masterPlayer.isPlaying) {
      masterPlayer.pause();
    } else {
      masterPlayer.play();
    }
  });

  btnMasterStop.addEventListener('click', () => {
    masterPlayer.stop();
  });

  masterScrubber.addEventListener('input', (e) => {
    const seekPercent = parseFloat(e.target.value) / 100;
    const targetTime = seekPercent * masterPlayer.totalDuration;
    masterPlayer.seek(targetTime);
  });

  selectPlaybackSpeed.addEventListener('change', (e) => {
    const speed = parseFloat(e.target.value) || 1.0;
    masterPlayer.setPlaybackRate(speed);
  });

  btnMasterLoop.addEventListener('click', () => {
    const isLoop = !masterPlayer.loop;
    masterPlayer.setLoop(isLoop);
    btnMasterLoop.classList.toggle('btn-primary', isLoop);
    btnMasterLoop.classList.toggle('btn-secondary', !isLoop);
  });

  masterPlayer.on('statechange', ({ isPlaying }) => {
    btnMasterPlay.innerHTML = isPlaying ? icons.pause : icons.play;
    btnMasterPlay.title = isPlaying ? 'Tạm dừng phát' : 'Phát toàn bộ chuỗi';
  });

  masterPlayer.on('timeupdate', ({ currentTime, totalDuration }) => {
    playerCurrentTime.textContent = formatTime(currentTime);
    playerTotalTime.textContent = formatTime(totalDuration);
    
    if (totalDuration > 0) {
      const pct = (currentTime / totalDuration) * 100;
      masterScrubber.value = pct;
    } else {
      masterScrubber.value = 0;
    }
  });
}

/**
 * Handles incoming files, decodes them and pushes into track list
 */
async function handleFiles(files) {
  const audioFiles = files.filter(f => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|wma)$/i.test(f.name));
  if (audioFiles.length === 0) {
    alert('Vui lòng chọn các file âm thanh hợp lệ (MP3, WAV, M4A, OGG, AAC...).');
    return;
  }

  const loadedTracks = [];
  for (const file of audioFiles) {
    try {
      const buffer = await decodeAudioData(file);
      const { peaks } = extractWaveformData(buffer, 120);
      
      loadedTracks.push({
        id: 'track_' + Math.random().toString(36).substring(2, 9),
        name: file.name,
        file: file,
        audioBuffer: buffer,
        duration: buffer.duration,
        trimStart: 0,
        trimEnd: buffer.duration,
        volume: 1.0,
        muted: false,
        fadeIn: 0,
        fadeOut: 0,
        silenceAfter: 0, // default 0s as requested
        waveformPeaks: peaks
      });
    } catch (err) {
      console.error(`Lỗi giải mã file "${file.name}":`, err);
    }
  }

  if (loadedTracks.length > 0) {
    addTracks(loadedTracks);
  }
}

/**
 * Appends tracks to state
 */
function addTracks(newTracks) {
  state.tracks.push(...newTracks);
  render();
}

/**
 * Applies a uniform silence duration to all track gaps
 */
function applySilenceToAll(durationSeconds) {
  state.tracks.forEach((track, idx) => {
    if (idx < state.tracks.length - 1) {
      track.silenceAfter = durationSeconds;
    }
  });
  render();
}

/**
 * Updates Master Player and timeline stats without full DOM re-render
 */
function updateMasterTimeline() {
  const { totalDuration } = calculateTimeline(state.tracks, state.globalOptions);
  statClipsCount.textContent = state.tracks.length;
  statTotalDuration.textContent = formatTime(totalDuration);
  masterPlayer.setTracks(state.tracks, state.globalOptions);
}

/**
 * Full UI Render of Track List and State
 * @param {boolean} [shouldAutoSave=true]
 */
function render(shouldAutoSave = true) {
  const hasTracks = state.tracks.length > 0;

  studioToolbar.style.display = hasTracks ? 'grid' : 'none';
  timelineSection.style.display = hasTracks ? 'flex' : 'none';
  masterPlayerBar.style.display = hasTracks ? 'grid' : 'none';

  trackListContainer.innerHTML = '';

  state.tracks.forEach((track, index) => {
    const isLast = index === state.tracks.length - 1;
    const trackEl = createTrackElement(track, index, isLast, {
      onTrackUpdate: () => {
        updateMasterTimeline();
        triggerAutoSave();
      },
      onSilenceChange: (t, val) => {
        t.silenceAfter = val;
        updateMasterTimeline();
        triggerAutoSave();
      },
      onApplySilenceToAll: (val) => {
        applySilenceToAll(val);
      },
      onOpenCutter: (t) => {
        audioCutterModal.open(t);
      },
      onTruncateTrack: (t) => {
        silenceTruncatorModal.open(state.tracks, t);
      },
      onDuplicate: (t) => {
        const copy = {
          ...t,
          id: 'track_' + Math.random().toString(36).substring(2, 9),
          name: `${t.name} (Bản sao)`
        };
        state.tracks.splice(index + 1, 0, copy);
        render();
      },
      onDelete: (t) => {
        state.tracks = state.tracks.filter(item => item.id !== t.id);
        render();
      }
    });

    // Drag-and-drop Reordering Handlers
    trackEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const card = trackEl.querySelector('.track-card');
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      
      if (e.clientY < mid) {
        card.classList.add('drag-over-top');
        card.classList.remove('drag-over-bottom');
      } else {
        card.classList.add('drag-over-bottom');
        card.classList.remove('drag-over-top');
      }
    });

    trackEl.addEventListener('dragleave', () => {
      const card = trackEl.querySelector('.track-card');
      card.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    trackEl.addEventListener('drop', (e) => {
      e.preventDefault();
      const card = trackEl.querySelector('.track-card');
      card.classList.remove('drag-over-top', 'drag-over-bottom');

      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId || draggedId === track.id) return;

      const draggedIndex = state.tracks.findIndex(t => t.id === draggedId);
      if (draggedIndex === -1) return;

      const [draggedTrack] = state.tracks.splice(draggedIndex, 1);
      const rect = card.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      let targetIndex = state.tracks.findIndex(t => t.id === track.id);

      if (e.clientY >= mid) {
        targetIndex += 1;
      }

      state.tracks.splice(targetIndex, 0, draggedTrack);
      render();
    });

    trackListContainer.appendChild(trackEl);
  });

  updateMasterTimeline();

  if (shouldAutoSave) {
    triggerAutoSave();
  }
}

// Start app on DOM ready
document.addEventListener('DOMContentLoaded', init);
