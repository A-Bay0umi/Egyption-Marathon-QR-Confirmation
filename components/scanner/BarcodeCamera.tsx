'use client';

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Camera, CameraOff, Flashlight, ImageUp, Keyboard, SwitchCamera } from 'lucide-react';
import type { Html5Qrcode } from 'html5-qrcode';

interface BarcodeCameraProps {
  onScan: (decodedText: string) => void;
  disabled?: boolean;
  compactIdle?: boolean;
}

export const BarcodeCamera: React.FC<BarcodeCameraProps> = ({
  onScan,
  disabled = false,
  compactIdle = false,
}) => {
  const reactId = useId();
  const readerElementId = `marathon-qr-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  const [isStarting, setIsStarting] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [cameraIdx, setCameraIdx] = useState<number | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [torchOn, setTorchOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [manualCode, setManualCode] = useState('');

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const busyRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
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

  const stopCamera = useCallback(async () => {
    busyRef.current = true;
    try {
      const scanner = scannerRef.current;
      if (scanner) {
        if (scanner.isScanning) {
          await scanner.stop();
        }
        try {
          scanner.clear();
        } catch {
          // Ignore clear errors if DOM already unmounted
        }
      }
    } catch {
      // Ignore stop errors during unmount
    } finally {
      scannerRef.current = null;
      setIsStarting(false);
      setIsScanning(false);
      setTorchOn(false);
      busyRef.current = false;
    }
  }, []);

  const startCamera = useCallback(
    async (options?: { targetCameraIdx?: number; nextFacing?: 'environment' | 'user' }) => {
      if (disabled || busyRef.current) return;
      busyRef.current = true;
      setCameraError(null);
      setIsStarting(true);

      try {
        if (
          typeof navigator === 'undefined' ||
          !navigator.mediaDevices ||
          typeof navigator.mediaDevices.getUserMedia !== 'function'
        ) {
          setCameraError(
            'الكاميرا غير متاحة في هذا المتصفح (يجب فتح الموقع عبر HTTPS). يمكنك استخدام مسح صورة أو الإدخال اليدوي.'
          );
          setIsStarting(false);
          busyRef.current = false;
          return;
        }

        // Wait a frame so the reader container expands to full height BEFORE html5-qrcode measures it
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });

        const { Html5Qrcode: Html5QrcodeClass } = await import('html5-qrcode');

        if (scannerRef.current) {
          try {
            if (scannerRef.current.isScanning) {
              await scannerRef.current.stop();
            }
            scannerRef.current.clear();
          } catch {
            // Ignore cleanup errors
          }
          scannerRef.current = null;
        }

        const scanner = new Html5QrcodeClass(readerElementId, {
          verbose: false,
          experimentalFeatures: {
            useBarCodeDetectorIfSupported: true,
          },
        });
        scannerRef.current = scanner;

        const targetIdx = options?.targetCameraIdx;
        const chosenFacing = options?.nextFacing ?? facingMode;

        const cameraConstraint: string | { facingMode: string } =
          targetIdx !== undefined && cameras[targetIdx]
            ? cameras[targetIdx].id
            : { facingMode: chosenFacing };

        await scanner.start(
          cameraConstraint,
          {
            fps: 15,
            disableFlip: false,
            qrbox: (viewfinderWidth: number, viewfinderHeight: number) => {
              const w = Math.max(150, Math.floor(Math.min(viewfinderWidth, 340) * 0.84));
              const h = Math.max(120, Math.floor(Math.min(viewfinderHeight, 260) * 0.68));
              return { width: w, height: h };
            },
          },
          (decodedText) => {
            emitScan(decodedText);
          },
          () => {
            // Ignore frame decode misses
          }
        );

        setIsStarting(false);
        setIsScanning(true);

        // Safely enumerate cameras AFTER permission is granted
        try {
          const detected = await Html5QrcodeClass.getCameras();
          const mapped = detected.map((d, i) => ({
            id: d.id,
            label: d.label || `كاميرا ${i + 1}`,
          }));
          setCameras(mapped);
          if (targetIdx !== undefined) {
            setCameraIdx(targetIdx);
          } else if (mapped.length > 0) {
            const backIdx = mapped.findIndex((c) => /back|rear|environment/i.test(c.label));
            setCameraIdx(backIdx >= 0 ? backIdx : 0);
          }
        } catch {
          // Non-fatal if browser hides device labels
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err ?? '');
        if (/Permission|NotAllowed|denied/i.test(msg)) {
          setCameraError(
            'تم رفض صلاحية الكاميرا. اسمح بالوصول للكاميرا من إعدادات المتصفح أو استخدم زر "صورة".'
          );
        } else if (/NotFound|DevicesNotFound|Requested device not found/i.test(msg)) {
          setCameraError('لم يتم العثور على كاميرا متصلة. استخدم البحث بالأسفل أو الإدخال اليدوي.');
        } else {
          setCameraError(
            'تعذر فتح البث المباشر للكاميرا هنا. جرّب زر "صورة" لمسح الكود أو اكتب الباركود بالأسفل.'
          );
        }
        scannerRef.current = null;
        setIsStarting(false);
        setIsScanning(false);
      } finally {
        busyRef.current = false;
      }
    },
    [cameras, disabled, emitScan, facingMode, readerElementId]
  );

  const handleToggleTorch = async () => {
    try {
      const next = !torchOn;
      if (scannerRef.current && scannerRef.current.isScanning) {
        await scannerRef.current.applyVideoConstraints({
          advanced: [{ torch: next } as MediaTrackConstraintSet],
        });
        setTorchOn(next);
      }
    } catch {
      setCameraError('الفلاش غير مدعوم على هذه الكاميرا');
    }
  };

  const handleSwitchCamera = async () => {
    if (cameras.length >= 2 && cameraIdx !== null) {
      const nextIdx = (cameraIdx + 1) % cameras.length;
      await startCamera({ targetCameraIdx: nextIdx });
      return;
    }
    const nextFacing = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextFacing);
    await startCamera({ nextFacing });
  };

  const handleImageScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCameraError(null);
    try {
      if (isScanning) {
        await stopCamera();
      }
      const { Html5Qrcode: Html5QrcodeClass } = await import('html5-qrcode');
      const fileScanner = new Html5QrcodeClass(readerElementId, {
        verbose: false,
        experimentalFeatures: { useBarCodeDetectorIfSupported: true },
      });
      const decoded = await fileScanner.scanFile(file, false);
      try {
        fileScanner.clear();
      } catch {
        // Ignore
      }
      emitScan(decoded);
    } catch {
      setCameraError('لم يتم العثور على باركود واضح في الصورة. حاول الاقتراب أكثر أو الإدخال اليدوي.');
    }
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualCode.trim()) return;
    emitScan(manualCode.trim());
    setManualCode('');
  };

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, [stopCamera]);

  const isExpanded = isScanning || isStarting;

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3 sm:p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>ماسح الباركود والـ QR</span>
        </h2>

        <div className="flex items-center gap-1.5">
          {isScanning && (
            <>
              <button
                type="button"
                onClick={() => void handleToggleTorch()}
                aria-label="تشغيل أو إطفاء الفلاش"
                className={`inline-flex items-center justify-center rounded-xl px-2.5 py-2 text-xs font-semibold min-h-[42px] transition-colors ${
                  torchOn
                    ? 'bg-amber-500 text-black'
                    : 'bg-slate-100 dark:bg-neutral-900 text-slate-700 dark:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-800'
                }`}
              >
                <Flashlight className="w-4 h-4 ml-1" />
                <span>فلاش</span>
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

          <button
            type="button"
            disabled={disabled}
            onClick={() => fileInputRef.current?.click()}
            aria-label="مسح من صورة"
            className="inline-flex items-center justify-center gap-1 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900 px-2.5 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-800 min-h-[42px]"
          >
            <ImageUp className="w-4 h-4" />
            <span>صورة</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => void handleImageScan(e)}
            className="sr-only"
          />

          <button
            type="button"
            disabled={disabled || isStarting}
            onClick={() => (isScanning ? void stopCamera() : void startCamera())}
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

      {/* Wrapper keeps React idle overlay SEPARATE from html5-qrcode's DOM node */}
      <div
        className={`relative w-full overflow-hidden rounded-xl bg-slate-900 dark:bg-black border border-slate-800 transition-all ${
          isExpanded ? 'min-h-[260px]' : compactIdle ? 'h-12' : 'h-20'
        }`}
      >
        <div
          id={readerElementId}
          className="w-full h-full [&_video]:w-full [&_video]:h-auto [&_video]:object-cover"
        />

        {!isScanning && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center">
            <p className="text-xs text-slate-300 dark:text-neutral-400">
              {isStarting
                ? 'جاري تهيئة الكاميرا...'
                : 'اضغط "تشغيل الكاميرا" أو "صورة" لمسح باركود المتسابق'}
            </p>
          </div>
        )}
      </div>

      {/* Quick manual barcode entry (great for hardware scanners or damaged cameras) */}
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
        <p className="text-xs font-medium text-amber-700 dark:text-amber-400 leading-relaxed">
          {cameraError}
        </p>
      )}
    </div>
  );
};
