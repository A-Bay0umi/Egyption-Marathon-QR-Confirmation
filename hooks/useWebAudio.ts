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

// 1) Normal Media Beep (HTML5 <audio> PCM WAV): plays ONLY in [0.00s -> 0.085s]
const NORMAL_BEEP_SEGMENTS: Record<ToneKind, ToneSegment[]> = {
  success: [{ freq: 880, startSec: 0, durationSec: 0.085, wave: 'sine', gain: 0.85 }],
  duplicate: [{ freq: 320, startSec: 0, durationSec: 0.11, wave: 'sawtooth', gain: 0.78 }],
  notFound: [{ freq: 260, startSec: 0, durationSec: 0.095, wave: 'triangle', gain: 0.82 }],
};

// 2) Notification-Style Bell Chime (Web Audio API): starts AFTER a clean gap (>= 0.135s), ZERO overlap!
const NOTIFICATION_CHIME_SEGMENTS: Record<ToneKind, ToneSegment[]> = {
  success: [
    { freq: 1568, startSec: 0.135, durationSec: 0.085, wave: 'sine', gain: 0.82 },
    { freq: 2093, startSec: 0.225, durationSec: 0.14, wave: 'sine', gain: 0.88 },
  ],
  duplicate: [
    { freq: 440, startSec: 0.155, durationSec: 0.12, wave: 'triangle', gain: 0.84 },
    { freq: 294, startSec: 0.285, durationSec: 0.18, wave: 'triangle', gain: 0.86 },
  ],
  notFound: [
    { freq: 392, startSec: 0.145, durationSec: 0.1, wave: 'sine', gain: 0.8 },
    { freq: 247, startSec: 0.255, durationSec: 0.15, wave: 'sine', gain: 0.84 },
  ],
};

function buildWavBlobUrl(segments: ToneSegment[]): string {
  const sampleRate = 22050;
  const totalSec = Math.max(...segments.map((s) => s.startSec + s.durationSec)) + 0.025;
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
  const activeHtmlAudioRef = useRef<HTMLAudioElement | null>(null);
  const activeOscsRef = useRef<OscillatorNode[]>([]);

  useEffect(() => {
    const urls = wavUrlsRef.current;
    return () => {
      try {
        activeHtmlAudioRef.current?.pause();
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

  const ensureWavUrl = useCallback((kind: ToneKind): string | null => {
    if (typeof window === 'undefined') return null;
    if (!wavUrlsRef.current[kind]) {
      wavUrlsRef.current[kind] = buildWavBlobUrl(NORMAL_BEEP_SEGMENTS[kind]);
    }
    return wavUrlsRef.current[kind] ?? null;
  }, []);

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

  const vibrateLight = useCallback(() => {
    triggerHaptic(30);
  }, []);

  // Sequenced non-overlapping sound:
  // Step A (0ms): Normal Media scanner beep (HTMLAudioElement)
  // Step B (135ms+): Distinct notification-style bell chime (Web Audio + Compressor)
  // No OS notification banner is ever created.
  const triggerSeparatedAudio = useCallback(
    (kind: ToneKind, vibratePattern: number | number[]) => {
      triggerHaptic(vibratePattern);

      // Stop any in-flight prior sound cleanly so rapid scans never overlap
      try {
        if (activeHtmlAudioRef.current) {
          activeHtmlAudioRef.current.pause();
          activeHtmlAudioRef.current.currentTime = 0;
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

      // 1. Normal Media Scanner Beep (plays immediately at t=0)
      try {
        const url = ensureWavUrl(kind);
        if (url) {
          const audio = new Audio(url);
          audio.volume = 1.0;
          activeHtmlAudioRef.current = audio;
          void audio.play().catch(() => {
            // Autoplay blocked before first gesture
          });
        }
      } catch {
        // Ignore HTMLAudioElement errors
      }

      // 2. Notification-Style Chime (starts after clean gap at t>=135ms — zero overlap!)
      try {
        const audioNodes = getContextAndMaster();
        if (audioNodes) {
          const { ctx, destination } = audioNodes;
          const now = ctx.currentTime;
          const startedOscs: OscillatorNode[] = [];
          for (const seg of NOTIFICATION_CHIME_SEGMENTS[kind]) {
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
    [ensureWavUrl, getContextAndMaster]
  );

  const playSuccessSound = useCallback(() => {
    triggerSeparatedAudio('success', [35, 30, 45]);
  }, [triggerSeparatedAudio]);

  const playDuplicateAlertSound = useCallback(() => {
    triggerSeparatedAudio('duplicate', [60, 40, 60]);
  }, [triggerSeparatedAudio]);

  const playNotFoundSound = useCallback(() => {
    triggerSeparatedAudio('notFound', [45, 35, 45]);
  }, [triggerSeparatedAudio]);

  return {
    unlockAudio,
    vibrateLight,
    playSuccessSound,
    playDuplicateAlertSound,
    playNotFoundSound,
  };
}
