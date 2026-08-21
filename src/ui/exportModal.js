import { icons } from './icons.js';
import { concatenateAudio } from '../audio/concatenator.js';
import { encodeWAV } from '../audio/encoder-wav.js';
import { encodeMP3 } from '../audio/encoder-mp3.js';

export class ExportModal {
  constructor() {
    this.modalEl = null;
    this.initDOM();
  }

  initDOM() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'export-modal-backdrop';

    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">
            ${icons.download}
            <span>Xuất file Audio hoàn chỉnh</span>
          </div>
          <button class="btn btn-secondary btn-icon" id="btn-close-export">
            ${icons.x}
          </button>
        </div>

        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Tên file xuất</label>
            <input type="text" id="export-filename" class="btn btn-secondary" style="width: 100%; text-align: left; font-family: var(--font-mono); font-size: 0.9rem;" value="audio_ghep_noi.mp3">
          </div>

          <div class="form-group">
            <label class="form-label">Định dạng (Format)</label>
            <div class="segment-group" id="export-format-group">
              <button type="button" class="segment-btn active" data-format="mp3">MP3 (Nhẹ & Phổ biến)</button>
              <button type="button" class="segment-btn" data-format="wav">WAV (Lossless Master)</button>
            </div>
          </div>

          <div class="form-group" id="mp3-bitrate-group">
            <label class="form-label">Chất lượng Bitrate (MP3)</label>
            <div class="segment-group" id="export-bitrate-group">
              <button type="button" class="segment-btn" data-bitrate="128">128 kbps</button>
              <button type="button" class="segment-btn active" data-bitrate="192">192 kbps</button>
              <button type="button" class="segment-btn" data-bitrate="256">256 kbps</button>
              <button type="button" class="segment-btn" data-bitrate="320">320 kbps</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Kênh âm thanh (Channels)</label>
            <div class="segment-group" id="export-channels-group">
              <button type="button" class="segment-btn active" data-channels="2">Stereo (2 Kênh)</button>
              <button type="button" class="segment-btn" data-channels="1">Mono (1 Kênh)</button>
            </div>
          </div>

