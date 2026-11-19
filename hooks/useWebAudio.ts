'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

type ToneKind = 'success' | 'duplicate' | 'notFound';

interface ToneSegment {
  freq: number;
  startSec: number;
  durationSec: number;
  wave: 'sine' | 'sawtooth' | 'triangle';
  gain: number;
}

const TONE_PATTERNS: Record<ToneKind, ToneSegment[]> = {
  success: [
    { freq: 880, startSec: 0, durationSec: 0.1, wave: 'sine', gain: 0.45 },
    { freq: 1175, startSec: 0.12, durationSec: 0.16, wave: 'sine', gain: 0.5 },
  ],
  duplicate: [
    { freq: 340, startSec: 0, durationSec: 0.22, wave: 'sawtooth', gain: 0.42 },
    { freq: 220, startSec: 0.25, durationSec: 0.28, wave: 'sawtooth', gain: 0.45 },
  ],
  notFound: [
    { freq: 300, startSec: 0, durationSec: 0.13, wave: 'triangle', gain: 0.42 },
    { freq: 190, startSec: 0.15, durationSec: 0.18, wave: 'triangle', gain: 0.42 },
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
        const attack = Math.min(1, localT / 0.012);
        const release = Math.min(1, (seg.durationSec - localT) / 0.025);
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
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clamped * 32767, true);
  }

  const blob = new Blob([buffer], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}

export function useWebAudio() {
  const ctxRef = useRef<AudioContext | null>(null);
  const wavUrlsRef = useRef<Partial<Record<ToneKind, string>>>({});
  const activeNotifRef = useRef<Notification | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<
    NotificationPermission | 'unsupported'
  >('unsupported');

  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      queueMicrotask(() => {
        setNotificationPermission(window.Notification.permission);
      });
    }

    const urls = wavUrlsRef.current;
    return () => {
      Object.values(urls).forEach((url) => {
        if (url) URL.revokeObjectURL(url);
      });
    };
  }, []);

  const getContext = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    if (!ctxRef.current) {
      ctxRef.current = new AudioCtx();
    }
    if (ctxRef.current.state === 'suspended') {
      void ctxRef.current.resume();
    }
    return ctxRef.current;
  }, []);

  const ensureWavUrl = useCallback((kind: ToneKind): string | null => {
    if (typeof window === 'undefined') return null;
    if (!wavUrlsRef.current[kind]) {
      wavUrlsRef.current[kind] = buildWavBlobUrl(TONE_PATTERNS[kind]);
    }
    return wavUrlsRef.current[kind] ?? null;
  }, []);

  // Unlock AudioContext + HTMLMediaElement inside user gesture; optionally ask OS notification permission
  const unlockAudio = useCallback(
    async (requestNotifPermission = false) => {
      try {
        getContext();
        // Prime WAV blob URLs early
        ensureWavUrl('success');
        ensureWavUrl('duplicate');
        ensureWavUrl('notFound');
      } catch {
        // Ignore audio unlock errors
      }

      if (
        requestNotifPermission &&
        typeof window !== 'undefined' &&
        'Notification' in window &&
        window.Notification.permission === 'default'
      ) {
        try {
          const perm = await window.Notification.requestPermission();
          setNotificationPermission(perm);
        } catch {
          // Ignore permission request failure
        }
      }
    },
    [ensureWavUrl, getContext]
  );

  // Play BOTH Media-channel (<audio> WAV + Web Audio) AND OS Notification channel simultaneously
  const triggerDualAlert = useCallback(
    (
      kind: ToneKind,
      vibratePattern: number | number[],
      notifTitle: string,
      notifBody?: string
    ) => {
      // 1. Tactile vibration (for silent/vibrate mode)
      try {
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(vibratePattern);
        }
      } catch {
        // Ignore
      }

      // 2. HTML5 <audio> playback (Media channel — plays through speaker even when iOS Silent Switch is ON)
      try {
        const url = ensureWavUrl(kind);
        if (url) {
          const audio = new Audio(url);
          audio.volume = 1.0;
          void audio.play().catch(() => {
            // Autoplay blocked before gesture; Web Audio fallback handles below if unlocked
          });
        }
      } catch {
        // Ignore
      }

      // 3. Web Audio synthesis (immediate low-latency tone)
      try {
        const ctx = getContext();
        if (ctx) {
          const now = ctx.currentTime;
          for (const seg of TONE_PATTERNS[kind]) {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = seg.wave;
            osc.frequency.setValueAtTime(seg.freq, now + seg.startSec);
            gain.gain.setValueAtTime(0.001, now + seg.startSec);
            gain.gain.exponentialRampToValueAtTime(seg.gain, now + seg.startSec + 0.015);
            gain.gain.exponentialRampToValueAtTime(0.001, now + seg.startSec + seg.durationSec);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + seg.startSec);
            osc.stop(now + seg.startSec + seg.durationSec + 0.02);
          }
        }
      } catch {
        // Ignore Web Audio errors
      }

      // 4. Native OS Notification channel (plays system notification sound when permitted)
      try {
        if (
          typeof window !== 'undefined' &&
          'Notification' in window &&
          window.Notification.permission === 'granted'
        ) {
          const notifOptions: NotificationOptions & { renotify?: boolean; vibrate?: number[] } = {
            body: notifBody,
            icon: '/logo.png',
            badge: '/logo.png',
            tag: 'em-qr-scan-alert',
            renotify: true,
            silent: false,
            vibrate: Array.isArray(vibratePattern) ? vibratePattern : [vibratePattern],
          };

          if ('serviceWorker' in navigator) {
            void navigator.serviceWorker.getRegistration().then((reg) => {
              if (reg && typeof reg.showNotification === 'function') {
                void reg.showNotification(notifTitle, notifOptions);
              } else {
                activeNotifRef.current?.close();
                activeNotifRef.current = new window.Notification(notifTitle, notifOptions);
              }
            });
          } else {
            activeNotifRef.current?.close();
            activeNotifRef.current = new window.Notification(notifTitle, notifOptions);
          }
        }
      } catch {
        // Ignore Notification API errors
      }
    },
    [ensureWavUrl, getContext]
  );

  const playSuccessSound = useCallback(
    (detail?: string) => {
      triggerDualAlert(
        'success',
        [90, 40, 120],
        'EM QR — تم المسح بنجاح',
        detail || 'المتسابق جاهز للتسليم'
      );
    },
    [triggerDualAlert]
  );

  const playDuplicateAlertSound = useCallback(
    (detail?: string) => {
      triggerDualAlert(
        'duplicate',
        [280, 90, 280, 90, 280],
        'EM QR — تنبيه تسليم ⚠️',
        detail || 'تم التسليم مسبقاً أو بانتظار خطوة سابقة'
      );
    },
    [triggerDualAlert]
  );

  const playNotFoundSound = useCallback(
    (detail?: string) => {
      triggerDualAlert(
        'notFound',
        [150, 60, 150],
        'EM QR — غير موجود',
        detail || 'لم يتم العثور على المتسابق'
      );
    },
    [triggerDualAlert]
  );

  return {
    notificationPermission,
    unlockAudio,
    playSuccessSound,
    playDuplicateAlertSound,
    playNotFoundSound,
  };
}
