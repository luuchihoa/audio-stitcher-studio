import { getAudioContext } from './audioContext.js';

/**
 * Converts decibels (dB) to linear amplitude (0.0 to 1.0)
 * @param {number} db e.g. -45
 * @returns {number} e.g. ~0.0056
 */
export function dbToLinear(db) {
  return Math.pow(10, db / 20);
}

/**
 * Detects silent regions in an AudioBuffer using windowed RMS/Peak analysis.
 * @param {AudioBuffer} audioBuffer
 * @param {Object} [options]
 * @param {number} [options.thresholdDb=-45] Silence threshold in dB (default -45dB)
 * @param {number} [options.minDuration=0.5] Minimum silence duration in seconds to consider (default 0.5s)
 * @param {number} [options.windowMs=20] Analysis window in ms (default 20ms)
 * @returns {Array<{ start: number, end: number, duration: number }>}
 */
export function detectSilenceRegions(audioBuffer, options = {}) {
  const thresholdDb = options.thresholdDb ?? -45;
  const minDuration = options.minDuration ?? 0.5;
  const windowMs = options.windowMs ?? 20;

  const threshold = dbToLinear(thresholdDb);
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const totalLength = audioBuffer.length;
  const windowSize = Math.max(1, Math.floor((windowMs / 1000) * sampleRate));

  const silenceRegions = [];
  let inSilence = false;
  let silenceStartIndex = 0;

  // Sample data channels
  const channelData = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(audioBuffer.getChannelData(ch));
  }

  for (let i = 0; i < totalLength; i += windowSize) {
    const end = Math.min(i + windowSize, totalLength);
    let maxPeak = 0;

    for (let ch = 0; ch < numChannels; ch++) {
      const data = channelData[ch];
      for (let j = i; j < end; j += 4) { // step by 4 for high-speed analysis
        const absVal = Math.abs(data[j]);
        if (absVal > maxPeak) maxPeak = absVal;
      }
    }

    const isSilent = maxPeak < threshold;

    if (isSilent) {
      if (!inSilence) {
        inSilence = true;
        silenceStartIndex = i;
      }
    } else {
      if (inSilence) {
        inSilence = false;
        const silenceEndIndex = i;
        const duration = (silenceEndIndex - silenceStartIndex) / sampleRate;
        if (duration >= minDuration) {
          silenceRegions.push({
            start: silenceStartIndex / sampleRate,
            end: silenceEndIndex / sampleRate,
            duration: duration,
            startSample: silenceStartIndex,
            endSample: silenceEndIndex
          });
        }
      }
    }
  }

  // If ends in silence
  if (inSilence) {
    const duration = (totalLength - silenceStartIndex) / sampleRate;
    if (duration >= minDuration) {
      silenceRegions.push({
        start: silenceStartIndex / sampleRate,
        end: totalLength / sampleRate,
        duration: duration,
        startSample: silenceStartIndex,
        endSample: totalLength
      });
    }
  }

  return silenceRegions;
}

/**
 * Truncates / shortens all silent regions in an AudioBuffer that exceed maxSilence down to maxSilence.
 * E.g., a 1.0s silence becomes 0.5s, while keeping natural room tone and applying micro-crossfade.
 * 
 * @param {AudioBuffer} audioBuffer
 * @param {Object} [options]
 * @param {number} [options.maxSilence=0.5] Maximum silence duration in seconds to keep (default 0.5s)
 * @param {number} [options.thresholdDb=-45] Silence detection threshold in dB (default -45dB)
 * @param {number} [options.crossfadeMs=4] Micro-crossfade duration in ms (default 4ms)
 * @returns {{ buffer: AudioBuffer, regionsCount: number, timeSaved: number }}
 */
