let sharedContext = null;

/**
 * Returns a shared AudioContext instance, initializing it lazily.
 * @returns {AudioContext}
 */
export function getAudioContext() {
  if (!sharedContext) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    sharedContext = new AudioCtx();
  }
  if (sharedContext.state === 'suspended') {
    sharedContext.resume();
  }
  return sharedContext;
}

/**
 * Creates an empty AudioBuffer with specified duration and channels.
 * @param {number} channels 
 * @param {number} durationSeconds 
 * @param {number} sampleRate 
 * @returns {AudioBuffer}
 */
export function createSilenceBuffer(channels, durationSeconds, sampleRate = 44100) {
  const ctx = getAudioContext();
  const actualSampleRate = sampleRate || ctx.sampleRate;
  const frameCount = Math.max(1, Math.round(actualSampleRate * Math.max(0, durationSeconds)));
  const buffer = ctx.createBuffer(channels, frameCount, actualSampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    data.fill(0);
  }
  return buffer;
}
