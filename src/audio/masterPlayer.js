import { getAudioContext } from './audioContext.js';
import { calculateTimeline } from './concatenator.js';
import { analyzeAudioLoudness } from './decoder.js';

export class MasterPlayer {
  constructor() {
    this.ctx = null;
    this.tracks = [];
    this.globalOptions = {};
    this.isPlaying = false;
    this.currentTime = 0;
    this.totalDuration = 0;
    this.playbackRate = 1.0;
    this.volume = 1.0;
    this.loop = false;
    this.activeSourceNodes = [];
    this.masterGainNode = null;
    this.playStartTime = 0;
    this.pausedAt = 0;
    this.animationFrameId = null;
    this.listeners = {
      timeupdate: [],
      statechange: [],
      ended: []
    };
  }

  on(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event].push(callback);
    }
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }

  setTracks(tracks, globalOptions = {}) {
    this.tracks = tracks;
    this.globalOptions = globalOptions;
    const { totalDuration } = calculateTimeline(tracks, globalOptions);
    this.totalDuration = totalDuration;

    if (this.currentTime > this.totalDuration) {
      this.currentTime = 0;
      this.pausedAt = 0;
    }
    this.emit('timeupdate', { currentTime: this.currentTime, totalDuration: this.totalDuration });
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(2, vol));
    if (this.masterGainNode && this.ctx) {
      this.masterGainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    }
  }

  setPlaybackRate(rate) {
    this.playbackRate = rate;
    // Update currently playing source nodes
    this.activeSourceNodes.forEach(({ source }) => {
      try {
        source.playbackRate.setValueAtTime(rate, this.ctx.currentTime);
      } catch (e) {
        // ignore
      }
    });
  }

  setLoop(isLoop) {
    this.loop = isLoop;
  }

  async play() {
    if (this.isPlaying) return;
    this.ctx = getAudioContext();
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    const activeTracks = this.tracks.filter(t => !t.muted);
    if (activeTracks.length === 0 || this.totalDuration <= 0) return;

    const { timelineItems } = calculateTimeline(activeTracks, this.globalOptions);
    this.stopActiveNodes();

    this.masterGainNode = this.ctx.createGain();
    this.masterGainNode.gain.setValueAtTime(this.volume, this.ctx.currentTime);
    this.masterGainNode.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    const offset = this.pausedAt;
    this.playStartTime = now - (offset / this.playbackRate);

    // Schedule each track on the timeline
    timelineItems.forEach((item, index) => {
      const track = item.track;
      // Check if this item is in the future relative to current offset
      if (item.endTime > offset) {
        const source = this.ctx.createBufferSource();
        source.buffer = track.audioBuffer;
        source.playbackRate.setValueAtTime(this.playbackRate, this.ctx.currentTime);

        const gainNode = this.ctx.createGain();
        let trackGain = track.volume !== undefined ? track.volume : 1.0;

        if (this.globalOptions.normalizeAll) {
          const loudness = analyzeAudioLoudness(track.audioBuffer);
          trackGain *= loudness.recommendedGain;
        }

        gainNode.gain.setValueAtTime(trackGain, this.ctx.currentTime);

        // Calculate schedule start time and buffer offset
        let scheduleTime = 0;
        let bufferOffset = item.trimStart;
        let playDuration = item.effectiveDuration;

        if (item.startTime >= offset) {
          scheduleTime = now + ((item.startTime - offset) / this.playbackRate);
        } else {
          // Track is already partially passed
          const skipped = offset - item.startTime;
          bufferOffset += skipped;
          playDuration -= skipped;
          scheduleTime = now;
        }

        source.connect(gainNode);
        gainNode.connect(this.masterGainNode);

        if (playDuration > 0) {
          try {
            source.start(scheduleTime, bufferOffset, playDuration);
            this.activeSourceNodes.push({ source, gainNode });
          } catch (err) {
            console.warn('Playback scheduling warning:', err);
          }
        }
      }
    });

    this.isPlaying = true;
    this.emit('statechange', { isPlaying: true });
    this.startTimeLoop();
  }

  pause() {
    if (!this.isPlaying) return;
    this.stopActiveNodes();
    this.cancelTimeLoop();
    this.pausedAt = this.currentTime;
    this.isPlaying = false;
    this.emit('statechange', { isPlaying: false });
  }

  seek(targetTime) {
    const wasPlaying = this.isPlaying;
    if (wasPlaying) {
      this.pause();
    }
    this.currentTime = Math.max(0, Math.min(targetTime, this.totalDuration));
    this.pausedAt = this.currentTime;
    this.emit('timeupdate', { currentTime: this.currentTime, totalDuration: this.totalDuration });
    if (wasPlaying) {
      this.play();
    }
  }

  stop() {
    this.stopActiveNodes();
    this.cancelTimeLoop();
    this.currentTime = 0;
    this.pausedAt = 0;
    this.isPlaying = false;
    this.emit('statechange', { isPlaying: false });
    this.emit('timeupdate', { currentTime: 0, totalDuration: this.totalDuration });
  }

  stopActiveNodes() {
    this.activeSourceNodes.forEach(({ source }) => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // ignore already stopped
      }
    });
    this.activeSourceNodes = [];
  }

  startTimeLoop() {
    this.cancelTimeLoop();
    const update = () => {
      if (!this.isPlaying || !this.ctx) return;
      const elapsed = (this.ctx.currentTime - this.playStartTime) * this.playbackRate;
      this.currentTime = elapsed;

      if (this.currentTime >= this.totalDuration) {
        if (this.loop) {
          this.seek(0);
          this.play();
        } else {
          this.stop();
          this.emit('ended');
          return;
        }
      } else {
        this.emit('timeupdate', { currentTime: this.currentTime, totalDuration: this.totalDuration });
      }

      this.animationFrameId = requestAnimationFrame(update);
    };
    this.animationFrameId = requestAnimationFrame(update);
  }

  cancelTimeLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
