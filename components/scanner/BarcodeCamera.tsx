'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, CameraOff, Flashlight, ImageUp, Keyboard, SwitchCamera } from 'lucide-react';
import type { QrcodeDecoderAsync } from 'html5-qrcode/esm/core';

interface BarcodeCameraProps {
  onScan: (decodedText: string) => void;
  disabled?: boolean;
  compactIdle?: boolean;
}

interface NativeBarcodeDetectorResult {
  rawValue?: string;
}

interface NativeBarcodeDetector {
  detect: (source: ImageBitmapSource) => Promise<NativeBarcodeDetectorResult[]>;
}

interface NativeBarcodeDetectorConstructor {
  new (options?: { formats?: string[] }): NativeBarcodeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

const DESIRED_NATIVE_FORMATS = [
  'qr_code',
  'code_128',
  'code_39',
  'code_93',
  'ean_13',
  'ean_8',
  'itf',
  'upc_a',
  'upc_e',
  'codabar',
  'data_matrix',
  'aztec',
  'pdf417',
];

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const BarcodeCamera: React.FC<BarcodeCameraProps> = ({
  onScan,
  disabled = false,
  compactIdle = false,
}) => {
  const reactId = useId();
  const safeId = reactId.replace(/[^a-zA-Z0-9_-]/g, '');
  const fileReaderElementId = `marathon-file-qr-${safeId}`;

  const [isStarting, setIsStarting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const activeDeviceIdRef = useRef<string | null>(null);
  const facingModeRef = useRef<'environment' | 'user'>('environment');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const scanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef(0);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const nativeDetectorRef = useRef<NativeBarcodeDetector | null | undefined>(undefined);
  const zxingDecoderRef = useRef<QrcodeDecoderAsync | null>(null);

  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const emitScan = useCallback((decodedText: string) => {
    const clean = decodedText.trim();
    if (!clean) return;
    const now = Date.now();
    if (lastScanRef.current.code === clean && now - lastScanRef.current.at < 1500) {
      return;
    }
    lastScanRef.current = { code: clean, at: now };
    onScanRef.current(clean);
  }, []);

  const releaseStream = useCallback(() => {
    if (scanTimerRef.current) {
      clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      streamRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      try {
        video.pause();
      } catch {
        // Ignore pause errors
      }
      video.srcObject = null;
    }
    activeDeviceIdRef.current = null;
  }, []);

  const stopCamera = useCallback(async () => {
    sessionTokenRef.current += 1;
    releaseStream();
    setIsStarting(false);
    setIsScanning(false);
    setTorchOn(false);
    setTorchSupported(false);
  }, [releaseStream]);

  const ensureDecoders = useCallback(async () => {
    // 1. Safe native BarcodeDetector setup (only intersect supported formats)
    if (nativeDetectorRef.current === undefined) {
      nativeDetectorRef.current = null;
      try {
        const win = window as unknown as { BarcodeDetector?: NativeBarcodeDetectorConstructor };
        const DetectorCtor = win.BarcodeDetector;
        if (typeof DetectorCtor === 'function') {
          let formatsToUse = ['qr_code', 'code_128', 'ean_13', 'code_39'];
          if (typeof DetectorCtor.getSupportedFormats === 'function') {
            const supported = await DetectorCtor.getSupportedFormats();
            const matched = DESIRED_NATIVE_FORMATS.filter((f) => supported.includes(f));
            if (matched.length > 0) {
              formatsToUse = matched;
            } else if (supported.length > 0) {
              formatsToUse = supported;
            }
          }
          nativeDetectorRef.current = new DetectorCtor({ formats: formatsToUse });
        }
      } catch {
        nativeDetectorRef.current = null;
      }
    }

    // 2. Universal ZXing decoder fallback (works on iOS Safari, Firefox, Desktop)
    if (!zxingDecoderRef.current) {
      try {
        const [{ ZXingHtml5QrcodeDecoder }, { BaseLoggger, Html5QrcodeSupportedFormats }] =
          await Promise.all([
            import('html5-qrcode/esm/zxing-html5-qrcode-decoder'),
            import('html5-qrcode/esm/core'),
          ]);
        const allFormats = [
          Html5QrcodeSupportedFormats.QR_CODE,
          Html5QrcodeSupportedFormats.CODE_128,
          Html5QrcodeSupportedFormats.CODE_39,
          Html5QrcodeSupportedFormats.CODE_93,
          Html5QrcodeSupportedFormats.EAN_13,
          Html5QrcodeSupportedFormats.EAN_8,
          Html5QrcodeSupportedFormats.ITF,
          Html5QrcodeSupportedFormats.UPC_A,
          Html5QrcodeSupportedFormats.UPC_E,
          Html5QrcodeSupportedFormats.CODABAR,
          Html5QrcodeSupportedFormats.DATA_MATRIX,
          Html5QrcodeSupportedFormats.AZTEC,
          Html5QrcodeSupportedFormats.PDF_417,
        ];
        zxingDecoderRef.current = new ZXingHtml5QrcodeDecoder(
          allFormats,
          false,
          new BaseLoggger(false)
        );
      } catch {
        zxingDecoderRef.current = null;
      }
    }
  }, []);

  const scheduleDecodeLoop = useCallback(
    (token: number) => {
      const tick = async () => {
        if (sessionTokenRef.current !== token) return;
        const video = videoRef.current;
        if (
          video &&
          video.readyState >= 2 &&
          video.videoWidth > 0 &&
          video.videoHeight > 0 &&
          !video.paused
        ) {
          let decoded = '';

          // Fast native hardware detector
          if (nativeDetectorRef.current) {
            try {
              const hits = await nativeDetectorRef.current.detect(video);
              if (hits && hits.length > 0 && hits[0]?.rawValue) {
                decoded = hits[0].rawValue;
              }
            } catch {
              // Fall through to ZXing
            }
          }

          // Universal ZXing canvas fallback
          if (!decoded && zxingDecoderRef.current && sessionTokenRef.current === token) {
            try {
              const maxSide = 720;
              const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
              const w = Math.max(120, Math.round(video.videoWidth * scale));
              const h = Math.max(120, Math.round(video.videoHeight * scale));

              let canvas = canvasRef.current;
              if (!canvas) {
                canvas = document.createElement('canvas');
                canvasRef.current = canvas;
              }
              if (canvas.width !== w) canvas.width = w;
              if (canvas.height !== h) canvas.height = h;

              const ctx = canvas.getContext('2d', { willReadFrequently: true });
              if (ctx) {
                ctx.drawImage(video, 0, 0, w, h);
                const result = await zxingDecoderRef.current.decodeAsync(canvas);
                if (result?.text) {
                  decoded = result.text;
                }
              }
            } catch {
              // Normal when no barcode is currently in the frame
            }
          }

          if (decoded && sessionTokenRef.current === token) {
            emitScan(decoded);
          }
        }

        if (sessionTokenRef.current === token) {
          scanTimerRef.current = setTimeout(() => {
            void tick();
          }, 140);
        }
      };

      scanTimerRef.current = setTimeout(() => {
        void tick();
      }, 180);
    },
    [emitScan]
  );

  const openCameraStream = useCallback(
    async (options?: {
      nextFacing?: 'environment' | 'user';
      exactFacing?: boolean;
      targetDeviceId?: string;
    }) => {
      if (disabled) return false;

      const token = ++sessionTokenRef.current;
      const hadActiveStream = Boolean(streamRef.current);

      setCameraError(null);
      setIsStarting(true);
      setTorchOn(false);
      setTorchSupported(false);

      // Stop previous stream & wait briefly so mobile OS releases hardware camera lock
      if (hadActiveStream) {
        releaseStream();
        await waitMs(180);
      }
      if (sessionTokenRef.current !== token) return false;

      try {
        if (
          typeof navigator === 'undefined' ||
          !navigator.mediaDevices ||
          typeof navigator.mediaDevices.getUserMedia !== 'function'
        ) {
          setCameraError(
            'الكاميرا غير مدعومة في هذا السياق (يتطلب HTTPS). يمكنك استخدام زر "رفع صورة / تصوير" أو الإدخال اليدوي.'
          );
          setIsStarting(false);
          setIsScanning(false);
          return false;
        }

        const targetFacing = options?.nextFacing ?? facingModeRef.current;
        const attempts: MediaStreamConstraints[] = [];

        if (options?.targetDeviceId) {
          attempts.push({
            audio: false,
            video: {
              deviceId: { exact: options.targetDeviceId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          });
          attempts.push({
            audio: false,
            video: { deviceId: { exact: options.targetDeviceId } },
          });
        } else {
          if (options?.exactFacing) {
            attempts.push({
              audio: false,
              video: {
                facingMode: { exact: targetFacing },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            });
            attempts.push({
              audio: false,
              video: { facingMode: { exact: targetFacing } },
            });
          } else {
            attempts.push({
              audio: false,
              video: {
                facingMode: { ideal: targetFacing },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
            });
            attempts.push({
              audio: false,
              video: { facingMode: targetFacing },
            });
            attempts.push({
              audio: false,
              video: true,
            });
          }
        }

        let acquiredStream: MediaStream | null = null;
        let lastErr: unknown = null;

        for (const constraints of attempts) {
          if (sessionTokenRef.current !== token) break;
          try {
            acquiredStream = await navigator.mediaDevices.getUserMedia(constraints);
            break;
          } catch (err) {
            lastErr = err;
            const errName = err instanceof Error ? err.name : '';
            // Do not keep retrying if user explicitly denied permission
            if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
              break;
            }
          }
        }

        if (sessionTokenRef.current !== token) {
          acquiredStream?.getTracks().forEach((t) => t.stop());
          return false;
        }

        if (!acquiredStream) {
          throw lastErr ?? new Error('Unable to acquire camera stream');
        }

        streamRef.current = acquiredStream;

        const video = videoRef.current;
        if (!video) {
          releaseStream();
          setIsStarting(false);
          setIsScanning(false);
          return false;
        }

        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline', 'true');
        video.setAttribute('muted', 'true');
        video.srcObject = acquiredStream;

        try {
          await video.play();
        } catch (playErr) {
          const playMsg = playErr instanceof Error ? playErr.name : '';
          if (playMsg === 'AbortError' && sessionTokenRef.current !== token) {
            return false;
          }
        }

        if (sessionTokenRef.current !== token) {
          releaseStream();
          return false;
        }

        const track = acquiredStream.getVideoTracks()[0];
        if (track) {
          const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
          activeDeviceIdRef.current = settings.deviceId ?? null;

          const detectedFacing =
            settings.facingMode === 'user' || settings.facingMode === 'environment'
              ? settings.facingMode
              : targetFacing;
          facingModeRef.current = detectedFacing;
          setFacingMode(detectedFacing);

          const caps =
            typeof track.getCapabilities === 'function'
              ? (track.getCapabilities() as MediaTrackCapabilities & {
                  torch?: boolean;
                  fillLightMode?: string[];
                  focusMode?: string[];
                })
              : null;

          // Enable continuous autofocus if hardware exposes it
          if (caps && Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
            try {
              await track.applyConstraints({
                advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet],
              });
            } catch {
              // Ignore autofocus constraint errors
            }
          }

          const hasTorch = Boolean(
            caps &&
              ('torch' in caps ||
                (Array.isArray(caps.fillLightMode) && caps.fillLightMode.includes('flash')))
          );
          setTorchSupported(hasTorch);
        }

        await ensureDecoders();
        if (sessionTokenRef.current !== token) {
          releaseStream();
          return false;
        }

        setIsStarting(false);
        setIsScanning(true);
        scheduleDecodeLoop(token);
        return true;
      } catch (err) {
        if (sessionTokenRef.current !== token) return false;
        const errName = err instanceof Error ? err.name : '';
        const errMsg = err instanceof Error ? err.message : String(err ?? '');

        if (
          errName === 'NotAllowedError' ||
          errName === 'PermissionDeniedError' ||
          /Permission|NotAllowed|denied/i.test(errMsg)
        ) {
          setCameraError(
            'تم رفض صلاحية الكاميرا. اسمح بالوصول للكاميرا من إعدادات المتصفح أو استخدم زر "رفع صورة / تصوير".'
          );
        } else if (
          errName === 'NotFoundError' ||
          errName === 'DevicesNotFoundError' ||
          /NotFound|Requested device not found/i.test(errMsg)
        ) {
          setCameraError('لم يتم العثور على كاميرا متصلة. استخدم زر "رفع صورة / تصوير" أو الإدخال اليدوي.');
        } else if (errName === 'NotReadableError' || /NotReadable|Could not start/i.test(errMsg)) {
          setCameraError(
            'الكاميرا مشغولة بتطبيق آخر أو لم تتحرر بعد. أغلق أي تطبيق يستخدم الكاميرا وجرّب مرة أخرى.'
          );
        } else {
          setCameraError(
            'تعذر فتح البث المباشر للكاميرا. يمكنك استخدام زر "رفع صورة / تصوير" أو إدخال الباركود يدوياً.'
          );
        }

        releaseStream();
        setIsStarting(false);
        setIsScanning(false);
        return false;
      }
    },
    [disabled, ensureDecoders, releaseStream, scheduleDecodeLoop]
  );

  const handleToggleTorch = async () => {
    setCameraError(null);
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
      setCameraError('شغّل الكاميرا أولاً لتتمكن من تشغيل الفلاش.');
      return;
    }

    const nextTorch = !torchOn;
    const caps =
      typeof track.getCapabilities === 'function'
        ? (track.getCapabilities() as MediaTrackCapabilities & {
            torch?: boolean;
            fillLightMode?: string[];
          })
        : null;

    if (caps && !('torch' in caps) && facingModeRef.current === 'user') {
      setCameraError('الفلاش غير متاح مع الكاميرا الأمامية. اضغط "تبديل" للانتقال للكاميرا الخلفية.');
      return;
    }

    try {
      await track.applyConstraints({
        advanced: [{ torch: nextTorch } as MediaTrackConstraintSet],
      });
      setTorchOn(nextTorch);
      setTorchSupported(true);
    } catch {
      if (caps && Array.isArray(caps.fillLightMode) && caps.fillLightMode.includes('flash')) {
        try {
          await track.applyConstraints({
            advanced: [
              { fillLightMode: nextTorch ? 'flash' : 'off' } as unknown as MediaTrackConstraintSet,
            ],
          });
          setTorchOn(nextTorch);
          setTorchSupported(true);
          return;
        } catch {
          // Fall through to helpful message
        }
      }
      setCameraError(
        facingModeRef.current === 'user'
          ? 'الفلاش غير متاح في الكاميرا الأمامية. بدّل للكاميرا الخلفية.'
          : 'متصفح هذا الهاتف لا يسمح بتشغيل الفلاش من داخل الصفحة؛ يمكنك تشغيل الكشاف من لوحة تحكم الهاتف.'
      );
    }
  };

  const handleSwitchCamera = async () => {
    if (isStarting) return;
    setCameraError(null);

    const prevFacing = facingModeRef.current;
    const prevDeviceId = activeDeviceIdRef.current;
    const nextFacing: 'environment' | 'user' = prevFacing === 'environment' ? 'user' : 'environment';

    // First try explicit opposite facingMode (relies on OS to pick main rear <-> front lens)
    const switchedByFacing = await openCameraStream({ nextFacing, exactFacing: true });
    if (switchedByFacing) return;

    // Fallback for multi-camera devices: match by label (front/back) or cycle distinct deviceId
    try {
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (d) => d.kind === 'videoinput' && Boolean(d.deviceId)
      );
      if (devices.length >= 2) {
        const labelPattern =
          nextFacing === 'user' ? /front|user|facetime|selfie/i : /back|rear|environment/i;
        const labeledMatch = devices.find(
          (d) => d.deviceId !== prevDeviceId && labelPattern.test(d.label)
        );
        const currentIndex = devices.findIndex((d) => d.deviceId === prevDeviceId);
        const fallbackDevice =
          labeledMatch ?? devices[(currentIndex + 1) % devices.length];

        if (fallbackDevice && fallbackDevice.deviceId !== prevDeviceId) {
          const switchedById = await openCameraStream({
            targetDeviceId: fallbackDevice.deviceId,
            nextFacing,
          });
          if (switchedById) return;
        }
      }
    } catch {
      // Ignore enumerateDevices failures
    }

    // Restore previous camera cleanly if only 1 physical camera exists
    await openCameraStream({ nextFacing: prevFacing });
    setCameraError('تتوفر كاميرا واحدة فقط على هذا الجهاز أو تعذر التبديل للعدسة الأخرى.');
  };

  const handleImageScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCameraError(null);

    if (isScanning || isStarting) {
      await stopCamera();
    }

    // 1. Try Html5Qrcode file scanner on a dedicated hidden element (never touches <video>)
    try {
      const { Html5Qrcode } = await import('html5-qrcode');
      const fileScanner = new Html5Qrcode(fileReaderElementId, {
        verbose: false,
      });
      const decoded = await fileScanner.scanFile(file, false);
      try {
        fileScanner.clear();
      } catch {
        // Ignore clear errors
      }
      emitScan(decoded);
      return;
    } catch {
      // Fall through to downsampled canvas + native BarcodeDetector / ZXing
    }

    // 2. Backup: downsample high-res mobile photos (max 1200px) & run native BarcodeDetector + ZXing
    try {
      await ensureDecoders();
      const bitmap = await createImageBitmap(file);
      try {
        if (nativeDetectorRef.current) {
          const hits = await nativeDetectorRef.current.detect(bitmap);
          if (hits && hits.length > 0 && hits[0]?.rawValue) {
            emitScan(hits[0].rawValue);
            return;
          }
        }

        if (zxingDecoderRef.current) {
          const maxSide = 1200;
          const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
          const w = Math.max(120, Math.round(bitmap.width * scale));
          const h = Math.max(120, Math.round(bitmap.height * scale));
          const tempCanvas = document.createElement('canvas');
          tempCanvas.width = w;
          tempCanvas.height = h;
          const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            ctx.drawImage(bitmap, 0, 0, w, h);
            const result = await zxingDecoderRef.current.decodeAsync(tempCanvas);
            if (result?.text) {
              emitScan(result.text);
              return;
            }
          }
        }
      } finally {
        bitmap.close();
      }
    } catch {
      // Ignore fallback error
    }

    setCameraError('لم يتم العثور على باركود واضح في الملف أو الصورة المختارة. جرّب صورة أوضح أو الإدخال اليدوي.');
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    emitScan(manualCode.trim());
    setManualCode('');
  };

