import { icons } from './icons.js';
import { drawWaveform } from './waveformRenderer.js';
import { getAudioContext } from '../audio/audioContext.js';

export function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(1);
  const formattedMins = mins.toString().padStart(2, '0');
  const formattedSecs = (seconds % 60) < 10 ? '0' + secs : secs;
  return `${formattedMins}:${formattedSecs}`;
}

export function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * Creates the DOM element for an audio track and its trailing silence connector.
 */
export function createTrackElement(track, index, isLast, callbacks) {
  const container = document.createElement('div');
  container.className = 'track-wrapper';
  container.dataset.id = track.id;
  container.dataset.index = index;

  const effectiveDuration = Math.max(0, (track.trimEnd || track.duration) - (track.trimStart || 0));

  // Main Card HTML
  container.innerHTML = `
    <div class="track-card ${track.muted ? 'muted' : ''}" draggable="true" id="track-card-${track.id}">
      <div class="track-main-row">
        <div class="track-drag-handle" title="Kéo để đổi thứ tự">
          ${icons.grip}
        </div>
        
        <div class="track-index-badge">#${index + 1}</div>

        <div class="track-meta">
          <div class="track-name" title="${track.name}">${track.name}</div>
          <div class="track-info">
            <span>${formatTime(effectiveDuration)} / ${formatTime(track.duration)}</span>
            <span>•</span>
            <span>${track.audioBuffer.sampleRate}Hz ${track.audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}</span>
            ${track.file?.size ? `<span>• ${formatBytes(track.file.size)}</span>` : ''}
          </div>
        </div>

        <div class="track-waveform-wrapper">
          <canvas class="track-waveform-canvas" id="canvas-${track.id}"></canvas>
        </div>

        <div class="track-actions">
          <button class="btn btn-secondary btn-icon btn-preview-track" title="Nghe thử clip này" id="preview-btn-${track.id}">
            ${icons.play}
          </button>
          
          <button class="btn btn-secondary btn-icon btn-open-cutter" title="Cắt Audio Chuyên Sâu (Crop / Cut-out / Split)" style="color: var(--accent-cyan); border-color: rgba(0, 240, 255, 0.3);">
            ${icons.scissors}
          </button>

          <button class="btn btn-secondary btn-icon btn-truncate-track" title="⚡ Tự động rút gọn các đoạn lặng trong clip này về 0.5s" style="color: var(--accent-teal);">
            ${icons.sparkles}
          </button>

          <button class="btn btn-secondary btn-icon btn-mute-track ${track.muted ? 'active' : ''}" title="${track.muted ? 'Bật âm' : 'Tắt tiếng clip'}">
            ${track.muted ? icons.volumeX : icons.volume2}
          </button>
          
          <button class="btn btn-secondary btn-icon btn-expand-track" title="Chỉnh Volume & Fade">
            ${icons.sliders}
          </button>
          
          <button class="btn btn-secondary btn-icon btn-duplicate-track" title="Nhân bản clip">
            ${icons.copy}
          </button>

          <button class="btn btn-danger-ghost btn-icon btn-delete-track" title="Xóa clip này">
            ${icons.trash}
          </button>
        </div>
      </div>

      <!-- Expandable Drawer for Trim & Volume Controls -->
      <div class="track-extra-controls" id="extra-${track.id}" style="display: ${track._expanded ? 'grid' : 'none'};">
        <div class="clip-slider-control">
          <div class="slider-header">
            <span>Cắt đầu (Trim Start)</span>
            <span class="slider-val" id="val-trim-start-${track.id}">${formatTime(track.trimStart || 0)}</span>
          </div>
          <input type="range" class="slider-trim-start" min="0" max="${track.duration}" step="0.05" value="${track.trimStart || 0}">
        </div>

        <div class="clip-slider-control">
          <div class="slider-header">
            <span>Cắt đuôi (Trim End)</span>
            <span class="slider-val" id="val-trim-end-${track.id}">${formatTime(track.trimEnd ?? track.duration)}</span>
          </div>
          <input type="range" class="slider-trim-end" min="0" max="${track.duration}" step="0.05" value="${track.trimEnd ?? track.duration}">
        </div>

        <div class="clip-slider-control">
          <div class="slider-header">
            <span>Âm lượng clip</span>
            <span class="slider-val" id="val-volume-${track.id}">${Math.round((track.volume ?? 1) * 100)}%</span>
          </div>
          <input type="range" class="slider-volume" min="0" max="2" step="0.05" value="${track.volume ?? 1}">
        </div>

        <div class="clip-slider-control">
          <div class="slider-header">
            <span>Fade In / Fade Out</span>
            <span class="slider-val">${(track.fadeIn || 0)}s / ${(track.fadeOut || 0)}s</span>
          </div>
          <div style="display: flex; gap: 8px;">
            <input type="range" class="slider-fadein" min="0" max="3" step="0.1" value="${track.fadeIn || 0}" title="Fade In" style="flex:1;">
            <input type="range" class="slider-fadeout" min="0" max="3" step="0.1" value="${track.fadeOut || 0}" title="Fade Out" style="flex:1;">
          </div>
        </div>
      </div>
    </div>

    <!-- Silence Gap Connector (Between Tracks) -->
    ${!isLast ? `
      <div class="silence-connector" id="silence-conn-${track.id}">
        <div class="silence-pill">
          <div class="silence-icon">${icons.clock}</div>
          <span class="silence-title">Khoảng lặng:</span>
          
          <div class="silence-input-wrap">
            <input type="number" class="silence-input" min="0" max="60" step="0.1" value="${track.silenceAfter || 0}">
            <span class="silence-unit">giây</span>
          </div>

          <div class="silence-presets">
            <button type="button" class="preset-chip ${(track.silenceAfter || 0) === 0 ? 'active' : ''}" data-val="0">0s</button>
            <button type="button" class="preset-chip ${(track.silenceAfter || 0) === 0.5 ? 'active' : ''}" data-val="0.5">0.5s</button>
            <button type="button" class="preset-chip ${(track.silenceAfter || 0) === 1 ? 'active' : ''}" data-val="1">1s</button>
            <button type="button" class="preset-chip ${(track.silenceAfter || 0) === 2 ? 'active' : ''}" data-val="2">2s</button>
            <button type="button" class="preset-chip ${(track.silenceAfter || 0) === 3 ? 'active' : ''}" data-val="3">3s</button>
          </div>

          <button type="button" class="btn btn-secondary btn-sm btn-apply-all-gap" title="Áp dụng mức khoảng lặng này cho tất cả các đoạn">
            Áp dụng tất cả
          </button>
        </div>
      </div>
    ` : ''}
  `;

  // Attach Event Listeners
  const card = container.querySelector('.track-card');
  const canvas = container.querySelector(`#canvas-${track.id}`);
  
  // Render initial waveform
  setTimeout(() => {
    const startPct = (track.trimStart || 0) / track.duration;
    const endPct = (track.trimEnd ?? track.duration) / track.duration;
    drawWaveform(canvas, track.waveformPeaks, {
      trimStartPercent: startPct,
      trimEndPercent: endPct,
      activeColor: track.muted ? '#64748b' : '#00f0ff'
    });
  }, 10);

  // Single clip playback
  let clipSource = null;
  const previewBtn = container.querySelector(`#preview-btn-${track.id}`);
  
  previewBtn.addEventListener('click', async () => {
    if (clipSource) {
      try { clipSource.stop(); } catch (e) {}
      clipSource = null;
      previewBtn.innerHTML = icons.play;
      return;
    }

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const trimStart = track.trimStart || 0;
    const trimEnd = track.trimEnd ?? track.duration;
    const playDuration = Math.max(0.05, trimEnd - trimStart);

    clipSource = ctx.createBufferSource();
    clipSource.buffer = track.audioBuffer;

    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime((track.volume ?? 1), ctx.currentTime);

    clipSource.connect(gainNode);
    gainNode.connect(ctx.destination);

    clipSource.onended = () => {
      clipSource = null;
      previewBtn.innerHTML = icons.play;
    };

    clipSource.start(0, trimStart, playDuration);
    previewBtn.innerHTML = icons.stop;
  });

  // Open Audio Cutter Modal
  const openCutterBtn = container.querySelector('.btn-open-cutter');
  openCutterBtn.addEventListener('click', () => {
    if (clipSource) {
      try { clipSource.stop(); } catch (e) {}
      clipSource = null;
      previewBtn.innerHTML = icons.play;
    }
    callbacks.onOpenCutter(track);
  });

  // Open Silence Truncator for this track
  const openTruncateBtn = container.querySelector('.btn-truncate-track');
  openTruncateBtn.addEventListener('click', () => {
    if (clipSource) {
      try { clipSource.stop(); } catch (e) {}
      clipSource = null;
      previewBtn.innerHTML = icons.play;
    }
    callbacks.onTruncateTrack(track);
  });

  // Mute button
  const muteBtn = container.querySelector('.btn-mute-track');
  muteBtn.addEventListener('click', () => {
    track.muted = !track.muted;
    callbacks.onTrackUpdate(track);
  });

  // Expand drawer
  const expandBtn = container.querySelector('.btn-expand-track');
  const extraControls = container.querySelector(`#extra-${track.id}`);
  expandBtn.addEventListener('click', () => {
    track._expanded = !track._expanded;
    extraControls.style.display = track._expanded ? 'grid' : 'none';
  });

  // Duplicate button
  const duplicateBtn = container.querySelector('.btn-duplicate-track');
  duplicateBtn.addEventListener('click', () => {
    callbacks.onDuplicate(track);
  });

  // Delete button
  const deleteBtn = container.querySelector('.btn-delete-track');
  deleteBtn.addEventListener('click', () => {
    if (clipSource) {
      try { clipSource.stop(); } catch (e) {}
    }
    callbacks.onDelete(track);
  });

  // Trim Start slider
  const trimStartInput = container.querySelector('.slider-trim-start');
  const trimEndInput = container.querySelector('.slider-trim-end');
  const valTrimStart = container.querySelector(`#val-trim-start-${track.id}`);
  const valTrimEnd = container.querySelector(`#val-trim-end-${track.id}`);

  trimStartInput.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (val >= (track.trimEnd ?? track.duration) - 0.05) {
      val = Math.max(0, (track.trimEnd ?? track.duration) - 0.05);
      e.target.value = val;
    }
    track.trimStart = val;
    valTrimStart.textContent = formatTime(val);
    
    // Redraw waveform
    drawWaveform(canvas, track.waveformPeaks, {
      trimStartPercent: val / track.duration,
      trimEndPercent: (track.trimEnd ?? track.duration) / track.duration,
      activeColor: track.muted ? '#64748b' : '#00f0ff'
    });
    callbacks.onTrackUpdate(track);
  });

  // Trim End slider
  trimEndInput.addEventListener('input', (e) => {
    let val = parseFloat(e.target.value);
    if (val <= (track.trimStart || 0) + 0.05) {
      val = Math.min(track.duration, (track.trimStart || 0) + 0.05);
      e.target.value = val;
    }
    track.trimEnd = val;
    valTrimEnd.textContent = formatTime(val);
    
    // Redraw waveform
    drawWaveform(canvas, track.waveformPeaks, {
      trimStartPercent: (track.trimStart || 0) / track.duration,
      trimEndPercent: val / track.duration,
      activeColor: track.muted ? '#64748b' : '#00f0ff'
    });
    callbacks.onTrackUpdate(track);
  });

  // Volume slider
  const volumeInput = container.querySelector('.slider-volume');
  const valVolume = container.querySelector(`#val-volume-${track.id}`);
  volumeInput.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    track.volume = val;
    valVolume.textContent = Math.round(val * 100) + '%';
    callbacks.onTrackUpdate(track);
  });

  // Fade in / out
  const fadeInInput = container.querySelector('.slider-fadein');
  const fadeOutInput = container.querySelector('.slider-fadeout');
  fadeInInput.addEventListener('input', (e) => {
    track.fadeIn = parseFloat(e.target.value);
    callbacks.onTrackUpdate(track);
  });
  fadeOutInput.addEventListener('input', (e) => {
    track.fadeOut = parseFloat(e.target.value);
    callbacks.onTrackUpdate(track);
  });

  // Silence Gap Controller listeners (if present)
  if (!isLast) {
    const silenceInput = container.querySelector('.silence-input');
    const presetBtns = container.querySelectorAll('.preset-chip');
    const applyAllBtn = container.querySelector('.btn-apply-all-gap');

    silenceInput.addEventListener('input', (e) => {
      let val = Math.max(0, parseFloat(e.target.value) || 0);
      track.silenceAfter = val;
      
      presetBtns.forEach(btn => {
        btn.classList.toggle('active', parseFloat(btn.dataset.val) === val);
      });
      callbacks.onSilenceChange(track, val);
    });

    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseFloat(btn.dataset.val);
        silenceInput.value = val;
        track.silenceAfter = val;
        presetBtns.forEach(b => b.classList.toggle('active', b === btn));
        callbacks.onSilenceChange(track, val);
      });
    });

    applyAllBtn.addEventListener('click', () => {
      const val = parseFloat(silenceInput.value) || 0;
      callbacks.onApplySilenceToAll(val);
    });
  }

  // HTML5 Drag & Drop Reordering
  card.addEventListener('dragstart', (e) => {
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', track.id);
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
  });

  return container;
}
