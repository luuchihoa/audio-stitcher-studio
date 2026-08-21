import { icons } from './icons.js';
import { formatTime } from './trackCard.js';
import { getAudioContext } from '../audio/audioContext.js';
import { sliceAudioBuffer, spliceCutOutAudioBuffer, splitAudioBuffer } from '../audio/bufferCutter.js';
import { extractWaveformData } from '../audio/decoder.js';

export class AudioCutterModal {
  constructor(callbacks) {
    this.callbacks = callbacks || {};
    this.modalEl = null;
    this.currentTrack = null;
    this.mode = 'crop'; // 'crop' | 'cutout' | 'split'
    this.startTime = 0;
    this.endTime = 0;
    this.splitTime = 0;
    this.isPlaying = false;
    this.activeSource = null;
    this.playStartTime = 0;
    this.playDuration = 0;
    this.animFrame = null;
    this.draggingHandle = null; // 'start' | 'end' | 'split' | null

    this.initDOM();
  }

  initDOM() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'audio-cutter-backdrop';

    backdrop.innerHTML = `
      <div class="modal-card" style="width: min(800px, 96vw); max-width: 800px;">
        <div class="modal-header">
          <div class="modal-title">
            ${icons.scissors}
            <span>Trình Cắt Audio Chuyên Sâu</span>
          </div>
          <button class="btn btn-secondary btn-icon" id="btn-close-cutter">
            ${icons.x}
          </button>
        </div>

        <div class="modal-body" style="gap: 18px;">
          <!-- Track Name and Modes -->
          <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px;">
            <div style="font-size: 0.95rem; font-weight: 700; color: var(--text-primary);" id="cutter-track-name">
              Tên file âm thanh
            </div>
            
            <div class="segment-group" id="cutter-mode-group">
              <button type="button" class="segment-btn active" data-mode="crop" title="Giữ lại đoạn nằm trong vùng chọn">
                Cắt & Giữ (Crop)
              </button>
              <button type="button" class="segment-btn" data-mode="cutout" title="Xóa bỏ đoạn lỗi ở giữa và nối 2 đầu lại">
                Cắt Bỏ Giữa (Cut-Out)
              </button>
              <button type="button" class="segment-btn" data-mode="split" title="Chia clip làm 2 phần độc lập">
                Tách Đôi (Split)
              </button>
            </div>
          </div>

          <!-- Large Interactive Waveform Container -->
          <div class="cutter-waveform-container" id="cutter-waveform-wrap" style="position: relative; height: 140px; background: var(--bg-main); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); overflow: hidden; cursor: crosshair; user-select: none;">
            <canvas id="cutter-canvas" style="width: 100%; height: 100%; display: block;"></canvas>
            
            <!-- Selection Overlay UI -->
            <div id="cutter-selection-overlay" style="position: absolute; top: 0; bottom: 0; pointer-events: none;"></div>
            
            <!-- Drag Handles -->
            <div class="cutter-handle" id="handle-start" title="Kéo để chỉnh điểm bắt đầu" style="position: absolute; top: 0; bottom: 0; width: 14px; margin-left: -7px; cursor: ew-resize; z-index: 10; display: flex; flex-direction: column; justify-content: space-between; align-items: center;">
              <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 3px 3px 0 0; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
              <div style="width: 2px; height: 100%; background: var(--accent-cyan);"></div>
              <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 0 0 3px 3px; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
            </div>

            <div class="cutter-handle" id="handle-end" title="Kéo để chỉnh điểm kết thúc" style="position: absolute; top: 0; bottom: 0; width: 14px; margin-left: -7px; cursor: ew-resize; z-index: 10; display: flex; flex-direction: column; justify-content: space-between; align-items: center;">
              <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 3px 3px 0 0; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
              <div style="width: 2px; height: 100%; background: var(--accent-cyan);"></div>
              <div style="width: 12px; height: 16px; background: var(--accent-cyan); border-radius: 0 0 3px 3px; box-shadow: 0 0 8px rgba(0,240,255,0.8);"></div>
            </div>

            <!-- Playhead -->
            <div id="cutter-playhead" style="position: absolute; top: 0; bottom: 0; width: 2px; background: #ffffff; display: none; z-index: 12; pointer-events: none;">
              <div style="width: 8px; height: 8px; border-radius: 50%; background: #ffffff; margin-left: -3px; margin-top: -4px;"></div>
            </div>
          </div>

          <!-- Precision Time Controls & Steppers -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; background: var(--bg-surface-elevated); padding: 14px 18px; border-radius: var(--radius-md); border: 1px solid var(--border-subtle);">
            
            <div class="form-group" id="group-cutter-start">
              <label class="form-label" style="display: flex; justify-content: space-between;">
                <span>Điểm bắt đầu (Start)</span>
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
              <div style="font-size: 0.8rem; color: var(--text-secondary);" id="cutter-stat-label">Thời lượng sau khi cắt:</div>
              <div style="font-family: var(--font-mono); font-size: 1.25rem; font-weight: 800; color: var(--text-primary);" id="cutter-stat-duration">
                00:00.0
              </div>
            </div>

          </div>

          <!-- Audition / Preview Toolbar -->
          <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px;">
            <div style="display: flex; gap: 10px;">
              <button type="button" class="btn btn-secondary" id="btn-cutter-audition">
                ${icons.play}
                <span id="text-btn-audition">Nghe thử vùng chọn</span>
              </button>
              <button type="button" class="btn btn-secondary btn-icon" id="btn-cutter-stop" title="Dừng">
                ${icons.stop}
              </button>
            </div>

            <div style="font-size: 0.82rem; color: var(--text-secondary);" id="cutter-hint-text">
              Kéo 2 vạch cyan trên sóng âm để điều chỉnh vùng cắt.
            </div>
          </div>
        </div>

        <div class="modal-footer" style="margin-top: 10px;">
          <button type="button" class="btn btn-secondary" id="btn-cancel-cutter">Hủy bỏ</button>
          
          <button type="button" class="btn btn-secondary" id="btn-cutter-create-new" title="Giữ nguyên clip cũ và tạo thêm clip mới đã cắt">
            ${icons.copy}
            Tạo Clip Mới
          </button>

          <button type="button" class="btn btn-primary" id="btn-cutter-apply">
            ${icons.check}
            <span id="text-btn-apply">Áp dụng Cắt</span>
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
    const modeBtns = this.modalEl.querySelectorAll('#cutter-mode-group .segment-btn');
    const applyBtn = this.modalEl.querySelector('#btn-cutter-apply');
    const createNewBtn = this.modalEl.querySelector('#btn-cutter-create-new');
    const auditionBtn = this.modalEl.querySelector('#btn-cutter-audition');
    const stopBtn = this.modalEl.querySelector('#btn-cutter-stop');

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
        this.updateModeUI();
      });
    });

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

  setupWaveformInteractions() {
    const wrap = this.modalEl.querySelector('#cutter-waveform-wrap');
    const handleStart = this.modalEl.querySelector('#handle-start');
    const handleEnd = this.modalEl.querySelector('#handle-end');

    const getTimeFromX = (clientX) => {
      const rect = wrap.getBoundingClientRect();
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

    wrap.addEventListener('mousedown', (e) => {
      if (this.draggingHandle) return;
      const clickedTime = getTimeFromX(e.clientX);
      if (this.mode === 'split') {
        this.splitTime = clickedTime;
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

      if (this.draggingHandle === 'start') {
        this.startTime = Math.max(0, Math.min(curTime, this.endTime - 0.05));
      } else if (this.draggingHandle === 'end') {
        this.endTime = Math.min(this.currentTrack.duration, Math.max(curTime, this.startTime + 0.05));
      }
      this.updateHandlesAndCanvas();
    });

    window.addEventListener('mouseup', () => {
      this.draggingHandle = null;
    });

    // Touch support for mobile/tablets
    wrap.addEventListener('touchstart', (e) => {
      if (e.touches.length > 0) {
        const touch = e.touches[0];
        const curTime = getTimeFromX(touch.clientX);
        const distStart = Math.abs(curTime - this.startTime);
        const distEnd = Math.abs(curTime - this.endTime);
        this.draggingHandle = distStart < distEnd ? 'start' : 'end';
      }
    }, { passive: true });

    wrap.addEventListener('touchmove', (e) => {
      if (!this.draggingHandle || !this.currentTrack || e.touches.length === 0) return;
      const touch = e.touches[0];
      const curTime = getTimeFromX(touch.clientX);

      if (this.draggingHandle === 'start') {
        this.startTime = Math.max(0, Math.min(curTime, this.endTime - 0.05));
      } else if (this.draggingHandle === 'end') {
        this.endTime = Math.min(this.currentTrack.duration, Math.max(curTime, this.startTime + 0.05));
      }
      this.updateHandlesAndCanvas();
    }, { passive: true });

    wrap.addEventListener('touchend', () => {
      this.draggingHandle = null;
    });
  }

  open(track) {
    this.currentTrack = track;
    this.startTime = Math.max(0, track.trimStart || 0);
    this.endTime = Math.min(track.duration, track.trimEnd ?? track.duration);
    this.splitTime = track.duration * 0.5;

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
      if (this.startTime >= this.endTime - 0.05) {
        this.startTime = Math.max(0, this.endTime - 0.05);
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

    if (this.mode === 'crop') {
      handleStart.style.display = 'flex';
      handleEnd.style.display = 'flex';
      groupEnd.style.display = 'flex';
      btnCreateNew.style.display = 'inline-flex';
      textBtnAudition.textContent = 'Nghe thử vùng chọn';
      textBtnApply.textContent = 'Áp dụng Cắt & Giữ';
      hintText.textContent = 'Giữ lại đoạn nằm giữa 2 vạch cyan, loại bỏ phần thừa.';
    } else if (this.mode === 'cutout') {
      handleStart.style.display = 'flex';
      handleEnd.style.display = 'flex';
      groupEnd.style.display = 'flex';
      btnCreateNew.style.display = 'inline-flex';
      textBtnAudition.textContent = 'Nghe thử sau khi xóa';
      textBtnApply.textContent = 'Áp dụng Cắt Bỏ Đoạn Này';
      hintText.textContent = 'Xóa đoạn màu cam ở giữa và nối liền 2 đầu lại với micro-crossfade.';
    } else if (this.mode === 'split') {
      handleStart.style.display = 'flex';
      handleEnd.style.display = 'none';
      groupEnd.style.display = 'none';
      btnCreateNew.style.display = 'none';
      textBtnAudition.textContent = 'Nghe thử nửa đầu';
      textBtnApply.textContent = 'Tách làm 2 Clip trên Timeline';
      hintText.textContent = 'Kéo vạch cyan đến vị trí muốn chia clip thành 2 phần độc lập.';
    }

    this.updateHandlesAndCanvas();
  }

  updateHandlesAndCanvas() {
    if (!this.currentTrack) return;
    const dur = this.currentTrack.duration;
    const canvas = this.modalEl.querySelector('#cutter-canvas');
    const wrap = this.modalEl.querySelector('#cutter-waveform-wrap');
    const handleStart = this.modalEl.querySelector('#handle-start');
    const handleEnd = this.modalEl.querySelector('#handle-end');
    const overlay = this.modalEl.querySelector('#cutter-selection-overlay');
    
    const textStart = this.modalEl.querySelector('#cutter-text-start');
    const textEnd = this.modalEl.querySelector('#cutter-text-end');
    const statLabel = this.modalEl.querySelector('#cutter-stat-label');
    const statDuration = this.modalEl.querySelector('#cutter-stat-duration');

    const startPct = Math.max(0, Math.min(1, this.startTime / dur));
    const endPct = Math.max(0, Math.min(1, this.endTime / dur));

    // Update Handles Position
    handleStart.style.left = `${startPct * 100}%`;
    handleEnd.style.left = `${endPct * 100}%`;

    // Update Selection Overlay
    if (this.mode === 'crop') {
      overlay.style.left = `${startPct * 100}%`;
      overlay.style.width = `${(endPct - startPct) * 100}%`;
      overlay.style.background = 'rgba(0, 240, 255, 0.15)';
      overlay.style.borderLeft = '1px solid var(--accent-cyan)';
      overlay.style.borderRight = '1px solid var(--accent-cyan)';
      
      textStart.textContent = formatTime(this.startTime);
      textEnd.textContent = formatTime(this.endTime);
      statLabel.textContent = 'Thời lượng sau khi giữ:';
      statDuration.textContent = formatTime(Math.max(0, this.endTime - this.startTime));
    } else if (this.mode === 'cutout') {
      overlay.style.left = `${startPct * 100}%`;
      overlay.style.width = `${(endPct - startPct) * 100}%`;
      overlay.style.background = 'rgba(245, 158, 11, 0.2)';
      overlay.style.borderLeft = '1px solid var(--accent-amber)';
      overlay.style.borderRight = '1px solid var(--accent-amber)';

      textStart.textContent = formatTime(this.startTime);
      textEnd.textContent = formatTime(this.endTime);
      statLabel.textContent = 'Thời lượng sau khi xóa giữa:';
      const remaining = Math.max(0, dur - (this.endTime - this.startTime));
      statDuration.textContent = formatTime(remaining);
    } else if (this.mode === 'split') {
      overlay.style.left = '0%';
      overlay.style.width = `${startPct * 100}%`;
      overlay.style.background = 'rgba(0, 240, 255, 0.08)';
      overlay.style.borderRight = '2px solid var(--accent-cyan)';
      overlay.style.borderLeft = 'none';

      textStart.textContent = formatTime(this.startTime);
      statLabel.textContent = 'Điểm chia tách:';
      statDuration.textContent = `${formatTime(this.startTime)} & ${formatTime(dur - this.startTime)}`;
    }

    // Draw Canvas
    this.renderWaveformCanvas(canvas, startPct, endPct);
  }

  renderWaveformCanvas(canvas, startPct, endPct) {
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.currentTrack) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : 700;
    const height = rect.height > 0 ? rect.height : 140;

    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const peaks = this.currentTrack.waveformPeaks || [];
    const numBars = peaks.length;
    const totalBarWidth = width / numBars;
    const barWidth = Math.max(1.5, totalBarWidth - 1.5);
    const centerY = height / 2;

    for (let i = 0; i < numBars; i++) {
      const barPct = i / numBars;
      const peak = Math.max(0.04, peaks[i]);
      const barHeight = peak * (height - 12);
      const x = i * totalBarWidth;
      const y = centerY - barHeight / 2;

      let color = 'rgba(255, 255, 255, 0.2)';
      if (this.mode === 'crop') {
        color = (barPct >= startPct && barPct <= endPct) ? '#00f0ff' : 'rgba(255, 255, 255, 0.15)';
      } else if (this.mode === 'cutout') {
        color = (barPct >= startPct && barPct <= endPct) ? '#f59e0b' : '#00f0ff';
      } else if (this.mode === 'split') {
        color = (barPct <= startPct) ? '#00f0ff' : 'rgba(255, 255, 255, 0.35)';
      }

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
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
    const wrap = this.modalEl.querySelector('#cutter-waveform-wrap');

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
        playhead.style.left = `${(curTime / dur) * 100}%`;
        this.animFrame = requestAnimationFrame(update);
      };
      this.animFrame = requestAnimationFrame(update);

      source.onended = () => {
        this.stopAudition();
      };

    } else if (this.mode === 'cutout') {
      // Simulate Cut: Spliced audio audition
      const spliced = spliceCutOutAudioBuffer(buffer, this.startTime, this.endTime);
      const source = ctx.createBufferSource();
      source.buffer = spliced;
      source.connect(ctx.destination);
      source.start(0);

      this.activeSource = source;
      this.isPlaying = true;
      auditionBtn.innerHTML = `${icons.pause} <span>Tạm dừng</span>`;

      source.onended = () => {
        this.stopAudition();
      };
    } else if (this.mode === 'split') {
      const playDur = Math.max(0.05, this.startTime);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0, 0, playDur);

      this.activeSource = source;
      this.isPlaying = true;
      auditionBtn.innerHTML = `${icons.pause} <span>Tạm dừng</span>`;

      source.onended = () => {
        this.stopAudition();
      };
    }
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
      auditionBtn.innerHTML = `${icons.play} <span id="text-btn-audition">${this.mode === 'cutout' ? 'Nghe thử sau khi xóa' : 'Nghe thử vùng chọn'}</span>`;
    }
    const playhead = this.modalEl.querySelector('#cutter-playhead');
    if (playhead) playhead.style.display = 'none';
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
    }

    this.modalEl.classList.remove('open');
  }
}
