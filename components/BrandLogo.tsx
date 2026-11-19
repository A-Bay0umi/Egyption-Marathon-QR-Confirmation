import React from 'react';
import Image from 'next/image';

interface BrandLogoProps {
  size?: number;
  showText?: boolean;
  showSubtitle?: boolean;
  compact?: boolean;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 40,
  showText = true,
  showSubtitle = false,
  compact = false,
}) => {
  return (
    <div className="inline-flex items-center gap-2.5 min-w-0">
      <div
        className="relative shrink-0 overflow-hidden rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-900"
        style={{ width: size, height: size }}
      >
        <Image
          src="/logo.png"
          alt="شعار EM QR"
          width={size}
          height={size}
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          priority
        />
      </div>

      {showText && (
        <div className="min-w-0 text-right leading-tight">
          <div
            dir="ltr"
            className={`font-bold tracking-tight text-slate-900 dark:text-white truncate ${
              compact ? 'text-sm' : 'text-base'
            }`}
          >
            EM QR
          </div>
          {showSubtitle && (
            <div
              dir="ltr"
              className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 truncate"
            >
              Egyptian Marathon QR
            </div>
          )}
        </div>
      )}
    </div>
  );
};
