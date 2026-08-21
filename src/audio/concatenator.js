import { analyzeAudioLoudness } from './decoder.js';

/**
 * Calculates timeline layout for tracks, computing exact start and end times.
 * @param {Array<Object>} tracks
 * @param {Object} [globalOptions]
 * @param {number} [globalOptions.crossfade=0]
 * @returns {{ timelineItems: Array<Object>, totalDuration: number }}
 */
export function calculateTimeline(tracks, globalOptions = {}) {
  const crossfade = Math.max(0, globalOptions.crossfade || 0);
  const activeTracks = tracks.filter(t => !t.muted);
  
  if (activeTracks.length === 0) {
    return { timelineItems: [], totalDuration: 0 };
  }

  const timelineItems = [];
  let currentTime = 0;

  for (let i = 0; i < activeTracks.length; i++) {
    const track = activeTracks[i];
    const trimStart = Math.max(0, track.trimStart || 0);
    const trimEnd = Math.min(track.audioBuffer.duration, Math.max(trimStart + 0.02, track.trimEnd ?? track.audioBuffer.duration));
    const effectiveDuration = Math.max(0.02, trimEnd - trimStart);

    let startTime = currentTime;

    // If there is crossfade and silenceAfter is 0 and not first track
    if (i > 0 && crossfade > 0 && (activeTracks[i - 1].silenceAfter || 0) === 0) {
      const maxOverlap = Math.min(crossfade, timelineItems[i - 1].effectiveDuration * 0.4, effectiveDuration * 0.4);
      startTime = Math.max(0, currentTime - maxOverlap);
    }

    const endTime = startTime + effectiveDuration;
    const silenceAfter = Math.max(0, track.silenceAfter || 0);

    timelineItems.push({
      track,
      trimStart,
      trimEnd,
      effectiveDuration,
      startTime,
      endTime,
      silenceAfter
    });

    // Advance currentTime for next track
    currentTime = endTime + silenceAfter;
  }

  const totalDuration = timelineItems.length > 0
    ? timelineItems[timelineItems.length - 1].endTime
    : 0;

  return { timelineItems, totalDuration };
}

/**
 * Renders all tracks into a single concatenated AudioBuffer using OfflineAudioContext.
 * @param {Array<Object>} tracks
 * @param {Object} [options]
 * @param {number} [options.crossfade=0]
 * @param {boolean} [options.normalizeAll=false]
 * @param {number} [options.sampleRate=44100]
 * @param {number} [options.channels=2]
 * @returns {Promise<AudioBuffer>}
 */
export async function concatenateAudio(tracks, options = {}) {
  const activeTracks = tracks.filter(t => !t.muted);
  if (activeTracks.length === 0) {
    throw new Error('Không có audio track nào để nối (hoặc tất cả đã bị tắt tiếng).');
  }

  const sampleRate = options.sampleRate || 44100;
  const numChannels = options.channels || 2;
  const { timelineItems, totalDuration } = calculateTimeline(activeTracks, options);

  if (totalDuration <= 0) {
    throw new Error('Thời lượng tổng thể bằng 0.');
  }

  const totalFrames = Math.max(1, Math.ceil(totalDuration * sampleRate));
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offlineCtx = new OfflineCtx(numChannels, totalFrames, sampleRate);

  // Master gain
  const masterGain = offlineCtx.createGain();
  masterGain.connect(offlineCtx.destination);

  for (let i = 0; i < timelineItems.length; i++) {
    const item = timelineItems[i];
    const track = item.track;
    const sourceNode = offlineCtx.createBufferSource();
    sourceNode.buffer = track.audioBuffer;

    const gainNode = offlineCtx.createGain();
    let trackGain = track.volume !== undefined ? track.volume : 1.0;

    // Apply normalization if enabled
    if (options.normalizeAll) {
      const loudness = analyzeAudioLoudness(track.audioBuffer);
      trackGain *= loudness.recommendedGain;
    }

    gainNode.gain.setValueAtTime(trackGain, item.startTime);

    // Apply Fade In
    const fadeIn = Math.max(0, track.fadeIn || 0);
    if (fadeIn > 0) {
      const fadeInDuration = Math.min(fadeIn, item.effectiveDuration);
      gainNode.gain.setValueAtTime(0.0001, item.startTime);
      gainNode.gain.linearRampToValueAtTime(trackGain, item.startTime + fadeInDuration);
    }

    // Apply Fade Out
    const fadeOut = Math.max(0, track.fadeOut || 0);
    if (fadeOut > 0) {
      const fadeOutDuration = Math.min(fadeOut, item.effectiveDuration);
      gainNode.gain.setValueAtTime(trackGain, item.endTime - fadeOutDuration);
      gainNode.gain.linearRampToValueAtTime(0.0001, item.endTime);
    }

    // Apply Crossfade if configured
    const crossfade = options.crossfade || 0;
    if (crossfade > 0 && (i > 0 || i < timelineItems.length - 1)) {
      // If previous item overlaps with this
      if (i > 0 && item.startTime < timelineItems[i - 1].endTime) {
        const overlap = timelineItems[i - 1].endTime - item.startTime;
        gainNode.gain.setValueAtTime(0.0001, item.startTime);
        gainNode.gain.linearRampToValueAtTime(trackGain, item.startTime + overlap);
      }
    }

    sourceNode.connect(gainNode);
    gainNode.connect(masterGain);

    // Start with offset corresponding to trimStart
    sourceNode.start(item.startTime, item.trimStart, item.effectiveDuration);
  }

  // Render the audio graph to buffer
  const renderedBuffer = await offlineCtx.startRendering();
  return renderedBuffer;
}
