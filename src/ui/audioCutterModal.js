import { icons } from './icons.js';
import { formatTime } from './trackCard.js';
import { getAudioContext } from '../audio/audioContext.js';
import { sliceAudioBuffer, spliceCutOutAudioBuffer, splitAudioBuffer, insertSilenceIntoAudioBuffer, muteRegionAudioBuffer } from '../audio/bufferCutter.js';
import { extractWaveformData } from '../audio/decoder.js';

export class AudioCutterModal {
  constructor(callbacks) {
    this.callbacks = callbacks || {};
    this.modalEl = null;
    this.currentTrack = null;
    this.mode = 'crop'; // 'crop' | 'cutout' | 'split' | 'silence'
    this.silenceSubMode = 'insert'; // 'insert' | 'mute'
    this.silenceDuration = 1.0;
    this.zoomLevel = 1.0; // 1x to 10x
    this.startTime = 0;
    this.endTime = 0;
    this.isPlaying = false;
    this.activeSource = null;
    this.playStartTime = 0;
    this.playDuration = 0;
    this.animFrame = null;
    this.draggingHandle = null; // 'start' | 'end' | null
    this.highResPeaks = [];

    this.initDOM();
  }

  initDOM() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'audio-cutter-backdrop';

    backdrop.innerHTML = `
      <div class="modal-card" style="width: min(900px, 96vw); max-width: 900px; max-height: calc(100vh - 32px);">
        <div class="modal-header">
          <div class="modal-title">
            ${icons.scissors}
            <span>Trình Cắt Audio Chuyên Sâu</span>
          </div>
          <div style="display: flex; align-items: center; gap: 12px;">
            <div style="font-size: 0.82rem; font-family: var(--font-mono); color: var(--accent-cyan); font-weight: 600;" id="cutter-track-name">
              Tên file âm thanh
            </div>
            <button class="btn btn-secondary btn-icon" id="btn-close-cutter" title="Đóng">
              ${icons.x}
            </button>
          </div>
        </div>

        <div class="modal-body" style="gap: 12px;">
          <!-- 4-Mode Navbar Tabs (Crop, Cutout, Split, Silence) -->
          <div class="cutter-mode-navbar" id="cutter-mode-group">
            <button type="button" class="cutter-nav-tab active" data-mode="crop">
              <span class="tab-icon">✂️</span>
              <div class="tab-info">
                <span class="tab-title">Cắt & Giữ (Crop)</span>
                <span class="tab-desc">Giữ vùng chọn</span>
              </div>
            </button>

            <button type="button" class="cutter-nav-tab" data-mode="cutout">
              <span class="tab-icon">⚡</span>
              <div class="tab-info">
                <span class="tab-title">Cắt Bỏ Giữa</span>
                <span class="tab-desc">Xóa lỗi & nối 2 đầu</span>
              </div>
            </button>

            <button type="button" class="cutter-nav-tab" data-mode="split">
              <span class="tab-icon">🔀</span>
              <div class="tab-info">
                <span class="tab-title">Tách Đôi</span>
                <span class="tab-desc">Chia làm 2 clip</span>
              </div>
            </button>

            <button type="button" class="cutter-nav-tab" data-mode="silence">
              <span class="tab-icon">🔇</span>
              <div class="tab-info">
                <span class="tab-title">Chèn Khoảng Lặng</span>
                <span class="tab-desc">Giãn bài / Tắt tiếng</span>
              </div>
            </button>
          </div>

          <!-- Zoom & Pan Control Bar -->
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px; background: var(--bg-surface-elevated); padding: 6px 12px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span style="font-size: 0.78rem; font-weight: 600; color: var(--text-secondary);">🔍 Zoom:</span>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-zoom-out" style="padding: 2px 8px;" title="Thu nhỏ">-</button>
              <input type="range" id="cutter-zoom-slider" min="1" max="10" step="0.2" value="1" style="width: 110px;" title="Thanh trượt Zoom">
              <button type="button" class="btn btn-secondary btn-sm" id="btn-zoom-in" style="padding: 2px 8px;" title="Phóng to">+</button>
              <button type="button" class="btn btn-secondary btn-sm" id="btn-zoom-reset" style="padding: 2px 8px;" title="Về 1x">1x</button>
              <span style="font-family: var(--font-mono); font-size: 0.78rem; font-weight: 700; color: var(--accent-cyan);" id="cutter-zoom-label">1.0x</span>
            </div>

            <div style="font-size: 0.75rem; color: var(--text-muted);">
              💡 <em>Cuộn chuột hoặc kéo thanh trượt khi phóng to</em>
            </div>
          </div>

          <!-- Main Scrollable Waveform Viewport Area (Always Visible) -->
          <div id="cutter-scroll-area" style="position: relative; width: 100%; height: 140px; background: #080c14; border: 1px solid rgba(0, 240, 255, 0.25); border-radius: var(--radius-lg); overflow-x: auto; overflow-y: hidden; user-select: none; box-shadow: inset 0 2px 10px rgba(0,0,0,0.6);">
            
            <div id="cutter-waveform-inner" style="position: relative; height: 100%; min-width: 100%; cursor: crosshair;">
              
              <!-- Time Ruler Canvas atop waveform -->
              <canvas id="cutter-ruler-canvas" style="position: absolute; top: 0; left: 0; width: 100%; height: 22px; pointer-events: auto; cursor: pointer; border-bottom: 1px solid rgba(255,255,255,0.08);"></canvas>
              
              <!-- Main Waveform Canvas -->
              <canvas id="cutter-canvas" style="position: absolute; top: 22px; left: 0; width: 100%; height: calc(100% - 22px); display: block;"></canvas>
              
              <!-- Selection Overlay UI -->
              <div id="cutter-selection-overlay" style="position: absolute; top: 22px; bottom: 0; pointer-events: none;"></div>
              
              <!-- Drag Handles -->
              <div class="cutter-handle" id="handle-start" title="Kéo để chỉnh vị trí" style="position: absolute; top: 0; bottom: 0; width: 16px; margin-left: -8px; cursor: ew-resize; z-index: 10; display: flex; flex-direction: column; justify-content: space-between; align-items: center;">
                <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 3px 3px 0 0; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
                <div style="width: 2px; height: 100%; background: var(--accent-cyan);"></div>
                <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 0 0 3px 3px; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
              </div>

              <div class="cutter-handle" id="handle-end" title="Kéo để chỉnh điểm kết thúc" style="position: absolute; top: 0; bottom: 0; width: 16px; margin-left: -8px; cursor: ew-resize; z-index: 10; display: flex; flex-direction: column; justify-content: space-between; align-items: center;">
                <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 3px 3px 0 0; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
                <div style="width: 2px; height: 100%; background: var(--accent-cyan);"></div>
                <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 0 0 3px 3px; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
              </div>

              <!-- Playhead -->
              <div id="cutter-playhead" style="position: absolute; top: 0; bottom: 0; width: 2px; background: #ffffff; display: none; z-index: 12; pointer-events: none; box-shadow: 0 0 8px rgba(255,255,255,0.8);">
                <div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; margin-left: -3px; margin-top: 0px;"></div>
              </div>

            </div>
          </div>

          <!-- Silence Mode Specific Controls (Displayed only in Silence mode) -->
          <div id="cutter-silence-options" style="display: none; background: rgba(18, 22, 31, 0.95); border: 1px solid var(--border-active); border-radius: var(--radius-md); padding: 10px 14px; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
              <div class="segment-group" id="cutter-silence-submodes">
                <button type="button" class="segment-btn active" data-submode="insert">➕ Chèn thêm khoảng lặng (Giãn bài)</button>
                <button type="button" class="segment-btn" data-submode="mute">🔇 Tắt tiếng vùng chọn (Mute)</button>
              </div>

              <div id="cutter-silence-duration-group" style="display: flex; align-items: center; gap: 6px;">
                <span style="font-size: 0.8rem; font-weight: 600; color: var(--text-secondary);">Thời lượng chèn:</span>
                <input type="number" id="cutter-silence-custom-input" min="0.1" max="60" step="0.1" value="1.0" class="silence-input" style="width: 54px; background: var(--bg-main); padding: 3px 4px; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); text-align: center; color: var(--accent-cyan); font-weight: 700; font-size: 0.82rem;">
                <span style="font-size: 0.75rem; color: var(--text-muted);">giây</span>
                
                <div class="silence-presets">
                  <button type="button" class="preset-chip" data-val="0.5">0.5s</button>
                  <button type="button" class="preset-chip active" data-val="1.0">1.0s</button>
                  <button type="button" class="preset-chip" data-val="2.0">2.0s</button>
                  <button type="button" class="preset-chip" data-val="3.0">3.0s</button>
                </div>
              </div>
            </div>
            <div style="font-size: 0.75rem; color: var(--accent-teal); display: flex; align-items: center; gap: 4px;">
              <span>👉</span>
              <span id="cutter-silence-instruction-text">Kéo vạch Xanh Lá đến vị trí muốn chèn khoảng lặng, sau đó chọn số giây và bấm Nghe thử hoặc Áp dụng.</span>
            </div>
          </div>

          <!-- Precision Time Controls & Steppers -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; background: var(--bg-surface-elevated); padding: 12px 18px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            
            <div class="form-group" id="group-cutter-start">
              <label class="form-label" style="display: flex; justify-content: space-between;">
                <span id="label-cutter-start">Điểm bắt đầu (Start)</span>
                <span style="font-family: var(--font-mono); color: var(--accent-cyan); font-weight: 700;" id="cutter-text-start">00:00.0</span>
              </label>
              <div style="display: flex; gap: 6px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-start-minus-1" title="Lùi 1s">-1s</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-start-minus-01" title="Lùi 0.1s">-0.1s</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-start-plus-01" title="Tiến 0.1s">+0.1s</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-start-plus-1" title="Tiến 1s">+1s</button>
              </div>
            </div>

            <div class="form-group" id="group-cutter-end">
              <label class="form-label" style="display: flex; justify-content: space-between;">
                <span>Điểm kết thúc (End)</span>
                <span style="font-family: var(--font-mono); color: var(--accent-cyan); font-weight: 700;" id="cutter-text-end">00:00.0</span>
              </label>
              <div style="display: flex; gap: 6px;">
                <button type="button" class="btn btn-secondary btn-sm" id="btn-end-minus-1" title="Lùi 1s">-1s</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-end-minus-01" title="Lùi 0.1s">-0.1s</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-end-plus-01" title="Tiến 0.1s">+0.1s</button>
                <button type="button" class="btn btn-secondary btn-sm" id="btn-end-plus-1" title="Tiến 1s">+1s</button>
              </div>
            </div>

            <div class="form-group" style="justify-content: center;">
              <div style="font-size: 0.8rem; color: var(--text-secondary);" id="cutter-stat-label">Thời lượng sau khi xử lý:</div>
              <div style="font-family: var(--font-mono); font-size: 1.2rem; font-weight: 800; color: var(--text-primary);" id="cutter-stat-duration">
                00:00.0
              </div>
            </div>

          </div>

          <!-- Audition / Preview Toolbar -->
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
              <button type="button" class="btn btn-primary btn-sm" id="btn-cutter-play-cursor" title="Phát ngay từ vị trí con trỏ đã nhấp (Phím Space)">
                ${icons.play}
                <span id="text-btn-play-cursor">Phát từ con trỏ (00:00.0)</span>
              </button>

              <button type="button" class="btn btn-secondary btn-sm" id="btn-cutter-audition" title="Nghe thử hiệu ứng vùng chọn">
                ${icons.volume2}
                <span id="text-btn-audition">Nghe thử vùng chọn</span>
              </button>

              <button type="button" class="btn btn-secondary btn-sm btn-icon" id="btn-cutter-stop" title="Dừng phát">
                ${icons.stop}
              </button>
            </div>

            <div style="font-size: 0.75rem; color: var(--text-secondary);" id="cutter-hint-text">
              💡 <em>Nhấp chuột vào sóng âm/thước đo để phát ngay từ vị trí đó (hoặc bấm phím Space)</em>
            </div>
          </div>
        </div>

        <div class="modal-footer" style="margin-top: 8px;">
          <button type="button" class="btn btn-secondary" id="btn-cancel-cutter">Hủy bỏ</button>
          
          <button type="button" class="btn btn-secondary" id="btn-cutter-create-new" title="Giữ nguyên clip cũ và tạo thêm clip mới đã xử lý">
            ${icons.copy}
            Tạo Clip Mới
          </button>

          <button type="button" class="btn btn-primary" id="btn-cutter-apply">
            ${icons.check}
            <span id="text-btn-apply">Áp dụng</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.modalEl = backdrop;

    this.attachEvents();
  }

  attachEvents() {
    const closeBtn = this.modalEl.querySelector('#btn-close-cutter');
    const cancelBtn = this.modalEl.querySelector('#btn-cancel-cutter');
    const modeBtns = this.modalEl.querySelectorAll('#cutter-mode-group .cutter-nav-tab');
    const applyBtn = this.modalEl.querySelector('#btn-cutter-apply');
    const createNewBtn = this.modalEl.querySelector('#btn-cutter-create-new');
    const auditionBtn = this.modalEl.querySelector('#btn-cutter-audition');
    const stopBtn = this.modalEl.querySelector('#btn-cutter-stop');

    // Zoom buttons & slider
    const zoomSlider = this.modalEl.querySelector('#cutter-zoom-slider');
    const zoomInBtn = this.modalEl.querySelector('#btn-zoom-in');
    const zoomOutBtn = this.modalEl.querySelector('#btn-zoom-out');
    const zoomResetBtn = this.modalEl.querySelector('#btn-zoom-reset');

    const close = () => {
      this.stopAudition();
      this.modalEl.classList.remove('open');
    };

    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);

    modeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        modeBtns.forEach(b => b.classList.toggle('active', b === btn));
        this.mode = btn.dataset.mode;
        
        // If switching to silence mode and start is 0, give it a visible initial position
        if (this.mode === 'silence' && this.currentTrack && this.startTime === 0) {
          this.startTime = this.cursorTime > 0 ? this.cursorTime : parseFloat((this.currentTrack.duration * 0.25).toFixed(2));
        }

        this.updateModeUI();
      });
    });

    // Zoom events
    zoomSlider.addEventListener('input', (e) => {
      this.setZoom(parseFloat(e.target.value));
    });
    zoomInBtn.addEventListener('click', () => {
      this.setZoom(Math.min(10, this.zoomLevel + 0.5));
    });
    zoomOutBtn.addEventListener('click', () => {
      this.setZoom(Math.max(1, this.zoomLevel - 0.5));
    });
    zoomResetBtn.addEventListener('click', () => {
      this.setZoom(1.0);
    });

    // Silence mode events
    const silenceSubmodeBtns = this.modalEl.querySelectorAll('#cutter-silence-submodes .segment-btn');
    const silenceInput = this.modalEl.querySelector('#cutter-silence-custom-input');
    const silencePresets = this.modalEl.querySelectorAll('#cutter-silence-options .preset-chip');

    silenceSubmodeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        silenceSubmodeBtns.forEach(b => b.classList.toggle('active', b === btn));
        this.silenceSubMode = btn.dataset.submode;
        this.updateModeUI();
      });
    });

    silenceInput.addEventListener('input', (e) => {
      this.silenceDuration = Math.max(0.05, parseFloat(e.target.value) || 1.0);
      silencePresets.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.val) === this.silenceDuration));
      this.updateHandlesAndCanvas();
    });

    silencePresets.forEach(btn => {
      btn.addEventListener('click', () => {
        silencePresets.forEach(b => b.classList.toggle('active', b === btn));
        this.silenceDuration = parseFloat(btn.dataset.val) || 1.0;
        silenceInput.value = this.silenceDuration;
        this.updateHandlesAndCanvas();
      });
    });

    // Play from cursor button
    const playCursorBtn = this.modalEl.querySelector('#btn-cutter-play-cursor');
    if (playCursorBtn) {
      playCursorBtn.addEventListener('click', () => {
        if (this.isPlaying) {
          this.stopAudition();
        } else {
          this.playFromCursor(this.cursorTime);
        }
      });
    }

    // Audition
    auditionBtn.addEventListener('click', () => {
      if (this.isPlaying) {
        this.stopAudition();
      } else {
        this.playAudition();
      }
    });

    stopBtn.addEventListener('click', () => {
      this.stopAudition();
    });

    // Spacebar shortcut to toggle play/pause inside modal
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && this.modalEl.classList.contains('open') && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        if (this.isPlaying) {
          this.stopAudition();
        } else {
          this.playFromCursor(this.cursorTime);
        }
      }
    });

    // Time steppers Start
    this.modalEl.querySelector('#btn-start-minus-1').addEventListener('click', () => this.stepTime('start', -1));
    this.modalEl.querySelector('#btn-start-minus-01').addEventListener('click', () => this.stepTime('start', -0.1));
    this.modalEl.querySelector('#btn-start-plus-01').addEventListener('click', () => this.stepTime('start', 0.1));
    this.modalEl.querySelector('#btn-start-plus-1').addEventListener('click', () => this.stepTime('start', 1));

    // Time steppers End
    this.modalEl.querySelector('#btn-end-minus-1').addEventListener('click', () => this.stepTime('end', -1));
    this.modalEl.querySelector('#btn-end-minus-01').addEventListener('click', () => this.stepTime('end', -0.1));
    this.modalEl.querySelector('#btn-end-plus-01').addEventListener('click', () => this.stepTime('end', 0.1));
    this.modalEl.querySelector('#btn-end-plus-1').addEventListener('click', () => this.stepTime('end', 1));

    // Apply Actions
    applyBtn.addEventListener('click', () => this.executeAction(false));
    createNewBtn.addEventListener('click', () => this.executeAction(true));

    // Interactive Waveform Dragging & Clicking
    this.setupWaveformInteractions();
  }

  setZoom(level) {
    this.zoomLevel = Math.max(1, Math.min(10, parseFloat(level.toFixed(1))));
    const slider = this.modalEl.querySelector('#cutter-zoom-slider');
    const label = this.modalEl.querySelector('#cutter-zoom-label');
    slider.value = this.zoomLevel;
    label.textContent = `${this.zoomLevel.toFixed(1)}x`;

    this.updateHandlesAndCanvas();
  }

  setupWaveformInteractions() {
    const scrollArea = this.modalEl.querySelector('#cutter-scroll-area');
    const innerWrap = this.modalEl.querySelector('#cutter-waveform-inner');
    const rulerCanvas = this.modalEl.querySelector('#cutter-ruler-canvas');
    const handleStart = this.modalEl.querySelector('#handle-start');
    const handleEnd = this.modalEl.querySelector('#handle-end');

    const getTimeFromX = (clientX) => {
      const rect = innerWrap.getBoundingClientRect();
      const clickX = Math.max(0, Math.min(rect.width, clientX - rect.left));
      const pct = clickX / rect.width;
      return pct * (this.currentTrack ? this.currentTrack.duration : 1);
    };

    handleStart.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.draggingHandle = 'start';
    });

    handleEnd.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      this.draggingHandle = 'end';
    });

    // Click on time ruler to play immediately from that timestamp
    rulerCanvas.style.pointerEvents = 'auto';
    rulerCanvas.style.cursor = 'pointer';
    rulerCanvas.title = 'Nhấp vào để phát ngay từ vị trí này';
    rulerCanvas.addEventListener('click', (e) => {
      const clickedTime = getTimeFromX(e.clientX);
      this.cursorTime = clickedTime;
      this.playFromCursor(clickedTime);
    });

    // Double click on waveform to play immediately from that position
    innerWrap.addEventListener('dblclick', (e) => {
      if (this.draggingHandle) return;
      const clickedTime = getTimeFromX(e.clientX);
      this.cursorTime = clickedTime;
      this.playFromCursor(clickedTime);
    });

    innerWrap.addEventListener('mousedown', (e) => {
      if (this.draggingHandle) return;
      const clickedTime = getTimeFromX(e.clientX);
      this.cursorTime = clickedTime;
      
      if (this.mode === 'split' || (this.mode === 'silence' && this.silenceSubMode === 'insert')) {
        this.startTime = clickedTime;
      } else {
        const distStart = Math.abs(clickedTime - this.startTime);
        const distEnd = Math.abs(clickedTime - this.endTime);
        if (distStart < distEnd) {
          this.startTime = Math.min(clickedTime, this.endTime - 0.05);
        } else {
          this.endTime = Math.max(clickedTime, this.startTime + 0.05);
        }
      }
      this.updateHandlesAndCanvas();
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.draggingHandle || !this.currentTrack) return;
      const curTime = getTimeFromX(e.clientX);
      this.cursorTime = curTime;

      if (this.draggingHandle === 'start') {
        if (this.mode === 'split' || (this.mode === 'silence' && this.silenceSubMode === 'insert')) {
          this.startTime = Math.max(0, Math.min(this.currentTrack.duration, curTime));
        } else {
          this.startTime = Math.max(0, Math.min(curTime, this.endTime - 0.05));
        }
      } else if (this.draggingHandle === 'end') {
        this.endTime = Math.min(this.currentTrack.duration, Math.max(curTime, this.startTime + 0.05));
      }
      this.updateHandlesAndCanvas();
    });

    window.addEventListener('mouseup', () => {
      this.draggingHandle = null;
    });

    // Mouse wheel horizontal scroll and zoom with Ctrl/Alt
    scrollArea.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.altKey) {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.3 : -0.3;
        this.setZoom(this.zoomLevel + delta);
      }
    }, { passive: false });
  }

  open(track) {
    this.currentTrack = track;
    this.startTime = Math.max(0, track.trimStart || 0);
    this.endTime = Math.min(track.duration, track.trimEnd ?? track.duration);
    this.cursorTime = this.startTime;
    this.zoomLevel = 1.0;
    this.setZoom(1.0);

    // Extract dense high-resolution peaks for crisp zoom rendering
    const denseBins = Math.max(300, Math.min(3000, Math.round(track.duration * 60)));
    this.highResPeaks = extractWaveformData(track.audioBuffer, denseBins).peaks;

    this.modalEl.querySelector('#cutter-track-name').textContent = `✂️ ${track.name}`;
    this.updateModeUI();
    this.modalEl.classList.add('open');

    setTimeout(() => {
      this.updateHandlesAndCanvas();
    }, 30);
  }

  stepTime(type, delta) {
    if (!this.currentTrack) return;
    const dur = this.currentTrack.duration;

    if (type === 'start') {
      this.startTime = Math.max(0, Math.min(dur, parseFloat((this.startTime + delta).toFixed(2))));
      if (this.mode !== 'split' && !(this.mode === 'silence' && this.silenceSubMode === 'insert')) {
        if (this.startTime >= this.endTime - 0.05) {
          this.startTime = Math.max(0, this.endTime - 0.05);
        }
      }
    } else {
      this.endTime = Math.max(0, Math.min(dur, parseFloat((this.endTime + delta).toFixed(2))));
      if (this.endTime <= this.startTime + 0.05) {
        this.endTime = Math.min(dur, this.startTime + 0.05);
      }
    }
    this.updateHandlesAndCanvas();
  }

  updateModeUI() {
    const handleStart = this.modalEl.querySelector('#handle-start');
    const handleEnd = this.modalEl.querySelector('#handle-end');
    const groupEnd = this.modalEl.querySelector('#group-cutter-end');
    const textBtnAudition = this.modalEl.querySelector('#text-btn-audition');
    const textBtnApply = this.modalEl.querySelector('#text-btn-apply');
    const btnCreateNew = this.modalEl.querySelector('#btn-cutter-create-new');
    const hintText = this.modalEl.querySelector('#cutter-hint-text');
    const silenceOptions = this.modalEl.querySelector('#cutter-silence-options');
    const labelStart = this.modalEl.querySelector('#label-cutter-start');

    silenceOptions.style.display = this.mode === 'silence' ? 'flex' : 'none';

    if (this.mode === 'crop') {
      handleStart.style.display = 'flex';
      handleEnd.style.display = 'flex';
      groupEnd.style.display = 'flex';
      btnCreateNew.style.display = 'inline-flex';
      labelStart.textContent = 'Điểm bắt đầu (Start)';
      textBtnAudition.textContent = 'Nghe thử vùng chọn';
      textBtnApply.textContent = 'Áp dụng Cắt & Giữ';
      hintText.textContent = 'Giữ lại đoạn nằm giữa 2 vạch cyan, loại bỏ phần thừa.';
    } else if (this.mode === 'cutout') {
      handleStart.style.display = 'flex';
      handleEnd.style.display = 'flex';
      groupEnd.style.display = 'flex';
      btnCreateNew.style.display = 'inline-flex';
      labelStart.textContent = 'Điểm bắt đầu (Start)';
      textBtnAudition.textContent = 'Nghe thử sau khi xóa';
      textBtnApply.textContent = 'Áp dụng Cắt Bỏ Đoạn Này';
      hintText.textContent = 'Xóa đoạn màu cam ở giữa và nối liền 2 đầu lại với micro-crossfade.';
    } else if (this.mode === 'split') {
      handleStart.style.display = 'flex';
      handleEnd.style.display = 'none';
      groupEnd.style.display = 'none';
      btnCreateNew.style.display = 'none';
      labelStart.textContent = 'Vị trí chia tách (Split)';
      textBtnAudition.textContent = 'Nghe thử nửa đầu';
      textBtnApply.textContent = 'Tách làm 2 Clip trên Timeline';
      hintText.textContent = 'Kéo vạch cyan đến vị trí muốn chia clip thành 2 phần độc lập.';
    } else if (this.mode === 'silence') {
      btnCreateNew.style.display = 'inline-flex';
      const durationGroup = this.modalEl.querySelector('#cutter-silence-duration-group');

      if (this.silenceSubMode === 'insert') {
        handleStart.style.display = 'flex';
        handleEnd.style.display = 'none';
        groupEnd.style.display = 'none';
        durationGroup.style.display = 'flex';
        labelStart.textContent = 'Vị trí chèn khoảng lặng';
        textBtnAudition.textContent = 'Nghe thử sau khi chèn';
        textBtnApply.textContent = `Chèn thêm ${this.silenceDuration}s Khoảng Lặng`;
        hintText.textContent = `Chèn thêm ${this.silenceDuration}s im lặng tại mốc thời gian đã chọn, kéo giãn tổng độ dài clip.`;
        const instructionText = this.modalEl.querySelector('#cutter-silence-instruction-text');
        if (instructionText) instructionText.textContent = 'Kéo vạch Cyan đến vị trí muốn chèn khoảng lặng, chọn số giây và bấm Nghe thử hoặc Áp dụng.';
      } else {
        handleStart.style.display = 'flex';
        handleEnd.style.display = 'flex';
        groupEnd.style.display = 'flex';
        durationGroup.style.display = 'none';
        labelStart.textContent = 'Điểm bắt đầu tắt tiếng';
        textBtnAudition.textContent = 'Nghe thử sau khi tắt tiếng';
        textBtnApply.textContent = 'Tắt Tiếng Vùng Chọn (Mute)';
        hintText.textContent = 'Làm câm hoàn toàn đoạn nằm giữa 2 vạch cyan mà không thay đổi tổng thời lượng.';
        const instructionText = this.modalEl.querySelector('#cutter-silence-instruction-text');
        if (instructionText) instructionText.textContent = 'Kéo 2 vạch Cyan (Start & End) để chọn đoạn cần tắt tiếng (Mute), sau đó bấm Áp dụng.';
      }
    }

    this.updateHandlesAndCanvas();
  }

  updateHandlesAndCanvas() {
    if (!this.currentTrack) return;
    const dur = this.currentTrack.duration;
    const scrollArea = this.modalEl.querySelector('#cutter-scroll-area');
    const innerWrap = this.modalEl.querySelector('#cutter-waveform-inner');
    const canvas = this.modalEl.querySelector('#cutter-canvas');
    const rulerCanvas = this.modalEl.querySelector('#cutter-ruler-canvas');
    const handleStart = this.modalEl.querySelector('#handle-start');
    const handleEnd = this.modalEl.querySelector('#handle-end');
    const overlay = this.modalEl.querySelector('#cutter-selection-overlay');
    
    const textStart = this.modalEl.querySelector('#cutter-text-start');
    const textEnd = this.modalEl.querySelector('#cutter-text-end');
    const statLabel = this.modalEl.querySelector('#cutter-stat-label');
    const statDuration = this.modalEl.querySelector('#cutter-stat-duration');

    // Calculate dynamic container width based on zoom level
    const baseWidth = scrollArea.clientWidth || 750;
    const totalWidth = Math.round(baseWidth * this.zoomLevel);
    innerWrap.style.width = `${totalWidth}px`;

    const startPct = Math.max(0, Math.min(1, this.startTime / dur));
    const endPct = Math.max(0, Math.min(1, this.endTime / dur));

    // Update Handles Position
    handleStart.style.left = `${startPct * totalWidth}px`;
    handleEnd.style.left = `${endPct * totalWidth}px`;

    // Update Selection Overlay
    if (this.mode === 'crop') {
      overlay.style.left = `${startPct * totalWidth}px`;
      overlay.style.width = `${(endPct - startPct) * totalWidth}px`;
      overlay.style.background = 'rgba(0, 240, 255, 0.15)';
      overlay.style.borderLeft = '1px solid var(--accent-cyan)';
      overlay.style.borderRight = '1px solid var(--accent-cyan)';
      
      textStart.textContent = formatTime(this.startTime);
      textEnd.textContent = formatTime(this.endTime);
      statLabel.textContent = 'Thời lượng sau khi giữ:';
      statDuration.textContent = formatTime(Math.max(0, this.endTime - this.startTime));

    } else if (this.mode === 'cutout') {
      overlay.style.left = `${startPct * totalWidth}px`;
      overlay.style.width = `${(endPct - startPct) * totalWidth}px`;
      overlay.style.background = 'rgba(245, 158, 11, 0.2)';
      overlay.style.borderLeft = '1px solid var(--accent-amber)';
      overlay.style.borderRight = '1px solid var(--accent-amber)';

      textStart.textContent = formatTime(this.startTime);
      textEnd.textContent = formatTime(this.endTime);
      statLabel.textContent = 'Thời lượng sau khi xóa giữa:';
      const remaining = Math.max(0, dur - (this.endTime - this.startTime));
      statDuration.textContent = formatTime(remaining);

    } else if (this.mode === 'split') {
      overlay.style.left = '0px';
      overlay.style.width = `${startPct * totalWidth}px`;
      overlay.style.background = 'rgba(0, 240, 255, 0.08)';
      overlay.style.borderRight = '2px solid var(--accent-cyan)';
      overlay.style.borderLeft = 'none';

      textStart.textContent = formatTime(this.startTime);
      statLabel.textContent = 'Điểm chia tách:';
      statDuration.textContent = `${formatTime(this.startTime)} & ${formatTime(dur - this.startTime)}`;

    } else if (this.mode === 'silence') {
      if (this.silenceSubMode === 'insert') {
        overlay.style.left = '0px';
        overlay.style.width = `${startPct * totalWidth}px`;
        overlay.style.background = 'rgba(16, 185, 129, 0.08)';
        overlay.style.borderRight = '2px solid var(--accent-teal)';
        overlay.style.borderLeft = 'none';

        textStart.textContent = formatTime(this.startTime);
        statLabel.textContent = `Thời lượng sau khi chèn +${this.silenceDuration}s:`;
        statDuration.textContent = `${formatTime(dur + this.silenceDuration)} (+${this.silenceDuration}s)`;
      } else {
        overlay.style.left = `${startPct * totalWidth}px`;
        overlay.style.width = `${(endPct - startPct) * totalWidth}px`;
        overlay.style.background = 'rgba(100, 116, 139, 0.25)';
        overlay.style.borderLeft = '1px solid var(--text-muted)';
        overlay.style.borderRight = '1px solid var(--text-muted)';

        textStart.textContent = formatTime(this.startTime);
        textEnd.textContent = formatTime(this.endTime);
        statLabel.textContent = 'Đoạn tắt tiếng (Mute):';
        statDuration.textContent = `${formatTime(Math.max(0, this.endTime - this.startTime))} (tổng ${formatTime(dur)})`;
      }
    }

    const playCursorText = this.modalEl.querySelector('#text-btn-play-cursor');
    if (playCursorText && !this.isPlaying) {
      playCursorText.textContent = `Phát từ con trỏ (${formatTime(this.cursorTime || 0)})`;
    }

    const playhead = this.modalEl.querySelector('#cutter-playhead');
    if (playhead && !this.isPlaying) {
      playhead.style.display = 'block';
      const cursorPct = Math.max(0, Math.min(1, (this.cursorTime || 0) / dur));
      playhead.style.left = `${cursorPct * totalWidth}px`;
    }

    // Render Time Ruler & Waveform Canvas
    this.renderTimeRuler(rulerCanvas, totalWidth, dur);
    this.renderWaveformCanvas(canvas, totalWidth, startPct, endPct);
  }

  renderTimeRuler(canvas, width, duration) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const height = 22;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.lineWidth = 1;

    // Determine tick interval based on zoom and duration
    let interval = 1.0;
    if (this.zoomLevel >= 5) interval = 0.2;
    else if (this.zoomLevel >= 2.5) interval = 0.5;
    else if (duration > 60) interval = 5.0;
    else if (duration > 30) interval = 2.0;

    const totalTicks = Math.ceil(duration / interval);

    for (let i = 0; i <= totalTicks; i++) {
      const time = i * interval;
      if (time > duration) break;
      const x = (time / duration) * width;

      // Draw tick line
      ctx.beginPath();
      ctx.moveTo(x, height - 6);
      ctx.lineTo(x, height);
      ctx.stroke();

      // Draw label
      ctx.fillText(formatTime(time), x + 3, height - 7);
    }

    ctx.restore();
  }

  renderWaveformCanvas(canvas, width, startPct, endPct) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.currentTrack) return;

    const dpr = window.devicePixelRatio || 1;
    const height = canvas.clientHeight || 118;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const peaks = this.highResPeaks.length > 0 ? this.highResPeaks : (this.currentTrack.waveformPeaks || []);
    const numBars = peaks.length;
    const totalBarWidth = width / numBars;
    const barWidth = Math.max(1.2, totalBarWidth - 1.0);
    const centerY = height / 2;

    for (let i = 0; i < numBars; i++) {
      const barPct = i / numBars;
      const peak = Math.max(0.06, peaks[i]);
      const barHeight = peak * (height - 12);
      const x = i * totalBarWidth;
      const y = centerY - barHeight / 2;

      let color = 'rgba(0, 240, 255, 0.4)';
      if (this.mode === 'crop') {
        color = (barPct >= startPct && barPct <= endPct) ? '#00f0ff' : 'rgba(255, 255, 255, 0.15)';
      } else if (this.mode === 'cutout') {
        color = (barPct >= startPct && barPct <= endPct) ? '#f59e0b' : '#00f0ff';
      } else if (this.mode === 'split') {
        color = (barPct <= startPct) ? '#00f0ff' : '#a855f7';
      } else if (this.mode === 'silence') {
        if (this.silenceSubMode === 'insert') {
          color = '#00f0ff';
        } else {
          color = (barPct >= startPct && barPct <= endPct) ? 'rgba(239, 68, 68, 0.4)' : '#00f0ff';
        }
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 1.5);
      ctx.fill();
    }

    // If in Silence -> Insert mode, draw a bright glowing vertical guide line at insertion point
    if (this.mode === 'silence' && this.silenceSubMode === 'insert') {
      const insertX = startPct * width;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(insertX, 0);
      ctx.lineTo(insertX, height);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw pin badge
      ctx.fillStyle = '#10b981';
      ctx.beginPath();
      ctx.roundRect(Math.min(width - 90, Math.max(4, insertX - 45)), 4, 90, 16, 4);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 9px "JetBrains Mono", sans-serif';
      ctx.fillText(`📍 Chèn +${this.silenceDuration}s`, Math.min(width - 84, Math.max(10, insertX - 39)), 15);
    }

    ctx.restore();
  }

  async playAudition() {
    this.stopAudition();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const buffer = this.currentTrack.audioBuffer;
    const dur = buffer.duration;
    const auditionBtn = this.modalEl.querySelector('#btn-cutter-audition');
    const playhead = this.modalEl.querySelector('#cutter-playhead');
    const innerWrap = this.modalEl.querySelector('#cutter-waveform-inner');

    if (this.mode === 'crop') {
      const playDur = Math.max(0.05, this.endTime - this.startTime);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0, this.startTime, playDur);

      this.activeSource = source;
      this.playStartTime = ctx.currentTime;
      this.playDuration = playDur;
      this.isPlaying = true;

      auditionBtn.innerHTML = `${icons.pause} <span>Tạm dừng</span>`;
      playhead.style.display = 'block';

      const update = () => {
        if (!this.isPlaying) return;
        const elapsed = ctx.currentTime - this.playStartTime;
        if (elapsed >= playDur) {
          this.stopAudition();
          return;
        }
        const curTime = this.startTime + elapsed;
        const totalW = innerWrap.clientWidth;
        playhead.style.left = `${(curTime / dur) * totalW}px`;
        this.animFrame = requestAnimationFrame(update);
      };
      this.animFrame = requestAnimationFrame(update);

      source.onended = () => this.stopAudition();

    } else if (this.mode === 'cutout') {
      const spliced = spliceCutOutAudioBuffer(buffer, this.startTime, this.endTime);
      const source = ctx.createBufferSource();
      source.buffer = spliced;
      source.connect(ctx.destination);
      source.start(0);

      this.activeSource = source;
      this.isPlaying = true;
      auditionBtn.innerHTML = `${icons.pause} <span>Tạm dừng</span>`;
      source.onended = () => this.stopAudition();

    } else if (this.mode === 'split') {
      const playDur = Math.max(0.05, this.startTime);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0, 0, playDur);

      this.activeSource = source;
      this.isPlaying = true;
      auditionBtn.innerHTML = `${icons.pause} <span>Tạm dừng</span>`;
      source.onended = () => this.stopAudition();

    } else if (this.mode === 'silence') {
      let previewBuffer;
      if (this.silenceSubMode === 'insert') {
        previewBuffer = insertSilenceIntoAudioBuffer(buffer, this.startTime, this.silenceDuration);
      } else {
        previewBuffer = muteRegionAudioBuffer(buffer, this.startTime, this.endTime);
      }

      const source = ctx.createBufferSource();
      source.buffer = previewBuffer;
      source.connect(ctx.destination);
      source.start(0);

      this.activeSource = source;
      this.isPlaying = true;
      auditionBtn.innerHTML = `${icons.pause} <span>Tạm dừng</span>`;
      source.onended = () => this.stopAudition();
    }
  }

  async playFromCursor(startTime) {
    this.stopAudition();
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();

    const buffer = this.currentTrack.audioBuffer;
    const dur = buffer.duration;
    const actualStart = Math.max(0, Math.min(dur - 0.05, (startTime !== undefined ? startTime : this.cursorTime)));
    this.cursorTime = actualStart;

    const playDur = Math.max(0.05, dur - actualStart);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0, actualStart, playDur);

    this.activeSource = source;
    this.playStartTime = ctx.currentTime;
    this.playDuration = playDur;
    this.isPlaying = true;

    const playCursorBtn = this.modalEl.querySelector('#btn-cutter-play-cursor');
    if (playCursorBtn) {
      playCursorBtn.innerHTML = `${icons.pause} <span>Tạm dừng (${formatTime(actualStart)})</span>`;
    }

    const playhead = this.modalEl.querySelector('#cutter-playhead');
    const innerWrap = this.modalEl.querySelector('#cutter-waveform-inner');
    if (playhead) playhead.style.display = 'block';

    const update = () => {
      if (!this.isPlaying) return;
      const elapsed = ctx.currentTime - this.playStartTime;
      if (elapsed >= playDur) {
        this.stopAudition();
        return;
      }
      const curTime = actualStart + elapsed;
      const totalW = innerWrap.clientWidth;
      if (playhead) playhead.style.left = `${(curTime / dur) * totalW}px`;
      this.animFrame = requestAnimationFrame(update);
    };
    this.animFrame = requestAnimationFrame(update);

    source.onended = () => this.stopAudition();
  }

  stopAudition() {
    if (this.activeSource) {
      try { this.activeSource.stop(); } catch (e) {}
      this.activeSource = null;
    }
    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
    this.isPlaying = false;
    
    const auditionBtn = this.modalEl.querySelector('#btn-cutter-audition');
    if (auditionBtn) {
      auditionBtn.innerHTML = `${icons.volume2} <span id="text-btn-audition">Nghe thử vùng chọn</span>`;
    }

    const playCursorBtn = this.modalEl.querySelector('#btn-cutter-play-cursor');
    if (playCursorBtn) {
      playCursorBtn.innerHTML = `${icons.play} <span id="text-btn-play-cursor">Phát từ con trỏ (${formatTime(this.cursorTime || 0)})</span>`;
    }

    const playhead = this.modalEl.querySelector('#cutter-playhead');
    if (playhead && this.currentTrack) {
      const innerWrap = this.modalEl.querySelector('#cutter-waveform-inner');
      const totalW = innerWrap.clientWidth;
      playhead.style.left = `${(this.cursorTime / this.currentTrack.duration) * totalW}px`;
    }
  }

  executeAction(createNew) {
    if (!this.currentTrack) return;
    this.stopAudition();

    const track = this.currentTrack;
    const buffer = track.audioBuffer;

    if (this.mode === 'crop') {
      const slicedBuffer = sliceAudioBuffer(buffer, this.startTime, this.endTime);
      const { peaks } = extractWaveformData(slicedBuffer, 120);

      if (createNew) {
        const newTrack = {
          ...track,
          id: 'track_' + Math.random().toString(36).substring(2, 9),
          name: `${track.name.replace(/\.[^/.]+$/, '')}_crop.wav`,
          audioBuffer: slicedBuffer,
          duration: slicedBuffer.duration,
          trimStart: 0,
          trimEnd: slicedBuffer.duration,
          waveformPeaks: peaks
        };
        this.callbacks.onAddTrack(newTrack, track);
      } else {
        track.audioBuffer = slicedBuffer;
        track.duration = slicedBuffer.duration;
        track.trimStart = 0;
        track.trimEnd = slicedBuffer.duration;
        track.waveformPeaks = peaks;
        this.callbacks.onUpdateTrack(track);
      }

    } else if (this.mode === 'cutout') {
      const splicedBuffer = spliceCutOutAudioBuffer(buffer, this.startTime, this.endTime);
      const { peaks } = extractWaveformData(splicedBuffer, 120);

      if (createNew) {
        const newTrack = {
          ...track,
          id: 'track_' + Math.random().toString(36).substring(2, 9),
          name: `${track.name.replace(/\.[^/.]+$/, '')}_cutout.wav`,
          audioBuffer: splicedBuffer,
          duration: splicedBuffer.duration,
          trimStart: 0,
          trimEnd: splicedBuffer.duration,
          waveformPeaks: peaks
        };
        this.callbacks.onAddTrack(newTrack, track);
      } else {
        track.audioBuffer = splicedBuffer;
        track.duration = splicedBuffer.duration;
        track.trimStart = 0;
        track.trimEnd = splicedBuffer.duration;
        track.waveformPeaks = peaks;
        this.callbacks.onUpdateTrack(track);
      }

    } else if (this.mode === 'split') {
      const { partA, partB } = splitAudioBuffer(buffer, this.startTime);
      const peaksA = extractWaveformData(partA, 120).peaks;
      const peaksB = extractWaveformData(partB, 120).peaks;

      const baseName = track.name.replace(/\.[^/.]+$/, '');
      const trackA = {
        ...track,
        name: `${baseName}_Phan1.wav`,
        audioBuffer: partA,
        duration: partA.duration,
        trimStart: 0,
        trimEnd: partA.duration,
        waveformPeaks: peaksA
      };

      const trackB = {
        ...track,
        id: 'track_' + Math.random().toString(36).substring(2, 9),
        name: `${baseName}_Phan2.wav`,
        audioBuffer: partB,
        duration: partB.duration,
        trimStart: 0,
        trimEnd: partB.duration,
        waveformPeaks: peaksB,
        silenceAfter: track.silenceAfter || 0
      };

      this.callbacks.onSplitTrack(trackA, trackB);

    } else if (this.mode === 'silence') {
      let finalBuffer;
      let suffix = '';

      if (this.silenceSubMode === 'insert') {
        finalBuffer = insertSilenceIntoAudioBuffer(buffer, this.startTime, this.silenceDuration);
        suffix = `_insert_${this.silenceDuration}s.wav`;
      } else {
        finalBuffer = muteRegionAudioBuffer(buffer, this.startTime, this.endTime);
        suffix = `_mute.wav`;
      }

      const { peaks } = extractWaveformData(finalBuffer, 120);

      if (createNew) {
        const newTrack = {
          ...track,
          id: 'track_' + Math.random().toString(36).substring(2, 9),
          name: `${track.name.replace(/\.[^/.]+$/, '')}${suffix}`,
          audioBuffer: finalBuffer,
          duration: finalBuffer.duration,
          trimStart: 0,
          trimEnd: finalBuffer.duration,
          waveformPeaks: peaks
        };
        this.callbacks.onAddTrack(newTrack, track);
      } else {
        track.audioBuffer = finalBuffer;
        track.duration = finalBuffer.duration;
        track.trimStart = 0;
        track.trimEnd = finalBuffer.duration;
        track.waveformPeaks = peaks;
        this.callbacks.onUpdateTrack(track);
      }
    }

    this.modalEl.classList.remove('open');
  }
}
