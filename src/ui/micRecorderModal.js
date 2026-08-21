import { icons } from './icons.js';
import { decodeAudioData, extractWaveformData } from '../audio/decoder.js';

export class MicRecorderModal {
  constructor(onRecorded) {
    this.onRecorded = onRecorded;
    this.modalEl = null;
    this.mediaRecorder = null;
    this.audioChunks = [];
    this.stream = null;
    this.timerInterval = null;
    this.secondsRecorded = 0;
    this.initDOM();
  }

  initDOM() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'mic-recorder-backdrop';

    backdrop.innerHTML = `
      <div class="modal-card">
        <div class="modal-header">
          <div class="modal-title">
            ${icons.mic}
            <span>Thu âm trực tiếp từ Micro</span>
          </div>
          <button class="btn btn-secondary btn-icon" id="btn-close-recorder">
            ${icons.x}
          </button>
        </div>

        <div class="modal-body" style="align-items: center; text-align: center;">
          <div id="recorder-timecode" style="font-family: var(--font-mono); font-size: 2.2rem; font-weight: 700; color: var(--accent-cyan); margin: 10px 0;">
            00:00.0
          </div>
          
          <div id="recorder-status" style="font-size: 0.85rem; color: var(--text-secondary);">
            Nhấn nút bên dưới để bắt đầu thu âm
          </div>

          <div style="display: flex; gap: 14px; margin-top: 14px;">
            <button type="button" class="btn btn-primary" id="btn-toggle-record" style="min-width: 140px;">
              ${icons.mic}
              <span>Bắt đầu thu</span>
            </button>
            <button type="button" class="btn btn-secondary" id="btn-cancel-record" style="display: none;">
              Hủy
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.modalEl = backdrop;

    const closeBtn = backdrop.querySelector('#btn-close-recorder');
    const toggleBtn = backdrop.querySelector('#btn-toggle-record');
    const cancelBtn = backdrop.querySelector('#btn-cancel-record');

    const close = () => {
      this.stopStream();
      backdrop.classList.remove('open');
    };

    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);

    toggleBtn.addEventListener('click', () => {
      if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
        this.stopRecording();
      } else {
        this.startRecording();
      }
    });
  }

  open() {
    this.secondsRecorded = 0;
    this.modalEl.querySelector('#recorder-timecode').textContent = '00:00.0';
    this.modalEl.querySelector('#recorder-status').textContent = 'Nhấn nút bên dưới để bắt đầu thu âm';
    const toggleBtn = this.modalEl.querySelector('#btn-toggle-record');
    toggleBtn.innerHTML = `${icons.mic} <span>Bắt đầu thu</span>`;
    toggleBtn.className = 'btn btn-primary';
    this.modalEl.querySelector('#btn-cancel-record').style.display = 'none';
    this.modalEl.classList.add('open');
  }

  async startRecording() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.audioChunks = [];
      this.mediaRecorder = new MediaRecorder(this.stream);

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        try {
          const buffer = await decodeAudioData(audioBlob);
          const { peaks } = extractWaveformData(buffer, 120);
          
          const newTrack = {
            id: 'rec_' + Math.random().toString(36).substring(2, 9),
            name: `Thu_am_${new Date().toLocaleTimeString().replace(/:/g, '-')}.webm`,
            file: audioBlob,
            audioBuffer: buffer,
            duration: buffer.duration,
            trimStart: 0,
            trimEnd: buffer.duration,
            volume: 1.0,
            muted: false,
            fadeIn: 0,
            fadeOut: 0,
            silenceAfter: 0,
            waveformPeaks: peaks
          };

          this.onRecorded(newTrack);
          this.modalEl.classList.remove('open');
        } catch (err) {
          console.error(err);
          alert('Không thể giải mã bản thu âm: ' + err.message);
        }
        this.stopStream();
      };

      this.mediaRecorder.start(100);
      this.secondsRecorded = 0;
      
      const timeEl = this.modalEl.querySelector('#recorder-timecode');
      const statusEl = this.modalEl.querySelector('#recorder-status');
      const toggleBtn = this.modalEl.querySelector('#btn-toggle-record');
      const cancelBtn = this.modalEl.querySelector('#btn-cancel-record');

      statusEl.textContent = 'Đang thu âm... Hãy nói vào micro';
      toggleBtn.innerHTML = `${icons.stop} <span>Hoàn tất & Chèn</span>`;
      toggleBtn.className = 'btn btn-success';
      cancelBtn.style.display = 'inline-flex';

      this.timerInterval = setInterval(() => {
        this.secondsRecorded += 0.1;
        const mins = Math.floor(this.secondsRecorded / 60).toString().padStart(2, '0');
        const secs = (this.secondsRecorded % 60).toFixed(1).padStart(4, '0');
        timeEl.textContent = `${mins}:${secs}`;
      }, 100);

    } catch (err) {
      console.error(err);
      alert('Không thể truy cập Microphone: ' + err.message);
    }
  }

  stopRecording() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }
  }

  stopStream() {
    if (this.timerInterval) clearInterval(this.timerInterval);
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }
}