  useEffect(() => {
    return () => {
      sessionTokenRef.current += 1;
      releaseStream();
    };
  }, [releaseStream]);

  const isExpanded = isScanning || isStarting;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>ماسح الباركود والـ QR</span>
        </h2>

        <div className="flex flex-wrap items-center gap-1.5">
          {isScanning && (
            <>
              <button
                type="button"
                onClick={() => void handleToggleTorch()}
                aria-label="تشغيل أو إطفاء الفلاش"
                title={torchSupported ? 'تشغيل أو إطفاء الفلاش' : 'الفلاش'}
                className={`inline-flex items-center justify-center rounded-xl px-2.5 py-2 text-xs font-semibold min-h-[42px] transition-colors ${
                  torchOn
                    ? 'bg-amber-500 text-black'
                    : 'bg-slate-100 dark:bg-neutral-900 text-slate-700 dark:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-800'
                }`}
              >
                <Flashlight className="w-4 h-4 ml-1" />
                <span>{torchOn ? 'إطفاء الفلاش' : 'فلاش'}</span>
              </button>

              <button
                type="button"
                onClick={() => void handleSwitchCamera()}
                aria-label="تبديل الكاميرا"
                className="inline-flex items-center justify-center rounded-xl bg-slate-100 dark:bg-neutral-900 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-800 min-h-[42px]"
              >
                <SwitchCamera className="w-4 h-4 ml-1" />
                <span>تبديل</span>
              </button>
            </>
          )}

