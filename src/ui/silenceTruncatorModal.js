import { icons } from './icons.js';
import { formatTime } from './trackCard.js';
import { truncateSilenceAudioBuffer, truncateTimelineSilences, detectSilenceRegions } from '../audio/silenceTruncator.js';
import { extractWaveformData } from '../audio/decoder.js';

export class SilenceTruncatorModal {
  constructor(callbacks) {
    this.callbacks = callbacks || {};
    this.modalEl = null;
    this.tracks = [];
    this.singleTrack = null;
    this.targetSilence = 0.5;
    this.thresholdDb = -45;
    this.initDOM();
  }

  initDOM() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'silence-truncator-backdrop';

    backdrop.innerHTML = `
      <div class="modal-card" style="width: min(540px, 95vw); max-width: 540px;">
        <div class="modal-header">
          <div class="modal-title" style="color: var(--accent-cyan);">
            ${icons.sparkles}
            <span>Tự Động Cắt Rút Gọn Âm Thanh Trống</span>
          </div>
          <button class="btn btn-secondary btn-icon" id="btn-close-truncator">
            ${icons.x}
          </button>
        </div>

        <div class="modal-body" style="gap: 16px;">
          <p style="font-size: 0.86rem; color: var(--text-secondary); line-height: 1.4;">
            Tự động phát hiện các đoạn im lặng/khoảng trống kéo dài trong từng clip và giữa các track, cắt ngắn về mức chuẩn (mặc định <strong>0.5s</strong>) kèm micro-crossfade chống giật tiếng.
          </p>

          <!-- Target Duration Presets -->
          <div class="form-group">
            <label class="form-label">Rút gọn khoảng im lặng còn tối đa:</label>
            <div class="segment-group" id="truncator-presets-group">
              <button type="button" class="segment-btn" data-val="0.2">0.2s</button>
              <button type="button" class="segment-btn" data-val="0.3">0.3s</button>
              <button type="button" class="segment-btn active" data-val="0.5">0.5s (Chuẩn)</button>
              <button type="button" class="segment-btn" data-val="0.8">0.8s</button>
              <button type="button" class="segment-btn" data-val="1.0">1.0s</button>
            </div>
          </div>

          <!-- Sensitivity Threshold -->
          <div class="form-group">
            <label class="form-label">Độ nhạy nhận diện khoảng lặng:</label>
            <select id="select-truncator-threshold" class="speed-select" style="width: 100%; padding: 8px 12px; font-size: 0.85rem;">
              <option value="-50">Studio chuyên nghiệp / Rất yên tĩnh (-50 dB)</option>
              <option value="-45" selected>Tiêu chuẩn giọng nói / Podcast (-45 dB - Khuyên dùng)</option>
              <option value="-38">Môi trường có tạp âm / Tiếng thở nhẹ (-38 dB)</option>
            </select>
          </div>

          <!-- Scope -->
          <div class="form-group" id="truncator-scope-group">
            <label class="form-label">Phạm vi áp dụng:</label>
            <div class="segment-group" id="truncator-scope-segments">
              <button type="button" class="segment-btn active" data-scope="all">Tất cả Clip & Timeline</button>
              <button type="button" class="segment-btn" data-scope="single" id="btn-scope-single" style="display: none;">Chỉ clip hiện tại</button>
            </div>
          </div>

          <!-- Analysis / Preview Result Card -->
          <div id="truncator-preview-card" style="background: var(--bg-main); border: 1px solid var(--border-active); border-radius: var(--radius-md); padding: 14px; display: flex; flex-direction: column; gap: 8px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-secondary);">
              <span>Số đoạn im lặng dôi dư:</span>
              <strong style="color: var(--accent-cyan); font-family: var(--font-mono);" id="truncator-stat-count">Đang quét...</strong>
            </div>
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-secondary);">
              <span>Tổng thời gian tiết kiệm ước tính:</span>
              <strong style="color: var(--accent-teal); font-family: var(--font-mono); font-size: 1rem;" id="truncator-stat-saved">00:00.0</strong>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-truncator">Hủy bỏ</button>
          <button type="button" class="btn btn-primary" id="btn-apply-truncator" style="font-weight: 700;">
            ${icons.sparkles}
            <span>Cắt Rút Gọn Ngay</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.modalEl = backdrop;

    this.attachEvents();
  }

  attachEvents() {
    const closeBtn = this.modalEl.querySelector('#btn-close-truncator');
    const cancelBtn = this.modalEl.querySelector('#btn-cancel-truncator');
    const applyBtn = this.modalEl.querySelector('#btn-apply-truncator');
    const presets = this.modalEl.querySelectorAll('#truncator-presets-group .segment-btn');
    const thresholdSelect = this.modalEl.querySelector('#select-truncator-threshold');
    const scopeBtns = this.modalEl.querySelectorAll('#truncator-scope-segments .segment-btn');

    const close = () => this.modalEl.classList.remove('open');
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);

    presets.forEach(btn => {
      btn.addEventListener('click', () => {
        presets.forEach(b => b.classList.toggle('active', b === btn));
        this.targetSilence = parseFloat(btn.dataset.val) || 0.5;
        this.updatePreview();
      });
    });

    thresholdSelect.addEventListener('change', (e) => {
      this.thresholdDb = parseFloat(e.target.value) || -45;
      this.updatePreview();
    });

    scopeBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        scopeBtns.forEach(b => b.classList.toggle('active', b === btn));
        this.updatePreview();
      });
    });

    applyBtn.addEventListener('click', () => {
      this.executeTruncation();
      close();
    });
  }

  open(tracks, singleTrack = null) {
    this.tracks = tracks || [];
    this.singleTrack = singleTrack;

    const singleBtn = this.modalEl.querySelector('#btn-scope-single');
    const scopeBtns = this.modalEl.querySelectorAll('#truncator-scope-segments .segment-btn');

    if (singleTrack) {
      singleBtn.style.display = 'block';
      singleBtn.textContent = `Chỉ clip "${singleTrack.name.substring(0, 16)}..."`;
      scopeBtns.forEach(b => b.classList.toggle('active', b === singleBtn));
    } else {
      singleBtn.style.display = 'none';
      scopeBtns[0].classList.add('active');
    }

    this.modalEl.classList.add('open');
    this.updatePreview();
  }

  updatePreview() {
    const scopeBtn = this.modalEl.querySelector('#truncator-scope-segments .segment-btn.active');
    const isSingle = scopeBtn && scopeBtn.dataset.scope === 'single' && this.singleTrack;
    const targetTracks = isSingle ? [this.singleTrack] : this.tracks.filter(t => !t.muted);

    let totalExcessRegions = 0;
    let totalTimeSaved = 0;

    for (const track of targetTracks) {
      const regions = detectSilenceRegions(track.audioBuffer, {
        thresholdDb: this.thresholdDb,
        minDuration: this.targetSilence + 0.05
      });

      for (const reg of regions) {
        if (reg.duration > this.targetSilence) {
          totalExcessRegions++;
          totalTimeSaved += (reg.duration - this.targetSilence);
        }
      }

      // Check timeline gap
      if (!isSingle && (track.silenceAfter || 0) > this.targetSilence) {
        totalExcessRegions++;
        totalTimeSaved += ((track.silenceAfter || 0) - this.targetSilence);
      }
    }

    const countEl = this.modalEl.querySelector('#truncator-stat-count');
    const savedEl = this.modalEl.querySelector('#truncator-stat-saved');

    countEl.textContent = `${totalExcessRegions} đoạn im lặng thừa`;
    savedEl.textContent = `${formatTime(totalTimeSaved)} (tiết kiệm ~${totalTimeSaved.toFixed(1)}s)`;
  }

  executeTruncation() {
    const scopeBtn = this.modalEl.querySelector('#truncator-scope-segments .segment-btn.active');
    const isSingle = scopeBtn && scopeBtn.dataset.scope === 'single' && this.singleTrack;
    const targetTracks = isSingle ? [this.singleTrack] : this.tracks.filter(t => !t.muted);

    let totalSaved = 0;
    let totalRegions = 0;

    for (const track of targetTracks) {
      const res = truncateSilenceAudioBuffer(track.audioBuffer, {
        maxSilence: this.targetSilence,
        thresholdDb: this.thresholdDb,
        crossfadeMs: 4
      });

      if (res.regionsCount > 0) {
        track.audioBuffer = res.buffer;
        track.duration = res.buffer.duration;
        track.trimStart = 0;
        track.trimEnd = res.buffer.duration;
        track.waveformPeaks = extractWaveformData(res.buffer, 120).peaks;

        totalRegions += res.regionsCount;
        totalSaved += res.timeSaved;
      }
    }

    // Truncate timeline gaps if global
    if (!isSingle) {
      const gapRes = truncateTimelineSilences(this.tracks, this.targetSilence);
      totalSaved += gapRes.timeSaved;
      totalRegions += gapRes.adjustedCount;
    }

    if (this.callbacks.onTruncated) {
      this.callbacks.onTruncated({
        totalRegions,
        totalSaved
      });
    }
  }
}
