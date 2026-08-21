import { getAudioContext } from './audioContext.js';
import { extractWaveformData } from './decoder.js';

/**
 * Synthesizes a realistic audio buffer for testing and demo purposes.
 * @param {string} type - 'bell' | 'marimba' | 'synth_lead' | 'lofi_chord' | 'sweep'
 * @param {number} duration - seconds
 * @returns {Promise<AudioBuffer>}
 */
export async function generateDemoAudioBuffer(type = 'bell', duration = 3.0) {
  const sampleRate = 44100;
  const numFrames = Math.round(sampleRate * duration);
  const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OfflineCtx(2, numFrames, sampleRate);

  if (type === 'bell') {
    // Crystal bell chime (chord C5, E5, G5, B5)
    const freqs = [523.25, 659.25, 783.99, 987.77];
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;

      const startTime = idx * 0.15;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.3 / (idx + 1), startTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.8);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 1.9);
    });
  } else if (type === 'marimba') {
    // Upbeat Marimba Arpeggio (F4, A4, C5, E5, F5)
    const notes = [349.23, 440.00, 523.25, 659.25, 698.46, 523.25];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;

      const startTime = idx * 0.22;
      gain.gain.setValueAtTime(0, startTime);
      gain.gain.linearRampToValueAtTime(0.4, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.5);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + 0.6);
    });
  } else if (type === 'lofi_chord') {
    // Warm Lo-Fi electric piano chord (Dm9: D3, F3, A3, C4, E4)
    const freqs = [146.83, 174.61, 220.00, 261.63, 329.63];
    freqs.forEach((freq) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      osc.type = 'sawtooth';
      osc.frequency.value = freq;

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(800, 0);
      filter.frequency.exponentialRampToValueAtTime(300, duration);

      gain.gain.setValueAtTime(0, 0);
      gain.gain.linearRampToValueAtTime(0.15, 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, duration);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);

      osc.start(0);
      osc.stop(duration);
    });
  } else {
    // Modern futuristic sweep
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(200, 0);
    osc.frequency.exponentialRampToValueAtTime(880, duration * 0.7);

    gain.gain.setValueAtTime(0.01, 0);
    gain.gain.linearRampToValueAtTime(0.35, duration * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(0);
    osc.stop(duration);
  }

  return await ctx.startRendering();
}

/**
 * Creates sample track objects ready to be added into timeline.
 */
export async function getSampleDemoTracks() {
  const demos = [
    { name: '01_Crystal_Intro.wav', type: 'bell', duration: 2.2, silenceAfter: 0.5 },
    { name: '02_Marimba_Melody.wav', type: 'marimba', duration: 1.8, silenceAfter: 1.0 },
    { name: '03_LoFi_Chill_Chord.wav', type: 'lofi_chord', duration: 2.5, silenceAfter: 0 }
  ];

  const tracks = [];
  for (const demo of demos) {
    const buffer = await generateDemoAudioBuffer(demo.type, demo.duration);
    const { peaks } = extractWaveformData(buffer, 120);
    tracks.push({
      id: 'demo_' + Math.random().toString(36).substring(2, 9),
      name: demo.name,
      file: null,
      audioBuffer: buffer,
      duration: buffer.duration,
      trimStart: 0,
      trimEnd: buffer.duration,
      volume: 1.0,
      muted: false,
      fadeIn: 0,
      fadeOut: 0,
      silenceAfter: demo.silenceAfter,
      waveformPeaks: peaks
    });
  }
  return tracks;
}