          {/* No `capture` attribute so mobile OS offers Take Photo / Photo Library / Choose File */}
          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            aria-label="اختيار صورة أو ملف أو تصوير"
            className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-800 min-h-[42px]"
          >
            <ImageUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>رفع صورة / تصوير</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => void handleImageScan(e)}
            className="sr-only"
          />

          <button
            type="button"
            disabled={disabled || isStarting}
            onClick={() => (isScanning ? void stopCamera() : void openCameraStream())}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold min-h-[42px] transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 ${
              isScanning
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {isScanning ? (
              <>
                <CameraOff className="w-4 h-4" />
                <span>إيقاف</span>
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                <span>{isStarting ? 'جاري الفتح...' : 'تشغيل الكاميرا'}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Dedicated hidden element for Html5Qrcode file scanning */}
      <div id={fileReaderElementId} className="hidden" aria-hidden="true" />

      {/* Native WebRTC Video Viewport with RTL-safe Aiming Reticle */}
      <div
        dir="ltr"
        className={`relative w-full overflow-hidden rounded-xl bg-slate-900 dark:bg-black border border-slate-800 transition-all ${
          isExpanded ? 'h-[260px] sm:h-[290px]' : compactIdle ? 'h-12' : 'h-20'
        }`}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={`w-full h-full object-cover ${
            isScanning ? 'opacity-100' : 'opacity-0 pointer-events-none'
          } ${facingMode === 'user' ? '-scale-x-100' : ''}`}
        />

        {isScanning && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
            <div className="relative w-full max-w-[260px] h-[160px] rounded-2xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]">
              <div className="absolute -top-0.5 -left-0.5 w-5 h-5 border-t-4 border-l-4 border-white rounded-tl-xl" />
              <div className="absolute -top-0.5 -right-0.5 w-5 h-5 border-t-4 border-r-4 border-white rounded-tr-xl" />
              <div className="absolute -bottom-0.5 -left-0.5 w-5 h-5 border-b-4 border-l-4 border-white rounded-bl-xl" />
              <div className="absolute -bottom-0.5 -right-0.5 w-5 h-5 border-b-4 border-r-4 border-white rounded-br-xl" />
            </div>
          </div>
        )}

        {!isScanning && (
          <div
            dir="rtl"
            className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center"
          >
            <p className="text-xs text-slate-300 dark:text-neutral-400">
              {isStarting
                ? 'جاري فتح الكاميرا...'
                : 'اضغط "تشغيل الكاميرا" أو "رفع صورة / تصوير" لمسح باركود المتسابق'}
            </p>
          </div>
        )}
      </div>

      {/* Quick manual barcode entry */}
      <form onSubmit={handleManualSubmit} className="flex items-center gap-2">
        <div className="relative flex-1">
          <Keyboard className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            dir="ltr"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder="أدخل الباركود واضغط Enter..."
            className="w-full rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black pr-9 pl-3 py-2 text-xs font-ascii-mono text-slate-900 dark:text-white placeholder:text-slate-400 min-h-[40px]"
          />
        </div>
        <button
          type="submit"
          disabled={!manualCode.trim()}
          className="rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-3.5 py-2 text-xs font-bold min-h-[40px] disabled:opacity-40 whitespace-nowrap"
        >
          فحص
        </button>
      </form>

      {cameraError && (
        <p role="alert" className="text-xs font-medium text-amber-700 dark:text-amber-400 leading-relaxed">
          {cameraError}
        </p>
      )}
    </div>
  );
};
