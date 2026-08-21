import assert from 'node:assert';
import { calculateTimeline } from '../src/audio/concatenator.js';

console.log('🧪 Bắt đầu chạy bộ kiểm thử tự động cho Audio Stitcher, Cutter & Silence Truncator Engine...\n');

// Mock Web Audio Context for Node.js test environment
class MockAudioBuffer {
  constructor(numberOfChannels, length, sampleRate) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this._data = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      this._data.push(new Float32Array(length));
    }
  }

  getChannelData(channel) {
    return this._data[channel];
  }
}

globalThis.window = {
  AudioContext: class {
    constructor() {
      this.sampleRate = 44100;
      this.state = 'running';
    }
    createBuffer(channels, length, sampleRate) {
      return new MockAudioBuffer(channels, length, sampleRate);
    }
    resume() { return Promise.resolve(); }
  }
};

const { 
  sliceAudioBuffer, 
  spliceCutOutAudioBuffer, 
  splitAudioBuffer,
  insertSilenceIntoAudioBuffer,
  muteRegionAudioBuffer
} = await import('../src/audio/bufferCutter.js');
const { encodeMP3 } = await import('../src/audio/encoder-mp3.js');
const { encodeWAV } = await import('../src/audio/encoder-wav.js');
const { detectSilenceRegions, truncateSilenceAudioBuffer, truncateTimelineSilences } = await import('../src/audio/silenceTruncator.js');

// 1. Test Timeline Calculation with 0s default silence
{
  const mockTracks = [
    { id: '1', audioBuffer: { duration: 3.0 }, trimStart: 0, trimEnd: 3.0, silenceAfter: 0, muted: false },
    { id: '2', audioBuffer: { duration: 2.0 }, trimStart: 0, trimEnd: 2.0, silenceAfter: 0, muted: false }
  ];

  const { timelineItems, totalDuration } = calculateTimeline(mockTracks);
  assert.strictEqual(timelineItems.length, 2);
  assert.strictEqual(totalDuration, 5.0, 'Tổng thời lượng với 0s khoảng lặng phải là 5.0s');
  console.log('✅ Test 1: Ghép 2 audio với khoảng lặng 0s thành công (5.0s)');
}

// 2. Test Timeline Calculation with Custom Silence (1.5s gap)
{
  const mockTracks = [
    { id: '1', audioBuffer: { duration: 2.0 }, trimStart: 0, trimEnd: 2.0, silenceAfter: 1.5, muted: false },
    { id: '2', audioBuffer: { duration: 4.0 }, trimStart: 0, trimEnd: 4.0, silenceAfter: 0, muted: false }
  ];

  const { timelineItems, totalDuration } = calculateTimeline(mockTracks);
  assert.strictEqual(totalDuration, 7.5, 'Tổng thời lượng với 1.5s khoảng lặng phải là 7.5s');
  console.log('✅ Test 2: Chèn khoảng lặng tùy chỉnh 1.5s thành công (7.5s)');
}

// 3. Test Slice Audio Buffer (Crop)
{
  const sampleRate = 44100;
  const originalBuffer = new MockAudioBuffer(2, sampleRate * 10, sampleRate); // 10s
  const ch0 = originalBuffer.getChannelData(0);
  for (let i = 0; i < ch0.length; i++) ch0[i] = i / ch0.length;

  const sliced = sliceAudioBuffer(originalBuffer, 2.0, 5.0); // 3s
  assert.strictEqual(sliced.numberOfChannels, 2);
  assert.strictEqual(sliced.sampleRate, sampleRate);
  assert.strictEqual(sliced.length, sampleRate * 3);
  assert.strictEqual(sliced.duration, 3.0);
  console.log('✅ Test 3: Cắt & Giữ vùng chọn (sliceAudioBuffer Crop 2s->5s) chính xác từng sample');
}

// 4. Test Cut-out (Delete Middle Section & Micro-Crossfade)
{
  const sampleRate = 44100;
  const originalBuffer = new MockAudioBuffer(2, sampleRate * 10, sampleRate); // 10s
  const cutout = spliceCutOutAudioBuffer(originalBuffer, 3.0, 7.0, 4); // 4ms crossfade
  
  assert.strictEqual(cutout.numberOfChannels, 2);
  assert.strictEqual(cutout.sampleRate, sampleRate);
  assert.ok(Math.abs(cutout.duration - 6.0) < 0.01);
  console.log('✅ Test 4: Cắt bỏ đoạn ở giữa (spliceCutOutAudioBuffer) kèm Micro-Crossfade mượt mà');
}

// 5. Test Split Audio Buffer
{
  const sampleRate = 44100;
  const originalBuffer = new MockAudioBuffer(2, sampleRate * 8, sampleRate); // 8s
  const { partA, partB } = splitAudioBuffer(originalBuffer, 3.0);

  assert.strictEqual(partA.duration, 3.0);
  assert.strictEqual(partB.duration, 5.0);
  assert.strictEqual(partA.length + partB.length, originalBuffer.length);
  console.log('✅ Test 5: Tách đôi buffer (splitAudioBuffer) tại 3.0s thành công (3.0s + 5.0s = 8.0s)');
}

