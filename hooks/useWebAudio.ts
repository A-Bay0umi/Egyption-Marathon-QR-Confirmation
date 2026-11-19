'use client';

import { useCallback, useEffect, useRef } from 'react';

type ToneKind = 'success' | 'duplicate' | 'notFound';

interface ToneSegment {
  freq: number;
  startSec: number;
  durationSec: number;
  wave: 'sine' | 'sawtooth' | 'triangle';
  gain: number;
}

// Track A (HTML5 <audio> Media Channel): warm root confirmation tone starting immediately at t=0
const MEDIA_LAYER_SEGMENTS: Record<ToneKind, ToneSegment[]> = {
  success: [
    { freq: 523.25, startSec: 0, durationSec: 0.09, wave: 'sine', gain: 0.72 },
    { freq: 659.25, startSec: 0.095, durationSec: 0.14, wave: 'sine', gain: 0.78 },
  ],
  duplicate: [
    { freq: 220, startSec: 0, durationSec: 0.12, wave: 'sawtooth', gain: 0.62 },
    { freq: 185, startSec: 0.13, durationSec: 0.18, wave: 'sawtooth', gain: 0.66 },
  ],
  notFound: [
    { freq: 246.94, startSec: 0, durationSec: 0.1, wave: 'triangle', gain: 0.68 },
    { freq: 196, startSec: 0.11, durationSec: 0.16, wave: 'triangle', gain: 0.72 },
  ],
};

// Track B (Web Audio API High Chime Layer + Compressor): plays at the EXACT same instant (t=0),
// harmonized cleanly in upper octaves/fifths so both sounds fire together with zero mud.
const WEB_AUDIO_LAYER_SEGMENTS: Record<ToneKind, ToneSegment[]> = {
  success: [
    { freq: 1046.5, startSec: 0, durationSec: 0.09, wave: 'sine', gain: 0.75 },
    { freq: 1567.98, startSec: 0.095, durationSec: 0.16, wave: 'sine', gain: 0.85 },
  ],
  duplicate: [
    { freq: 440, startSec: 0, durationSec: 0.12, wave: 'triangle', gain: 0.78 },
    { freq: 370, startSec: 0.13, durationSec: 0.19, wave: 'triangle', gain: 0.82 },
  ],
  notFound: [
    { freq: 493.88, startSec: 0, durationSec: 0.1, wave: 'sine', gain: 0.72 },
    { freq: 392, startSec: 0.11, durationSec: 0.17, wave: 'sine', gain: 0.78 },
  ],
};

function buildWavBlobUrl(segments: ToneSegment[], silent = false): string {
  const sampleRate = 22050;
  const totalSec = silent
    ? 0.02
    : Math.max(...segments.map((s) => s.startSec + s.durationSec)) + 0.025;
  const numSamples = Math.ceil(totalSec * sampleRate);
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  const writeStr = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  if (!silent) {
    for (let i = 0; i < numSamples; i += 1) {
      const t = i / sampleRate;
      let sample = 0;
      for (const seg of segments) {
        if (t >= seg.startSec && t <= seg.startSec + seg.durationSec) {
          const localT = t - seg.startSec;
          const attack = Math.min(1, localT / 0.008);
          const release = Math.min(1, (seg.durationSec - localT) / 0.018);
          const env = attack * release;
          const phase = (localT * seg.freq) % 1;
          let osc = 0;
          if (seg.wave === 'sine') {
            osc = Math.sin(2 * Math.PI * seg.freq * localT);
          } else if (seg.wave === 'sawtooth') {
            osc = 2 * phase - 1;
          } else {
            osc = 1 - 4 * Math.abs(Math.round(phase - 0.25) - (phase - 0.25));
          }
          sample += osc * seg.gain * env;
        }
      }
      const clamped = Math.max(-0.98, Math.min(0.98, sample));
      view.setInt16(44 + i * 2, clamped * 32767, true);
    }
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

function triggerHaptic(pattern: number | number[]) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignore vibration errors on unsupported devices
  }
}

