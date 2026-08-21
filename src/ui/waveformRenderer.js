/**
 * Renders a high-resolution waveform onto a canvas element.
 * @param {HTMLCanvasElement} canvas
 * @param {Float32Array|Array<number>} peaks
 * @param {Object} options
 * @param {number} [options.trimStartPercent=0]
 * @param {number} [options.trimEndPercent=1]
 * @param {number} [options.playheadPercent=-1]
 * @param {string} [options.activeColor='#00f0ff']
 * @param {string} [options.dimColor='rgba(255, 255, 255, 0.15)']
 */
export function drawWaveform(canvas, peaks, options = {}) {
  if (!canvas || !peaks || peaks.length === 0) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width > 0 ? rect.width : (canvas.width || 300);
  const height = rect.height > 0 ? rect.height : (canvas.height || 50);

  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, width, height);

  const trimStartPercent = options.trimStartPercent ?? 0;
  const trimEndPercent = options.trimEndPercent ?? 1;
  const playheadPercent = options.playheadPercent ?? -1;

  const activeColor = options.activeColor || '#00f0ff';
  const dimColor = options.dimColor || 'rgba(255, 255, 255, 0.18)';

  const numBars = peaks.length;
  const barGap = 1.5;
  const totalBarWidth = width / numBars;
  const barWidth = Math.max(1, totalBarWidth - barGap);
  const centerY = height / 2;

  for (let i = 0; i < numBars; i++) {
    const barPercent = i / numBars;
    const isInsideTrim = barPercent >= trimStartPercent && barPercent <= trimEndPercent;
    const peak = Math.max(0.06, peaks[i]);
    const barHeight = peak * (height - 6);

    const x = i * totalBarWidth;
    const y = centerY - barHeight / 2;

    ctx.fillStyle = isInsideTrim ? activeColor : dimColor;
    
    // Draw rounded bar
    const radius = Math.min(barWidth / 2, 2);
    ctx.beginPath();
    ctx.roundRect(x, y, barWidth, barHeight, radius);
    ctx.fill();
  }

  // Draw playhead indicator if active
  if (playheadPercent >= 0 && playheadPercent <= 1) {
    const playheadX = playheadPercent * width;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();

    // Glow dot
    ctx.fillStyle = activeColor;
    ctx.beginPath();
    ctx.arc(playheadX, centerY, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