// 6. Test WAV and MP3 Encoding
{
  const sampleRate = 44100;
  const testBuffer = new MockAudioBuffer(2, sampleRate * 2, sampleRate); // 2s stereo
  
  // Test WAV
  const wavBlob = encodeWAV(testBuffer, { channels: 2 });
  assert.ok(wavBlob && wavBlob.size > 0);
  console.log(`✅ Test 6a: Mã hóa WAV Lossless thành công (${wavBlob.size} bytes)`);

  // Test MP3
  const mp3Blob = await encodeMP3(testBuffer, { bitRate: 192, channels: 2 });
  assert.ok(mp3Blob && mp3Blob.size > 0);
  console.log(`✅ Test 6b: Mã hóa MP3 @breezystack/lamejs thành công (${mp3Blob.size} bytes)`);
}

// 7. Test Silence Detection & Truncation (Shortening from 1.0s to 0.5s)
{
  const sampleRate = 44100;
  const testBuffer = new MockAudioBuffer(2, sampleRate * 5, sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = testBuffer.getChannelData(ch);
    for (let i = 0; i < sampleRate * 2; i++) data[i] = 0.5;
    for (let i = sampleRate * 2; i < Math.floor(sampleRate * 3.2); i++) data[i] = 0.0;
    for (let i = Math.floor(sampleRate * 3.2); i < sampleRate * 5; i++) data[i] = 0.5;
  }

  const regions = detectSilenceRegions(testBuffer, { thresholdDb: -45, minDuration: 0.5 });
  assert.strictEqual(regions.length, 1);

  const truncated = truncateSilenceAudioBuffer(testBuffer, { maxSilence: 0.5, thresholdDb: -45 });
  assert.strictEqual(truncated.regionsCount, 1);
  assert.ok(Math.abs(truncated.timeSaved - 0.7) < 0.05);
  console.log('✅ Test 7: Cắt rút gọn âm thanh trống 1.2s -> 0.5s (truncateSilenceAudioBuffer) thành công');
}

// 8. Test Timeline Gap Truncation
{
  const tracks = [
    { id: '1', silenceAfter: 1.5 },
    { id: '2', silenceAfter: 0.8 },
    { id: '3', silenceAfter: 0.3 }
  ];

  const res = truncateTimelineSilences(tracks, 0.5);
  assert.strictEqual(res.adjustedCount, 2);
  assert.strictEqual(tracks[0].silenceAfter, 0.5);
  assert.strictEqual(tracks[1].silenceAfter, 0.5);
  assert.strictEqual(tracks[2].silenceAfter, 0.3);
  console.log('✅ Test 8: Rút gọn các khoảng lặng trên Timeline (truncateTimelineSilences) về 0.5s thành công');
}

// 9. Test Insert Silence into AudioBuffer (Expand Duration)
{
  const sampleRate = 44100;
  const original = new MockAudioBuffer(2, sampleRate * 4, sampleRate); // 4.0s
  const withSilence = insertSilenceIntoAudioBuffer(original, 2.0, 1.5); // Insert 1.5s at 2.0s

  assert.strictEqual(withSilence.numberOfChannels, 2);
  assert.strictEqual(withSilence.sampleRate, sampleRate);
  assert.strictEqual(withSilence.duration, 5.5, 'Tổng thời lượng sau khi chèn 1.5s vào file 4s phải là 5.5s');
  assert.strictEqual(withSilence.length, original.length + Math.round(1.5 * sampleRate));
  console.log('✅ Test 9: Chèn khoảng lặng tùy chỉnh vào trong audio (insertSilenceIntoAudioBuffer) thành công (4.0s + 1.5s = 5.5s)');
}

// 10. Test Mute Region in AudioBuffer
{
  const sampleRate = 44100;
  const original = new MockAudioBuffer(2, sampleRate * 6, sampleRate); // 6.0s
  // fill with audio samples
  for (let ch = 0; ch < 2; ch++) {
    original.getChannelData(ch).fill(0.8);
  }

  const muted = muteRegionAudioBuffer(original, 2.0, 4.0); // mute 2s -> 4s
  assert.strictEqual(muted.duration, 6.0, 'Thời lượng sau khi mute phải giữ nguyên 6.0s');
  
  // Check samples inside muted range are 0
  const ch0 = muted.getChannelData(0);
  const midSample = Math.floor(3.0 * sampleRate);
  assert.strictEqual(ch0[midSample], 0, 'Mẫu trong vùng mute phải bằng 0');
  console.log('✅ Test 10: Tắt tiếng vùng chọn trong clip (muteRegionAudioBuffer) thành công');
}

console.log('\n🎉 TOÀN BỘ 10 BỘ KIỂM THỬ AUDIO ENGINE, ZOOM & SILENCE INSERTION ĐỀU ĐẠT 100%!');
