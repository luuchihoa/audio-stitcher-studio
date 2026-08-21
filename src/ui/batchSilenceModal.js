import { icons } from './icons.js';

export class BatchSilenceModal {
  constructor(onApply) {
    this.onApply = onApply;
    this.modalEl = null;
    this.initDOM();
  }

  initDOM() {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    backdrop.id = 'batch-silence-backdrop';

    backdrop.innerHTML = `
      <div class="modal-card" style="max-width: 440px;">
        <div class="modal-header">
          <div class="modal-title">
            ${icons.clock}
            <span>Đặt khoảng lặng đồng loạt</span>
          </div>
          <button class="btn btn-secondary btn-icon" id="btn-close-batch-silence">
            ${icons.x}
          </button>
        </div>

        <div class="modal-body">
          <p style="font-size: 0.88rem; color: var(--text-secondary);">
            Thay đổi thời gian khoảng lặng giữa tất cả các đoạn audio trong danh sách cùng một lúc.
          </p>

          <div class="form-group">
            <label class="form-label">Chọn nhanh khoảng lặng (Presets)</label>
            <div class="segment-group" id="batch-presets-group">
              <button type="button" class="segment-btn active" data-val="0">0s (Liền nhau)</button>
              <button type="button" class="segment-btn" data-val="0.5">0.5s</button>
              <button type="button" class="segment-btn" data-val="1">1.0s</button>
              <button type="button" class="segment-btn" data-val="2">2.0s</button>
              <button type="button" class="segment-btn" data-val="3">3.0s</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">Hoặc nhập số giây tùy chỉnh</label>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="number" id="batch-custom-val" class="btn btn-secondary" style="width: 100%; text-align: left; font-family: var(--font-mono); font-size: 1rem;" min="0" max="60" step="0.1" value="0">
              <span style="color: var(--text-secondary); font-family: var(--font-mono); font-weight: 600;">giây</span>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" id="btn-cancel-batch-silence">Hủy</button>
          <button type="button" class="btn btn-primary" id="btn-apply-batch-silence">
            ${icons.check}
            Áp dụng cho toàn bộ
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(backdrop);
    this.modalEl = backdrop;

    const closeBtn = backdrop.querySelector('#btn-close-batch-silence');
    const cancelBtn = backdrop.querySelector('#btn-cancel-batch-silence');
    const applyBtn = backdrop.querySelector('#btn-apply-batch-silence');
    const inputVal = backdrop.querySelector('#batch-custom-val');
    const presetBtns = backdrop.querySelectorAll('#batch-presets-group .segment-btn');

    const close = () => backdrop.classList.remove('open');
    closeBtn.addEventListener('click', close);
    cancelBtn.addEventListener('click', close);

    presetBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        presetBtns.forEach(b => b.classList.toggle('active', b === btn));
        inputVal.value = btn.dataset.val;
      });
    });

    inputVal.addEventListener('input', () => {
      const val = parseFloat(inputVal.value);
      presetBtns.forEach(b => b.classList.toggle('active', parseFloat(b.dataset.val) === val));
    });

    applyBtn.addEventListener('click', () => {
      const val = Math.max(0, parseFloat(inputVal.value) || 0);
      this.onApply(val);
      close();
    });
  }

  open() {
    this.modalEl.classList.add('open');
  }
}