          <!-- Progress Area -->
          <div id="export-progress-container" style="display: none; flex-direction: column; gap: 8px; margin-top: 6px;">
            <div style="display: flex; justify-content: space-between; font-size: 0.82rem; color: var(--text-secondary);">
              <span id="export-status-text">Đang xử lý âm thanh...</span>
              <span id="export-percent-text" style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-cyan);">0%</span>
            </div>
            <div class="progress-bar-wrap">
              <div class="progress-bar-fill" id="export-progress-bar"></div>
            </div>
          </div>

          <!-- Download result area -->
          <div id="export-result-container" style="display: none; flex-direction: column; gap: 12px; margin-top: 10px;">
            <audio id="export-result-audio" controls style="width: 100%; border-radius: var(--radius-md);"></audio>
            <a id="export-download-link" class="btn btn-success" style="width: 100%; text-decoration: none; font-size: 0.95rem;">
              ${icons.download}
              Tải file âm thanh đã nối về máy
            </a>
          </div>
        </div>

        <div class="modal-footer" id="export-modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-export">Đóng</button>
          <button type="button" class="btn btn-primary" id="btn-start-export">
            ${icons.sparkles}
            Bắt đầu Ghép & Xuất file
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.modalEl = backdrop;

    this.attachEvents();
  }

  attachEvents() {
    const closeBtn = this.modalEl.querySelector('#btn-close-export');
    const cancelBtn = this.modalEl.querySelector('#btn-cancel-export');
    const startBtn = this.modalEl.querySelector('#btn-start-export');
    const formatBtns = this.modalEl.querySelectorAll('#export-format-group .segment-btn');
    const bitrateBtns = this.modalEl.querySelectorAll('#export-bitrate-group .segment-btn');
    const channelBtns = this.modalEl.querySelectorAll('#export-channels-group .segment-btn');
    const mp3Group = this.modalEl.querySelector('#mp3-bitrate-group');
    const filenameInput = this.modalEl.querySelector('#export-filename');

    const close = () => this.close();
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) close();
    });

    formatBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        formatBtns.forEach(b => b.classList.toggle('active', b === btn));
        const format = btn.dataset.format;
        mp3Group.style.display = format === 'mp3' ? 'flex' : 'none';
        
        const currentName = filenameInput.value;
        const baseName = currentName.substring(0, currentName.lastIndexOf('.')) || currentName;
        filenameInput.value = `${baseName}.${format}`;
      });
    });

    bitrateBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        bitrateBtns.forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    channelBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        channelBtns.forEach(b => b.classList.toggle('active', b === btn));
      });
    });

    startBtn.addEventListener('click', () => {
      this.runExport();
    });
  }

  open(tracks, globalOptions) {
    this.tracks = tracks;
    this.globalOptions = globalOptions;
    
    // Reset UI
    this.modalEl.querySelector('#export-progress-container').style.display = 'none';
    this.modalEl.querySelector('#export-result-container').style.display = 'none';
    this.modalEl.querySelector('#export-modal-footer').style.display = 'flex';
    this.modalEl.classList.add('open');
  }

  close() {
    this.modalEl.classList.remove('open');
  }

  async runExport() {
    const activeTracks = this.tracks.filter(t => !t.muted);
    if (activeTracks.length === 0) {
      alert('Không có audio track nào để xuất!');
      return;
    }

    const formatBtn = this.modalEl.querySelector('#export-format-group .segment-btn.active');
    const format = formatBtn ? formatBtn.dataset.format : 'mp3';

    const bitrateBtn = this.modalEl.querySelector('#export-bitrate-group .segment-btn.active');
    const bitRate = bitrateBtn ? parseInt(bitrateBtn.dataset.bitrate, 10) : 192;

    const channelsBtn = this.modalEl.querySelector('#export-channels-group .segment-btn.active');
    const channels = channelsBtn ? parseInt(channelsBtn.dataset.channels, 10) : 2;

    const filenameInput = this.modalEl.querySelector('#export-filename');
    const filename = filenameInput.value.trim() || `stitched_audio.${format}`;

    const progressContainer = this.modalEl.querySelector('#export-progress-container');
    const progressBar = this.modalEl.querySelector('#export-progress-bar');
    const percentText = this.modalEl.querySelector('#export-percent-text');
    const statusText = this.modalEl.querySelector('#export-status-text');
    const resultContainer = this.modalEl.querySelector('#export-result-container');
    const resultAudio = this.modalEl.querySelector('#export-result-audio');
    const downloadLink = this.modalEl.querySelector('#export-download-link');
    const footer = this.modalEl.querySelector('#export-modal-footer');

    progressContainer.style.display = 'flex';
    resultContainer.style.display = 'none';
    footer.style.display = 'none';

    statusText.textContent = 'Đang ghép nối timeline & khoảng lặng...';
    progressBar.style.width = '20%';
    percentText.textContent = '20%';

    try {
      // 1. Concatenate in OfflineAudioContext
      await new Promise(r => setTimeout(r, 50));
      const renderedBuffer = await concatenateAudio(activeTracks, {
        crossfade: this.globalOptions.crossfade || 0,
        normalizeAll: this.globalOptions.normalizeAll || false,
        channels: channels,
        sampleRate: 44100
      });

      statusText.textContent = `Đang mã hóa định dạng ${format.toUpperCase()}...`;
      progressBar.style.width = '50%';
      percentText.textContent = '50%';

      let blob;
      if (format === 'wav') {
        blob = encodeWAV(renderedBuffer, { channels });
        progressBar.style.width = '100%';
        percentText.textContent = '100%';
      } else {
        blob = await encodeMP3(renderedBuffer, {
          bitRate,
          channels,
          onProgress: (pct) => {
            const mapped = Math.round(50 + (pct * 0.5));
            progressBar.style.width = `${mapped}%`;
            percentText.textContent = `${mapped}%`;
          }
        });
      }

      statusText.textContent = 'Ghép nối thành công!';
      
      const blobUrl = URL.createObjectURL(blob);
      resultAudio.src = blobUrl;
      downloadLink.href = blobUrl;
      downloadLink.download = filename;

      resultContainer.style.display = 'flex';
      
      // Trigger instant automatic download
      downloadLink.click();

    } catch (error) {
      console.error(error);
      statusText.textContent = 'Lỗi trong quá trình xuất: ' + error.message;
      footer.style.display = 'flex';
    }
  }
}