export function useWebAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const wavUrlsRef = useRef<Partial<Record<ToneKind | 'silent', string>>>({});
  const mediaAudioRef = useRef<HTMLAudioElement | null>(null);
  const mediaUnlockedRef = useRef(false);
  const activeOscsRef = useRef<OscillatorNode[]>([]);

  useEffect(() => {
    const urls = wavUrlsRef.current;
    return () => {
      try {
        mediaAudioRef.current?.pause();
      } catch {
        // Ignore cleanup errors
      }
      Object.values(urls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  const getContextAndMaster = useCallback((): {
    ctx: AudioContext;
    destination: AudioNode;
  } | null => {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!ctxRef.current) {
      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      if (typeof ctx.createDynamicsCompressor === 'function') {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.setValueAtTime(-16, ctx.currentTime);
        comp.knee.setValueAtTime(12, ctx.currentTime);
        comp.ratio.setValueAtTime(8, ctx.currentTime);
        comp.attack.setValueAtTime(0.003, ctx.currentTime);
        comp.release.setValueAtTime(0.15, ctx.currentTime);
        comp.connect(ctx.destination);
        compressorRef.current = comp;
      }
    }

    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume();
    }

    return {
      ctx: ctxRef.current,
      destination: compressorRef.current ?? ctxRef.current.destination,
    };
  }, []);

  const ensureWavUrl = useCallback((kind: ToneKind | 'silent'): string | null => {
    if (typeof window === 'undefined') return null;
    if (!wavUrlsRef.current[kind]) {
      wavUrlsRef.current[kind] =
        kind === 'silent'
          ? buildWavBlobUrl([], true)
          : buildWavBlobUrl(MEDIA_LAYER_SEGMENTS[kind]);
    }
    return wavUrlsRef.current[kind] ?? null;
  }, []);

  const ensureMediaElement = useCallback((): HTMLAudioElement | null => {
    if (typeof window === 'undefined') return null;
    if (!mediaAudioRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.volume = 1.0;
      mediaAudioRef.current = audio;
    }
    return mediaAudioRef.current;
  }, []);

  const unlockAudio = useCallback(() => {
    try {
      const nodes = getContextAndMaster();
      if (nodes && nodes.ctx.state === 'suspended') {
        const buf = nodes.ctx.createBuffer(1, 1, 22050);
        const src = nodes.ctx.createBufferSource();
        src.buffer = buf;
        src.connect(nodes.destination);
        src.start(0);
      }

      ensureWavUrl('success');
      ensureWavUrl('duplicate');
      ensureWavUrl('notFound');

      const audio = ensureMediaElement();
      const silentUrl = ensureWavUrl('silent');
      if (audio && silentUrl && !mediaUnlockedRef.current) {
        audio.src = silentUrl;
        audio.volume = 1.0;
        const p = audio.play();
        if (p && typeof p.then === 'function') {
          void p
            .then(() => {
              mediaUnlockedRef.current = true;
            })
            .catch(() => {
              // Will retry on next user gesture
            });
        }
      }
    } catch {
      // Ignore audio unlock errors
    }
  }, [ensureMediaElement, ensureWavUrl, getContextAndMaster]);

  const vibrateLight = useCallback(() => {
    triggerHaptic(30);
  }, []);

  // Triggers both harmonized audio pipelines AT THE EXACT SAME INSTANT (t=0) plus vibration.
  // No OS notification banners are triggered.
  const triggerSimultaneousDualAudio = useCallback(
    (kind: ToneKind, vibratePattern: number | number[]) => {
      triggerHaptic(vibratePattern);

      // Stop any in-flight prior playback cleanly
      try {
        if (mediaAudioRef.current) {
          mediaAudioRef.current.pause();
          mediaAudioRef.current.currentTime = 0;
        }
        activeOscsRef.current.forEach((osc) => {
          try {
            osc.stop();
          } catch {
            // Already stopped
          }
        });
        activeOscsRef.current = [];
      } catch {
        // Ignore cleanup errors
      }

      // Track A (t=0): Persistent gesture-unlocked HTML5 <audio> Media Channel
      try {
        const url = ensureWavUrl(kind);
        const audio = ensureMediaElement();
        if (url && audio) {
          audio.src = url;
          audio.volume = 1.0;
          audio.currentTime = 0;
          void audio.play().catch(() => {
            // Autoplay blocked before first gesture
          });
        }
      } catch {
        // Ignore HTMLAudioElement errors
      }

      // Track B (t=0): Web Audio API High Bell Layer + DynamicsCompressor
      try {
        const audioNodes = getContextAndMaster();
        if (audioNodes) {
          const { ctx, destination } = audioNodes;
          const now = ctx.currentTime;
          const startedOscs: OscillatorNode[] = [];
          for (const seg of WEB_AUDIO_LAYER_SEGMENTS[kind]) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = seg.wave;
            osc.frequency.setValueAtTime(seg.freq, now + seg.startSec);
            gain.gain.setValueAtTime(0.001, now + seg.startSec);
            gain.gain.exponentialRampToValueAtTime(seg.gain, now + seg.startSec + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.001, now + seg.startSec + seg.durationSec);
            osc.connect(gain);
            gain.connect(destination);
            osc.start(now + seg.startSec);
            osc.stop(now + seg.startSec + seg.durationSec + 0.02);
            startedOscs.push(osc);
          }
          activeOscsRef.current = startedOscs;
        }
      } catch {
        // Ignore Web Audio errors
      }
    },
    [ensureMediaElement, ensureWavUrl, getContextAndMaster]
  );

  const playSuccessSound = useCallback(() => {
    triggerSimultaneousDualAudio('success', [35, 30, 45]);
  }, [triggerSimultaneousDualAudio]);

  const playDuplicateAlertSound = useCallback(() => {
    triggerSimultaneousDualAudio('duplicate', [60, 40, 60]);
  }, [triggerSimultaneousDualAudio]);

  const playNotFoundSound = useCallback(() => {
    triggerSimultaneousDualAudio('notFound', [45, 35, 45]);
  }, [triggerSimultaneousDualAudio]);

  return {
    unlockAudio,
    vibrateLight,
    playSuccessSound,
    playDuplicateAlertSound,
    playNotFoundSound,
  };
}
