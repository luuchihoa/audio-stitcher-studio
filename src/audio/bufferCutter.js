import { getAudioContext } from './audioContext.js';

/**
 * Creates a sliced copy of an AudioBuffer from startTime to endTime.
 * @param {AudioBuffer} audioBuffer
 * @param {number} startTime (seconds)
 * @param {number} endTime (seconds)
 * @returns {AudioBuffer}
 */
export function sliceAudioBuffer(audioBuffer, startTime, endTime) {
  const ctx = getAudioContext();
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const duration = audioBuffer.duration;

  const validStart = Math.max(0, Math.min(duration, startTime));
  const validEnd = Math.max(validStart + 0.01, Math.min(duration, endTime));

  const startSample = Math.floor(validStart * sampleRate);
  const endSample = Math.floor(validEnd * sampleRate);
  const frameCount = Math.max(1, endSample - startSample);

  const newBuffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const destData = newBuffer.getChannelData(ch);
    const slice = sourceData.subarray(startSample, endSample);
    destData.set(slice);
  }

  return newBuffer;
}

/**
 * Cuts out (deletes) a middle section [cutStart, cutEnd] and splices the two outer halves
 * together using an equal-power micro-crossfade to eliminate any pop/click artifacts.
 * @param {AudioBuffer} audioBuffer
 * @param {number} cutStart (seconds)
 * @param {number} cutEnd (seconds)
 * @param {number} [crossfadeMs=4] Micro-crossfade duration in ms (default 4ms)
 * @returns {AudioBuffer}
 */
export function spliceCutOutAudioBuffer(audioBuffer, cutStart, cutEnd, crossfadeMs = 4) {
  const ctx = getAudioContext();
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const duration = audioBuffer.duration;

  const validCutStart = Math.max(0, Math.min(duration, cutStart));
  const validCutEnd = Math.max(validCutStart, Math.min(duration, cutEnd));

  // If cut spans the whole buffer, return minimal silence
  if (validCutStart <= 0 && validCutEnd >= duration) {
    return ctx.createBuffer(numChannels, 100, sampleRate);
  }

  const startSample = Math.floor(validCutStart * sampleRate);
  const endSample = Math.floor(validCutEnd * sampleRate);

  const part1Length = startSample;
  const part2Length = audioBuffer.length - endSample;

  // Number of samples for micro-crossfade
  const xfadeSamples = Math.min(
    Math.floor((crossfadeMs / 1000) * sampleRate),
    Math.floor(part1Length / 2),
    Math.floor(part2Length / 2)
  );

  const finalLength = Math.max(1, part1Length + part2Length - (xfadeSamples > 0 ? xfadeSamples : 0));
  const splicedBuffer = ctx.createBuffer(numChannels, finalLength, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const destData = splicedBuffer.getChannelData(ch);

    // Copy part 1 (excluding crossfade overlap area)
    if (part1Length > 0) {
      const p1CoreLen = part1Length - xfadeSamples;
      if (p1CoreLen > 0) {
        destData.set(sourceData.subarray(0, p1CoreLen), 0);
      }
    }

    // Apply micro-crossfade if applicable
    if (xfadeSamples > 0 && part1Length > 0 && part2Length > 0) {
      const p1XfadeStart = part1Length - xfadeSamples;
      const p2XfadeStart = endSample;
      const destXfadeStart = part1Length - xfadeSamples;

      for (let i = 0; i < xfadeSamples; i++) {
        const progress = i / xfadeSamples; // 0 to 1
        // Equal power curve
        const gain1 = Math.cos(progress * 0.5 * Math.PI);
        const gain2 = Math.sin(progress * 0.5 * Math.PI);

        const sample1 = sourceData[p1XfadeStart + i];
        const sample2 = sourceData[p2XfadeStart + i];
        destData[destXfadeStart + i] = (sample1 * gain1) + (sample2 * gain2);
      }
    }

    // Copy remaining part 2
    if (part2Length > 0) {
      const p2CoreStart = endSample + xfadeSamples;
      const p2CoreLen = audioBuffer.length - p2CoreStart;
      const destP2Start = part1Length; // right after crossfade
      if (p2CoreLen > 0) {
        destData.set(sourceData.subarray(p2CoreStart), destP2Start);
      }
    }
  }

  return splicedBuffer;
}

/**
 * Splits an AudioBuffer into two separate AudioBuffers at splitTime.
 * @param {AudioBuffer} audioBuffer
 * @param {number} splitTime (seconds)
 * @returns {{ partA: AudioBuffer, partB: AudioBuffer }}
 */
