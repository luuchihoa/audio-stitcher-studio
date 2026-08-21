import { Mp3Encoder } from '@breezystack/lamejs';

/**
 * Encodes an AudioBuffer into an MP3 Blob with progress callback.
 * @param {AudioBuffer} audioBuffer
 * @param {Object} options
 * @param {number} [options.bitRate=192] - Bitrate in kbps (128, 192, 256, 320)
 * @param {number} [options.sampleRate]
 * @param {number} [options.channels]
 * @param {Function} [options.onProgress] - Callback (percent: number) => void
 * @returns {Promise<Blob>}
 */
export async function encodeMP3(audioBuffer, options = {}) {
  const numChannels = options.channels || Math.min(2, audioBuffer.numberOfChannels);
  const sampleRate = options.sampleRate || audioBuffer.sampleRate;
  const bitRate = options.bitRate || 192;
  const onProgress = options.onProgress || (() => {});

  if (!Mp3Encoder) {
    throw new Error('Không thể tải bộ mã hóa MP3.');
  }

  const mp3encoder = new Mp3Encoder(numChannels, sampleRate, bitRate);
  const length = audioBuffer.length;
  const mp3Data = [];

  // Convert Float32Array to Int16Array
  const leftSource = audioBuffer.getChannelData(0);
  const rightSource = numChannels > 1 ? audioBuffer.getChannelData(1) : leftSource;

  const leftInt16 = new Int16Array(length);
  const rightInt16 = numChannels > 1 ? new Int16Array(length) : null;

  for (let i = 0; i < length; i++) {
    // Left channel
    let lSample = Math.max(-1, Math.min(1, leftSource[i]));
    leftInt16[i] = lSample < 0 ? lSample * 0x8000 : lSample * 0x7FFF;

    // Right channel (if stereo)
    if (rightInt16) {
      let rSample = Math.max(-1, Math.min(1, rightSource[i]));
      rightInt16[i] = rSample < 0 ? rSample * 0x8000 : rSample * 0x7FFF;
    }
  }

  const chunkSize = 1152; // LAME standard frame sample size

  for (let i = 0; i < length; i += chunkSize) {
    const chunkEnd = Math.min(i + chunkSize, length);
    const leftChunk = leftInt16.subarray(i, chunkEnd);
    
    let mp3buf;
    if (numChannels === 1) {
      mp3buf = mp3encoder.encodeBuffer(leftChunk);
    } else {
      const rightChunk = rightInt16.subarray(i, chunkEnd);
      mp3buf = mp3encoder.encodeBuffer(leftChunk, rightChunk);
    }

    if (mp3buf && mp3buf.length > 0) {
      mp3Data.push(mp3buf);
    }

    // Yield back to browser every few iterations so UI remains responsive
    if ((i / chunkSize) % 50 === 0) {
      const percent = Math.min(99, Math.round(((i + chunkSize) / length) * 100));
      onProgress(percent);
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  // Flush remaining buffers
  const endBuf = mp3encoder.flush();
  if (endBuf && endBuf.length > 0) {
    mp3Data.push(endBuf);
  }

  onProgress(100);

  return new Blob(mp3Data, { type: 'audio/mp3' });
}
