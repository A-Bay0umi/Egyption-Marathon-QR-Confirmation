import React, { Suspense } from 'react';
import { OrganizerScannerApp } from '@/components/scanner/OrganizerScannerApp';

export default function ScanPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black text-sm font-semibold text-slate-600 dark:text-neutral-300">
          جاري تحميل واجهة المسح...
        </div>
      }
    >
      <OrganizerScannerApp />
    </Suspense>
  );
}
