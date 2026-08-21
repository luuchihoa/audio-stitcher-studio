import { getAudioContext } from './audioContext.js';

/**
 * Decodes a File or Blob or ArrayBuffer to an AudioBuffer.
 * @param {File|Blob|ArrayBuffer} input
 * @returns {Promise<AudioBuffer>}
 */
export async function decodeAudioData(input) {
  const ctx = getAudioContext();
  let arrayBuffer;
  
  if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else if (input instanceof Blob || input instanceof File) {
    arrayBuffer = await input.arrayBuffer();
  } else {
    throw new Error('Unsupported audio input format');
  }

  // Clone buffer because decodeAudioData can detach it in some browsers
  const bufferCopy = arrayBuffer.slice(0);
  return await ctx.decodeAudioData(bufferCopy);
}

/**
 * Extracts waveform peak data from an AudioBuffer.
 * @param {AudioBuffer} audioBuffer
 * @param {number} numBins - Number of visual peaks to generate
 * @returns {{ peaks: Float32Array, maxPeak: number }}
 */
export function extractWaveformData(audioBuffer, numBins = 150) {
  const channels = audioBuffer.numberOfChannels;
  const totalLength = audioBuffer.length;
  const blockSize = Math.max(1, Math.floor(totalLength / numBins));
  const peaks = new Float32Array(numBins);
  let globalMax = 0.0001;

  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < numBins; i++) {
      const start = i * blockSize;
      const end = Math.min(start + blockSize, totalLength);
      let peak = 0;
      for (let j = start; j < end; j += 4) { // step by 4 for high-speed sampling
        const absVal = Math.abs(channelData[j]);
        if (absVal > peak) peak = absVal;
      }
      if (peak > peaks[i]) {
        peaks[i] = peak;
      }
      if (peak > globalMax) {
        globalMax = peak;
      }
    }
  }

  // Normalize peaks between 0 and 1
  for (let i = 0; i < numBins; i++) {
    peaks[i] = peaks[i] / globalMax;
  }

  return { peaks, maxPeak: globalMax };
}

/**
 * Calculates RMS and Peak gain of an AudioBuffer to support audio normalization.
 * @param {AudioBuffer} audioBuffer
 * @returns {{ peak: number, rms: number, recommendedGain: number }}
 */
export function analyzeAudioLoudness(audioBuffer) {
  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  let maxPeak = 0.00001;
  let sumSquares = 0;
  let totalSamples = 0;

  for (let ch = 0; ch < channels; ch++) {
    const channelData = audioBuffer.getChannelData(ch);
    for (let i = 0; i < length; i += 10) { // sampled for speed
      const val = Math.abs(channelData[i]);
      if (val > maxPeak) maxPeak = val;
      sumSquares += val * val;
      totalSamples++;
    }
  }

  const rms = Math.sqrt(sumSquares / totalSamples);
  // Target peak normalization to ~ -0.5 dB (0.94)
  const targetPeak = 0.94;
  const recommendedGain = maxPeak > 0.01 ? Math.min(3.0, targetPeak / maxPeak) : 1.0;

  return {
    peak: maxPeak,
    rms,
    recommendedGain
  };
}