export function splitAudioBuffer(audioBuffer, splitTime) {
  const duration = audioBuffer.duration;
  const validSplit = Math.max(0.02, Math.min(duration - 0.02, splitTime));

  const partA = sliceAudioBuffer(audioBuffer, 0, validSplit);
  const partB = sliceAudioBuffer(audioBuffer, validSplit, duration);

  return { partA, partB };
}

/**
 * Inserts a custom silence duration into an AudioBuffer at insertTime.
 * E.g., inserting 1.5s of silence at 2.0s into a 4.0s track produces a 5.5s track.
 * 
 * @param {AudioBuffer} audioBuffer
 * @param {number} insertTime (seconds)
 * @param {number} silenceDuration (seconds)
 * @param {number} [fadeMs=3] Micro-fade duration in ms to avoid pops
 * @returns {AudioBuffer}
 */
export function insertSilenceIntoAudioBuffer(audioBuffer, insertTime, silenceDuration, fadeMs = 3) {
  const ctx = getAudioContext();
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const duration = audioBuffer.duration;

  const validInsertTime = Math.max(0, Math.min(duration, insertTime));
  const validSilence = Math.max(0.01, silenceDuration);

  const insertSample = Math.floor(validInsertTime * sampleRate);
  const silenceSamples = Math.round(validSilence * sampleRate);
  const totalLength = audioBuffer.length + silenceSamples;

  const newBuffer = ctx.createBuffer(numChannels, totalLength, sampleRate);
  const fadeSamples = Math.min(Math.floor((fadeMs / 1000) * sampleRate), insertSample, audioBuffer.length - insertSample);

  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const destData = newBuffer.getChannelData(ch);

    // Part 1: before insert point
    if (insertSample > 0) {
      destData.set(sourceData.subarray(0, insertSample), 0);

      // Micro fade-out at end of Part 1
      if (fadeSamples > 0) {
        const startFade = insertSample - fadeSamples;
        for (let i = 0; i < fadeSamples; i++) {
          const gain = 1 - (i / fadeSamples);
          destData[startFade + i] *= gain;
        }
      }
    }

    // Silence area: zero samples (already initialized to 0 in AudioBuffer)

    // Part 2: after insert point
    const part2Len = audioBuffer.length - insertSample;
    if (part2Len > 0) {
      const destPart2Start = insertSample + silenceSamples;
      destData.set(sourceData.subarray(insertSample), destPart2Start);

      // Micro fade-in at start of Part 2
      if (fadeSamples > 0) {
        for (let i = 0; i < fadeSamples; i++) {
          const gain = (i / fadeSamples);
          destData[destPart2Start + i] *= gain;
        }
      }
    }
  }

  return newBuffer;
}

/**
 * Mutes (silences) a specific time range [startTime, endTime] within an AudioBuffer.
 * Keeps total track duration unchanged.
 * 
 * @param {AudioBuffer} audioBuffer
 * @param {number} startTime (seconds)
 * @param {number} endTime (seconds)
 * @param {number} [fadeMs=3] Micro-fade duration in ms
 * @returns {AudioBuffer}
 */
export function muteRegionAudioBuffer(audioBuffer, startTime, endTime, fadeMs = 3) {
  const ctx = getAudioContext();
  const sampleRate = audioBuffer.sampleRate;
  const numChannels = audioBuffer.numberOfChannels;
  const duration = audioBuffer.duration;

  const validStart = Math.max(0, Math.min(duration, startTime));
  const validEnd = Math.max(validStart, Math.min(duration, endTime));

  const startSample = Math.floor(validStart * sampleRate);
  const endSample = Math.floor(validEnd * sampleRate);
  const fadeSamples = Math.floor((fadeMs / 1000) * sampleRate);

  const newBuffer = ctx.createBuffer(numChannels, audioBuffer.length, sampleRate);

  for (let ch = 0; ch < numChannels; ch++) {
    const sourceData = audioBuffer.getChannelData(ch);
    const destData = newBuffer.getChannelData(ch);

    // Copy entire source buffer first
    destData.set(sourceData);

    // Fade out leading into mute
    if (fadeSamples > 0 && startSample >= fadeSamples) {
      const fStart = startSample - fadeSamples;
      for (let i = 0; i < fadeSamples; i++) {
        const gain = 1 - (i / fadeSamples);
        destData[fStart + i] *= gain;
      }
    }

    // Zero out the target muted region
    for (let i = startSample; i < endSample; i++) {
      destData[i] = 0;
    }

    // Fade in trailing out of mute
    if (fadeSamples > 0 && endSample + fadeSamples <= audioBuffer.length) {
      for (let i = 0; i < fadeSamples; i++) {
        const gain = (i / fadeSamples);
        destData[endSample + i] *= gain;
      }
    }
  }

  return newBuffer;
}
