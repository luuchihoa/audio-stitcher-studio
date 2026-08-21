/**
 * Encodes an AudioBuffer into a WAV Blob (16-bit PCM).
 * @param {AudioBuffer} audioBuffer
 * @param {Object} options
 * @param {number} [options.sampleRate]
 * @param {number} [options.channels]
 * @returns {Blob}
 */
export function encodeWAV(audioBuffer, options = {}) {
  const numChannels = options.channels || audioBuffer.numberOfChannels;
  const sampleRate = options.sampleRate || audioBuffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const length = audioBuffer.length;
  const dataByteLength = length * blockAlign;
  const headerByteLength = 44;
  const totalLength = headerByteLength + dataByteLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  // Helper to write ASCII strings
  function writeString(offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  // RIFF chunk descriptor
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataByteLength, true);
  writeString(8, 'WAVE');

  // fmt sub-chunk
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat (1 = PCM)
  view.setUint16(22, numChannels, true); // NumChannels
  view.setUint32(24, sampleRate, true); // SampleRate
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true); // BlockAlign
  view.setUint16(34, bitDepth, true); // BitsPerSample

  // data sub-chunk
  writeString(36, 'data');
  view.setUint32(40, dataByteLength, true);

  // Interleave and quantize channel data
  const channels = [];
  for (let i = 0; i < numChannels; i++) {
    // If source has fewer channels, duplicate channel 0
    const chIndex = Math.min(i, audioBuffer.numberOfChannels - 1);
    channels.push(audioBuffer.getChannelData(chIndex));
  }

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channels[ch][i];
      // Clamp sample between -1.0 and 1.0
      sample = Math.max(-1, Math.min(1, sample));
      // Convert float [-1.0, 1.0] to 16-bit signed integer [-32768, 32767]
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}
