'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, Flashlight, SwitchCamera } from 'lucide-react';
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
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([]);
  const [cameraIdx, setCameraIdx] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = useRef(onScan);
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const stopCamera = useCallback(async () => {
    try {
      if (scannerRef.current && scannerRef.current.isScanning) {
        await scannerRef.current.stop();
      }
    } catch {
      // Ignore stop errors during unmount
    } finally {
      setIsScanning(false);
      setTorchOn(false);
    }
  }, []);

  const startCamera = useCallback(
    async (targetIdx?: number) => {
      if (disabled) return;
      setCameraError(null);
      try {
        const { Html5Qrcode: Html5QrcodeClass } = await import('html5-qrcode');

        if (!scannerRef.current) {
          scannerRef.current = new Html5QrcodeClass('marathon-qr-reader', {
            verbose: false,
          });
        }

        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }

        let available = cameras;
        if (available.length === 0) {
          const detected = await Html5QrcodeClass.getCameras();
          available = detected.map((d) => ({
            id: d.id,
            label: d.label || 'كاميرا',
          }));
          setCameras(available);
        }

        const chosenIdx = targetIdx ?? cameraIdx;
        const backCamIdx = available.findIndex((c) => /back|rear|environment/i.test(c.label));
        const finalIdx =
          targetIdx !== undefined
            ? chosenIdx % Math.max(available.length, 1)
            : backCamIdx >= 0
            ? backCamIdx
            : 0;

        setCameraIdx(finalIdx);

        const cameraIdOrConfig =
          available.length > 0 && available[finalIdx]
            ? available[finalIdx].id
            : { facingMode: 'environment' };

        await scannerRef.current.start(
          cameraIdOrConfig,
          {
            fps: 12,
            qrbox: { width: 250, height: 150 },
            aspectRatio: 1.5,
          },
          (decodedText) => {
            const now = Date.now();
            if (
              lastScanRef.current.code === decodedText &&
              now - lastScanRef.current.at < 1500
            ) {
              return;
            }
            lastScanRef.current = { code: decodedText, at: now };
            onScanRef.current(decodedText);
          },
          () => {
            // Ignore frame decode misses
          }
        );

        setIsScanning(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (/Permission|NotAllowed/i.test(msg)) {
          setCameraError('تم رفض صلاحية الكاميرا. يمكنك استخدام البحث الفوري بالأسفل.');
        } else {
          setCameraError('تعذر تشغيل الكاميرا على هذا المتصفح. استخدم البحث الفوري بالأسفل.');
        }
        setIsScanning(false);
      }
    },
    [cameraIdx, cameras, disabled]
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
    if (cameras.length < 2) return;
    const nextIdx = (cameraIdx + 1) % cameras.length;
    await startCamera(nextIdx);
  };

  useEffect(() => {
    return () => {
      void stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <Camera className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>ماسح الباركود والـ QR</span>
        </h2>

        <div className="flex items-center gap-2">
          {isScanning && (
            <>
              <button
                type="button"
                onClick={() => void handleToggleTorch()}
                aria-label="تشغيل أو إطفاء الفلاش"
                className={`inline-flex items-center justify-center rounded-xl px-3 py-2 text-xs font-semibold min-h-[44px] transition-colors ${
                  torchOn
                    ? 'bg-amber-500 text-black'
                    : 'bg-slate-100 dark:bg-neutral-900 text-slate-700 dark:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-800'
                }`}
              >
                <Flashlight className="w-4 h-4 ml-1" />
                <span>فلاش</span>
              </button>

              {cameras.length > 1 && (
                <button
                  type="button"
                  onClick={() => void handleSwitchCamera()}
                  aria-label="تبديل الكاميرا"
                  className="inline-flex items-center justify-center rounded-xl bg-slate-100 dark:bg-neutral-900 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-200 hover:bg-slate-200 dark:hover:bg-neutral-800 min-h-[44px]"
                >
                  <SwitchCamera className="w-4 h-4 ml-1" />
                  <span>تبديل</span>
                </button>
              )}
            </>
          )}

          <button
            type="button"
            disabled={disabled}
            onClick={() => (isScanning ? void stopCamera() : void startCamera())}
            className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold min-h-[44px] transition-colors whitespace-nowrap shrink-0 ${
              isScanning
                ? 'bg-red-600 text-white hover:bg-red-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {isScanning ? (
              <>
                <CameraOff className="w-4 h-4" />
                <span>إيقاف الكاميرا</span>
              </>
            ) : (
              <>
                <Camera className="w-4 h-4" />
                <span>تشغيل الكاميرا</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div
        id="marathon-qr-reader"
        className={`w-full overflow-hidden rounded-xl bg-slate-900/95 dark:bg-black border border-slate-800 transition-all ${
          isScanning
            ? 'min-h-[220px]'
            : compactIdle
            ? 'h-12 flex items-center justify-center'
            : 'h-20 flex items-center justify-center'
        }`}
      >
        {!isScanning && (
          <div className="text-center px-4">
            <p className="text-xs text-slate-300 dark:text-neutral-400">
              اضغط &quot;تشغيل الكاميرا&quot; لمسح باركود المتسابق أو استخدم البحث الذكي بالأسفل
            </p>
          </div>
        )}
      </div>

      {cameraError && (
        <p className="mt-2.5 text-xs font-medium text-amber-700 dark:text-amber-400">
          {cameraError}
        </p>
      )}
    </div>
  );
};