export function truncateSilenceAudioBuffer(audioBuffer, options = {}) {
  const maxSilence = Math.max(0.1, options.maxSilence ?? 0.5);
  const thresholdDb = options.thresholdDb ?? -45;
  const crossfadeMs = options.crossfadeMs ?? 4;

  const silenceRegions = detectSilenceRegions(audioBuffer, {
    thresholdDb,
    minDuration: maxSilence + 0.05 // only regions strictly exceeding maxSilence
  });

  if (silenceRegions.length === 0) {
    return {
      buffer: audioBuffer,
      regionsCount: 0,
      timeSaved: 0
    };
  }

  const ctx = getAudioContext();
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const totalLength = audioBuffer.length;

  // Calculate cut segments to remove from the buffer
  // For each silence region:
  // keep startPadding (maxSilence/2) at the beginning of the silence
  // keep endPadding (maxSilence/2) at the end of the silence
  // cut out the middle excess
  const cuts = [];
  let totalSamplesRemoved = 0;

  for (const region of silenceRegions) {
    const keepSamples = Math.floor(maxSilence * sampleRate);
    const regionSamples = region.endSample - region.startSample;
    const excessSamples = regionSamples - keepSamples;

    if (excessSamples > 0) {
      const halfKeep = Math.floor(keepSamples / 2);
      const cutStart = region.startSample + halfKeep;
      const cutEnd = cutStart + excessSamples;

      cuts.push({
        cutStart,
        cutEnd,
        excessSamples
      });
      totalSamplesRemoved += excessSamples;
    }
  }

  if (cuts.length === 0) {
    return {
      buffer: audioBuffer,
      regionsCount: 0,
      timeSaved: 0
    };
  }

  const xfadeSamples = Math.floor((crossfadeMs / 1000) * sampleRate);
  const newLength = Math.max(1, totalLength - totalSamplesRemoved);
  const newBuffer = ctx.createBuffer(numChannels, newLength, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const destData = newBuffer.getChannelData(ch);

    let srcPos = 0;
    let destPos = 0;

    for (let c = 0; c < cuts.length; c++) {
      const cut = cuts[c];
      
      // Copy segment before cut
      const segLength = cut.cutStart - srcPos;
      if (segLength > 0 && destPos + segLength <= newLength) {
        destData.set(sourceData.subarray(srcPos, cut.cutStart), destPos);
        destPos += segLength;
      }

      // Apply micro-crossfade between the two sides of the cut
      if (xfadeSamples > 0 && destPos >= xfadeSamples && cut.cutEnd + xfadeSamples <= totalLength) {
        const destXfadeStart = destPos - xfadeSamples;
        const p1XfadeStart = cut.cutStart - xfadeSamples;
        const p2XfadeStart = cut.cutEnd;

        for (let i = 0; i < xfadeSamples; i++) {
          const progress = i / xfadeSamples;
          const gain1 = Math.cos(progress * 0.5 * Math.PI);
          const gain2 = Math.sin(progress * 0.5 * Math.PI);

          const s1 = sourceData[p1XfadeStart + i];
          const s2 = sourceData[p2XfadeStart + i];
          destData[destXfadeStart + i] = (s1 * gain1) + (s2 * gain2);
        }

        // Jump source position past the cut and past the crossfade overlap
        srcPos = cut.cutEnd + xfadeSamples;
      } else {
        srcPos = cut.cutEnd;
      }
    }

    // Copy remaining tail
    if (srcPos < totalLength) {
      const remaining = totalLength - srcPos;
      const copyLen = Math.min(remaining, newLength - destPos);
      if (copyLen > 0) {
        destData.set(sourceData.subarray(srcPos, srcPos + copyLen), destPos);
      }
    }
  }

  const timeSaved = totalSamplesRemoved / sampleRate;

  return {
    buffer: newBuffer,
    regionsCount: cuts.length,
    timeSaved: timeSaved
  };
}

/**
 * Truncates gap silences between tracks on the timeline if they exceed maxSilence.
 * @param {Array<Object>} tracks
 * @param {number} [maxSilence=0.5]
 * @returns {{ adjustedCount: number, timeSaved: number }}
 */
export function truncateTimelineSilences(tracks, maxSilence = 0.5) {
  let adjustedCount = 0;
  let timeSaved = 0;

  for (let i = 0; i < tracks.length - 1; i++) {
    const track = tracks[i];
    const currentSilence = track.silenceAfter || 0;
    if (currentSilence > maxSilence) {
      const diff = currentSilence - maxSilence;
      track.silenceAfter = maxSilence;
      adjustedCount++;
      timeSaved += diff;
    }
  }

  return { adjustedCount, timeSaved };
}
