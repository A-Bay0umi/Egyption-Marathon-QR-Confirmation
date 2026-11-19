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

// High-clarity, normalized tone patterns designed to remain clear even at low media volume
const TONE_PATTERNS: Record<ToneKind, ToneSegment[]> = {
  success: [
    { freq: 880, startSec: 0, durationSec: 0.1, wave: 'sine', gain: 0.85 },
    { freq: 1175, startSec: 0.11, durationSec: 0.17, wave: 'sine', gain: 0.9 },
  ],
  duplicate: [
    { freq: 340, startSec: 0, durationSec: 0.2, wave: 'sawtooth', gain: 0.78 },
    { freq: 220, startSec: 0.22, durationSec: 0.26, wave: 'sawtooth', gain: 0.82 },
  ],
  notFound: [
    { freq: 300, startSec: 0, durationSec: 0.12, wave: 'triangle', gain: 0.82 },
    { freq: 190, startSec: 0.14, durationSec: 0.18, wave: 'triangle', gain: 0.85 },
  ],
};

function buildWavBlobUrl(segments: ToneSegment[]): string {
  const sampleRate = 22050;
  const totalSec = Math.max(...segments.map((s) => s.startSec + s.durationSec)) + 0.04;
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

  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    let sample = 0;
    for (const seg of segments) {
      if (t >= seg.startSec && t <= seg.startSec + seg.durationSec) {
        const localT = t - seg.startSec;
        const attack = Math.min(1, localT / 0.01);
        const release = Math.min(1, (seg.durationSec - localT) / 0.02);
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
  const wavUrlsRef = useRef<Partial<Record<ToneKind, string>>>({});

  useEffect(() => {
    const urls = wavUrlsRef.current;
    return () => {
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

  const ensureWavUrl = useCallback((kind: ToneKind): string | null => {
    if (typeof window === 'undefined') return null;
    if (!wavUrlsRef.current[kind]) {
      wavUrlsRef.current[kind] = buildWavBlobUrl(TONE_PATTERNS[kind]);
    }
    return wavUrlsRef.current[kind] ?? null;
  }, []);

  // Unlock AudioContext & HTML5 Media audio inside user gesture (no OS notifications requested)
  const unlockAudio = useCallback(() => {
    try {
      getContextAndMaster();
      ensureWavUrl('success');
      ensureWavUrl('duplicate');
      ensureWavUrl('notFound');
    } catch {
      // Ignore audio unlock errors
    }
  }, [ensureWavUrl, getContextAndMaster]);

  // Light haptic pulse when capturing a barcode/photo
  const vibrateLight = useCallback(() => {
    triggerHaptic(30);
  }, []);

  // Play crisp media sound (bypasses hardware silent/ringer switch when media volume > 0) + light haptic
  const triggerSoundAndHaptic = useCallback(
    (kind: ToneKind, vibratePattern: number | number[]) => {
      // 1. Light crisp haptic feedback
      triggerHaptic(vibratePattern);

      // 2. HTML5 <audio> Media channel (plays even if phone ringer switch is on Silent)
      try {
        const url = ensureWavUrl(kind);
        if (url) {
          const audio = new Audio(url);
          audio.volume = 1.0;
          void audio.play().catch(() => {
            // Autoplay blocked before gesture; Web Audio handles below once unlocked
          });
        }
      } catch {
        // Ignore HTML5 Audio errors
      }

      // 3. Web Audio synthesis through DynamicsCompressor for boosted clarity even at low phone volume
      try {
        const audioNodes = getContextAndMaster();
        if (audioNodes) {
          const { ctx, destination } = audioNodes;
          const now = ctx.currentTime;
          for (const seg of TONE_PATTERNS[kind]) {
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
          }
        }
      } catch {
        // Ignore Web Audio errors
      }
    },
    [ensureWavUrl, getContextAndMaster]
  );

  const playSuccessSound = useCallback(() => {
    triggerSoundAndHaptic('success', [35, 30, 45]);
  }, [triggerSoundAndHaptic]);

  const playDuplicateAlertSound = useCallback(() => {
    triggerSoundAndHaptic('duplicate', [60, 40, 60]);
  }, [triggerSoundAndHaptic]);

  const playNotFoundSound = useCallback(() => {
    triggerSoundAndHaptic('notFound', [45, 35, 45]);
  }, [triggerSoundAndHaptic]);

  return {
    unlockAudio,
    vibrateLight,
    playSuccessSound,
    playDuplicateAlertSound,
    playNotFoundSound,
  };
}
