'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Package,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  TrendingUp,
  UserCheck,
  Users,
  WifiOff,
} from 'lucide-react';
import {
  buildDayReport,
  buildWhatsAppDayReportSummary,
  formatArabicDurationSeconds,
  formatCairoHourRange,
  formatCairoTime,
  getCairoDateKey,
} from '@/lib/report-logic';
import type {
  ActivityLog,
  DeliveryConflictResolution,
  MarathonEvent,
  Organizer,
  Participant,
} from '@/lib/types';

interface EventDayReportTabProps {
  event: MarathonEvent;
  participants: Participant[];
  organizers: Organizer[];
  logs: ActivityLog[];
  conflictResolutions: Record<string, DeliveryConflictResolution>;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
  onOpenConflictsTab: () => void;
}

const ITEM_BAR_COLORS = [
  'bg-emerald-600 dark:bg-emerald-500',
  'bg-sky-600 dark:bg-sky-500',
  'bg-amber-500 dark:bg-amber-400',
  'bg-violet-600 dark:bg-violet-500',
  'bg-rose-600 dark:bg-rose-500',
  'bg-teal-600 dark:bg-teal-500',
] as const;

const ITEM_DOT_COLORS = [
  'bg-emerald-600',
  'bg-sky-600',
  'bg-amber-500',
  'bg-violet-600',
  'bg-rose-600',
  'bg-teal-600',
] as const;

function copyTextWithFallback(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    return navigator.clipboard
      .writeText(text)
      .then(() => true)
      .catch(() => fallbackExecCommandCopy(text));
  }
  return Promise.resolve(fallbackExecCommandCopy(text));
}

function fallbackExecCommandCopy(text: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export const EventDayReportTab: React.FC<EventDayReportTabProps> = ({
  event,
  participants,
  organizers,
  logs,
  conflictResolutions,
  loaded,
  loading,
  error,
  onRefresh,
  onOpenConflictsTab,
}) => {
  const todayCairo = useMemo(() => getCairoDateKey(new Date()), []);
  const [selectedDate, setSelectedDate] = useState<string>(() => getCairoDateKey(new Date()));
  const [searchByItem, setSearchByItem] = useState<Record<string, string>>({});
  const [showAllByItem, setShowAllByItem] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const report = useMemo(
    () =>
      buildDayReport({
        event,
        participants,
        organizers,
        logs,
        conflictResolutions,
        selectedDate,
      }),
    [event, participants, organizers, logs, conflictResolutions, selectedDate]
  );

  const handleCopyWhatsApp = async () => {
    const summaryText = buildWhatsAppDayReportSummary(report, event);
    const ok = await copyTextWithFallback(summaryText);
    setCopyStatus(ok ? 'copied' : 'error');
    window.setTimeout(() => {
      setCopyStatus('idle');
    }, 2600);
  };

  const handlePrint = () => {
    window.print();
  };

  const isAllDays = selectedDate === 'all';
  const dateDisplayLabel = isAllDays ? 'كل الأيام' : selectedDate || todayCairo;

  return (
    <div className="print-report-root space-y-6">
      {/* Print-only A4 Header */}
      <div className="hidden print:block border-b-2 border-black pb-3 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-black">
              تقرير نهاية اليوم — {event.name}
            </h1>
            <p className="text-xs text-black mt-1 font-mono-num">
              تاريخ التقرير: {dateDisplayLabel} · تاريخ الإيفنت: {event.date}
            </p>
          </div>
          <div className="text-xs text-black font-mono-num text-left">
            توقيت القاهرة (Africa/Cairo)
          </div>
        </div>
      </div>

      {/* Controls & Action Bar (hidden on print) */}
      <div className="no-print rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <span>تقرير نهاية اليوم</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
              ملخص التسليمات، أداء المنظمين، التوزيع بالساعة، المتبقين، والتدقيق بتوقيت القاهرة (Africa/Cairo).
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-800 min-h-[42px] disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span>{loading ? 'جاري التحديث...' : 'تحديث'}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCopyWhatsApp()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-950/70 px-3.5 py-2 text-xs font-bold min-h-[42px]"
            >
              {copyStatus === 'copied' ? (
                <>
                  <Check className="w-4 h-4" />
                  <span>تم النسخ للواتساب</span>
                </>
              ) : copyStatus === 'error' ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-red-600" />
                  <span className="text-red-600 dark:text-red-400">تعذر النسخ تلقائياً</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>نسخ ملخص واتساب</span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold min-h-[42px]"
            >
              <Printer className="w-4 h-4" />
              <span>طباعة / حفظ PDF</span>
            </button>
          </div>
        </div>

        {/* Date Filter Row */}
        <div className="pt-3 border-t border-slate-100 dark:border-neutral-800 flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-neutral-300">
            <Calendar className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            <span>اليوم:</span>
          </div>

          <input
            type="date"
            dir="ltr"
            aria-label="اختيار يوم التقرير"
            value={isAllDays ? '' : selectedDate}
            onChange={(e) => {
              const val = e.target.value;
              setSelectedDate(val || todayCairo);
            }}
            className="rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-1.5 text-xs font-ascii-mono text-slate-900 dark:text-white min-h-[38px]"
          />

          <button
            type="button"
            onClick={() => setSelectedDate(todayCairo)}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold min-h-[38px] border transition-colors ${
              selectedDate === todayCairo
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-900 text-slate-700 dark:text-neutral-200'
            }`}
          >
            اليوم
          </button>

          <button
            type="button"
            onClick={() => setSelectedDate('all')}
            className={`rounded-xl px-3 py-1.5 text-xs font-bold min-h-[38px] border transition-colors ${
              isAllDays
                ? 'border-emerald-600 bg-emerald-600 text-white'
                : 'border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-900 text-slate-700 dark:text-neutral-200'
            }`}
          >
            كل الأيام
          </button>

          {report.availableDates.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mr-auto">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-neutral-500">
                أيام بها نشاط:
              </span>
              {report.availableDates.slice(0, 5).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setSelectedDate(d)}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-ascii-mono font-bold border min-h-[32px] ${
                    selectedDate === d
                      ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                      : 'border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-400 hover:border-slate-300'
                  }`}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div
          role="alert"
          className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-4 flex items-center justify-between gap-3 text-xs sm:text-sm font-semibold text-red-800 dark:text-red-200"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 shrink-0 text-red-600 dark:text-red-400" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => void onRefresh()}
            className="no-print rounded-xl border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Initial Loading Skeleton */}
      {loading && !loaded ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((idx) => (
            <div
              key={idx}
              className="h-28 rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {/* Empty Logs Alert for Selected Day */}
          {loaded && report.summary.dayDeliveriesCount === 0 && (
            <div className="no-print rounded-2xl border border-amber-200 dark:border-amber-900/70 bg-amber-50/70 dark:bg-amber-950/30 p-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-amber-900 dark:text-amber-200">
                <Clock className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>
                  {isAllDays
                    ? 'لا توجد عمليات تسليم مسجلة في هذا الإيفنت حتى الآن.'
                    : `لا توجد عمليات تسليم مسجلة في يوم ${dateDisplayLabel}. يمكنك اختيار يوم آخر أو عرض كل الأيام.`}
                </span>
              </div>
              {!isAllDays && report.availableDates.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelectedDate('all')}
                  className="rounded-xl bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 text-xs font-bold min-h-[38px]"
                >
                  عرض كل الأيام ({report.availableDates.length})
                </button>
              )}
            </div>
          )}

          {/* SECTION 1: General Summary */}
          <section className="print-section space-y-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>1. الملخص العام ({dateDisplayLabel})</span>
            </h3>

            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
                <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                  إجمالي المتسابقين
                </div>
                <div className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-white font-mono-num">
                  {report.summary.totalParticipants.toLocaleString('en-US')}
                </div>
              </div>

              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
                <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                  {isAllDays ? 'إجمالي التسليمات' : 'تسليمات اليوم'}
                </div>
                <div className="mt-1.5 text-2xl font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                  {report.summary.dayDeliveriesCount.toLocaleString('en-US')}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num">
                  {report.summary.uniqueParticipantsDeliveredCount.toLocaleString('en-US')} متسابق فريد
                </div>
              </div>

              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
                <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                  نسبة الإنجاز الكلية
                </div>
                <div className="mt-1.5 text-2xl font-bold text-slate-900 dark:text-white font-mono-num">
                  {report.summary.overallCompletionPercent}%
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num">
                  {report.summary.overallDeliveredUnits.toLocaleString('en-US')} /{' '}
                  {report.summary.overallTotalUnits.toLocaleString('en-US')} وحدة
                </div>
              </div>

              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
                <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                  أول تسليم
                </div>
                <div className="mt-1.5 text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-mono-num">
                  {report.summary.firstDeliveryAt
                    ? formatCairoTime(report.summary.firstDeliveryAt)
                    : '—'}
                </div>
              </div>

              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
                <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                  آخر تسليم
                </div>
                <div className="mt-1.5 text-lg sm:text-xl font-bold text-slate-900 dark:text-white font-mono-num">
                  {report.summary.lastDeliveryAt
                    ? formatCairoTime(report.summary.lastDeliveryAt)
                    : '—'}
                </div>
              </div>

              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
                <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                  ساعة الذروة
                </div>
                <div className="mt-1.5 text-lg sm:text-xl font-bold text-emerald-700 dark:text-emerald-400 font-ascii-mono" dir="ltr">
                  {report.summary.peakHour
                    ? formatCairoHourRange(report.summary.peakHour.hour)
                    : '—'}
                </div>
                {report.summary.peakHour && (
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num">
                    {report.summary.peakHour.count.toLocaleString('en-US')} عملية
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* SECTION 2: Per-Item Completion */}
          <section className="print-section space-y-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>2. إنجاز المهام والعناصر</span>
            </h3>

            {report.itemStats.length === 0 ? (
              <div className="print-card rounded-2xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-center text-xs text-slate-500 dark:text-neutral-400">
                لا توجد مهام أو عناصر توزيع مضافة لهذا الإيفنت.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {report.itemStats.map((item, idx) => {
                  const barColor = ITEM_BAR_COLORS[idx % ITEM_BAR_COLORS.length];
                  return (
                    <div
                      key={item.itemId}
                      className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 space-y-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                            {item.itemName}
                          </div>
                          {item.prerequisiteName && (
                            <div className="text-[11px] font-semibold text-amber-700 dark:text-amber-400 mt-0.5">
                              يشترط استلام: {item.prerequisiteName}
                            </div>
                          )}
                        </div>
                        <span className="text-lg font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                          {item.percentage}%
                        </span>
                      </div>

                      {/* Progress bar */}
                      <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-neutral-800 overflow-hidden">
                        <div
                          className={`print-bar-fill h-full rounded-full ${barColor}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>

                      <div className="grid grid-cols-4 gap-2 pt-1 text-center">
                        <div className="rounded-xl bg-slate-50 dark:bg-neutral-900 px-2 py-1.5">
                          <div className="text-[10px] font-semibold text-slate-500 dark:text-neutral-400">
                            المسلَّم
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                            {item.delivered.toLocaleString('en-US')}
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-neutral-900 px-2 py-1.5">
                          <div className="text-[10px] font-semibold text-slate-500 dark:text-neutral-400">
                            الإجمالي
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white font-mono-num">
                            {item.total.toLocaleString('en-US')}
                          </div>
                        </div>
                        <div className="rounded-xl bg-slate-50 dark:bg-neutral-900 px-2 py-1.5">
                          <div className="text-[10px] font-semibold text-slate-500 dark:text-neutral-400">
                            المتبقي
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-slate-700 dark:text-neutral-300 font-mono-num">
                            {item.remaining.toLocaleString('en-US')}
                          </div>
                        </div>
                        <div className="rounded-xl bg-emerald-50/70 dark:bg-emerald-950/40 px-2 py-1.5">
                          <div className="text-[10px] font-semibold text-emerald-800 dark:text-emerald-300">
                            جاهز للاستلام
                          </div>
                          <div className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                            {item.readyToReceiveCount.toLocaleString('en-US')}
                          </div>
                        </div>
                      </div>

                      {!isAllDays && (
                        <div className="text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num">
                          عمليات اليوم لهذا العنصر: {item.dayDeliveredCount.toLocaleString('en-US')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 3: Per-Organizer / Booth Performance */}
          <section className="print-section space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span>3. أداء المنظمين والبوثات</span>
              </h3>
              <span className="text-[11px] text-slate-500 dark:text-neutral-400">
                متوسط الوقت يحسب بين العمليات المتتالية مع استبعاد الاستراحات (&gt; 30 دقيقة)
              </span>
            </div>

            {report.organizerStats.length === 0 ? (
              <div className="print-card rounded-2xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-center text-xs text-slate-500 dark:text-neutral-400">
                لا يوجد نشاط للمنظمين في الفترة المحددة.
              </div>
            ) : (
              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs sm:text-sm">
                    <thead className="bg-slate-50 dark:bg-neutral-900 border-b border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300">
                      <tr>
                        <th className="py-3 px-4 font-bold">المنظم / البوث</th>
                        <th className="py-3 px-3 font-bold">التسليمات</th>
                        <th className="py-3 px-3 font-bold">العناصر</th>
                        <th className="py-3 px-3 font-bold">أول عملية</th>
                        <th className="py-3 px-3 font-bold">آخر عملية</th>
                        <th className="py-3 px-3 font-bold">متوسط السرعة</th>
                        <th className="py-3 px-3 font-bold">أكثر ساعة نشاطاً</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                      {report.organizerStats.map((org) => (
                        <tr key={org.organizerId} className="hover:bg-slate-50/60 dark:hover:bg-neutral-900/40">
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">
                              {org.organizerName}
                            </div>
                            {org.boothName && (
                              <div className="text-[11px] text-slate-500 dark:text-neutral-400">
                                {org.boothName}
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-3 font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                            {org.deliveriesCount.toLocaleString('en-US')}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex flex-wrap gap-1.5">
                              {org.itemsBreakdown.map((ib) => (
                                <span
                                  key={ib.itemId}
                                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-900 px-2 py-0.5 text-[11px] font-semibold"
                                >
                                  <span>{ib.itemName}:</span>
                                  <span className="font-mono-num font-bold">{ib.count}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono-num text-slate-700 dark:text-neutral-300">
                            {formatCairoTime(org.firstActionAt)}
                          </td>
                          <td className="py-3 px-3 font-mono-num text-slate-700 dark:text-neutral-300">
                            {formatCairoTime(org.lastActionAt)}
                          </td>
                          <td className="py-3 px-3 font-mono-num text-slate-700 dark:text-neutral-300">
                            {formatArabicDurationSeconds(org.avgSecondsBetweenDeliveries)}
                          </td>
                          <td className="py-3 px-3 font-ascii-mono text-slate-700 dark:text-neutral-300" dir="ltr">
                            {org.peakHour ? (
                              <span>
                                {formatCairoHourRange(org.peakHour.hour)} ({org.peakHour.count})
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 4: Hourly Stacked Bar Chart (Pure CSS, Zero Libraries) */}
          <section className="print-section space-y-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>4. التوزيع بالساعة (مقسّم حسب العنصر)</span>
            </h3>

            {report.hourlyBuckets.length === 0 ? (
              <div className="print-card rounded-2xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-center text-xs text-slate-500 dark:text-neutral-400">
                لا توجد تسليمات لعرض الرسم البياني بالساعة.
              </div>
            ) : (
              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4">
                {/* Legend */}
                <div className="flex flex-wrap items-center gap-3">
                  {event.deliverableItems.map((item, idx) => (
                    <div key={item.id} className="inline-flex items-center gap-1.5 text-xs font-semibold">
                      <span
                        className={`print-bar-fill w-3 h-3 rounded-sm inline-block border border-slate-400/40 ${
                          ITEM_DOT_COLORS[idx % ITEM_DOT_COLORS.length]
                        }`}
                      />
                      <span className="text-slate-700 dark:text-neutral-200">{item.name}</span>
                    </div>
                  ))}
                </div>

                {/* Stacked Vertical Bars */}
                <div className="overflow-x-auto pb-2">
                  <div className="flex items-end gap-2 sm:gap-3 min-w-max h-52 pt-6 px-2 border-b border-slate-200 dark:border-neutral-800">
                    {report.hourlyBuckets.map((bucket) => {
                      const heightPercent =
                        report.maxHourlyCount > 0
                          ? Math.round((bucket.total / report.maxHourlyCount) * 100)
                          : 0;

                      return (
                        <div
                          key={bucket.hour}
                          className="flex flex-col items-center justify-end h-full min-w-[42px] sm:min-w-[50px]"
                          title={`${bucket.label}: ${bucket.total} عملية`}
                        >
                          <span className="text-[11px] font-bold text-slate-700 dark:text-neutral-200 font-mono-num mb-1">
                            {bucket.total}
                          </span>
                          <div
                            className="w-7 sm:w-8 rounded-t-lg overflow-hidden flex flex-col-reverse bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800"
                            style={{
                              height: bucket.total > 0 ? `${Math.max(8, heightPercent)}%` : '3px',
                            }}
                          >
                            {bucket.segments.map((seg) => {
                              const segPercent =
                                bucket.total > 0 ? (seg.count / bucket.total) * 100 : 0;
                              const segColor =
                                ITEM_BAR_COLORS[seg.colorIndex % ITEM_BAR_COLORS.length];
                              return (
                                <div
                                  key={seg.itemId}
                                  className={`print-bar-fill w-full ${segColor} border-t border-white/30 dark:border-black/30`}
                                  style={{ height: `${segPercent}%` }}
                                  title={`${seg.itemName}: ${seg.count}`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Hour Labels Row */}
                  <div className="flex items-center gap-2 sm:gap-3 min-w-max px-2 pt-2">
                    {report.hourlyBuckets.map((bucket) => (
                      <div
                        key={bucket.hour}
                        dir="ltr"
                        className="min-w-[42px] sm:min-w-[50px] text-center text-[11px] font-bold font-ascii-mono text-slate-500 dark:text-neutral-400"
                      >
                        {String(bucket.hour).padStart(2, '0')}:00
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* SECTION 5: Not-Yet-Received Participants */}
          <section className="print-break-before space-y-4">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>5. المتسابقون الذين لم يستلموا بعد</span>
            </h3>

            {report.pendingByItem.length === 0 ? (
              <div className="print-card rounded-2xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-center text-xs text-slate-500 dark:text-neutral-400">
                لا توجد مهام لعرض المتسابقين المتبقين.
              </div>
            ) : (
              <div className="space-y-4">
                {report.pendingByItem.map((group) => {
                  const query = (searchByItem[group.itemId] ?? '').trim().toLowerCase();
                  const showAll = Boolean(showAllByItem[group.itemId]);

                  const filtered = query
                    ? group.participants.filter(
                        (p) =>
                          p.name.toLowerCase().includes(query) ||
                          p.barcode.toLowerCase().includes(query) ||
                          p.extra.toLowerCase().includes(query)
                      )
                    : group.participants;

                  const visibleParticipants = showAll ? filtered : filtered.slice(0, 50);
                  const hasMoreThan50 = filtered.length > 50;

                  return (
                    <div
                      key={group.itemId}
                      className="print-section print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                            {group.itemName}
                          </h4>
                          <span className="rounded-lg bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 px-2.5 py-0.5 text-xs font-bold font-mono-num text-slate-700 dark:text-neutral-200">
                            المتبقي: {group.pendingCount.toLocaleString('en-US')}
                          </span>
                          <span className="rounded-lg bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-900 px-2.5 py-0.5 text-xs font-bold font-mono-num text-emerald-700 dark:text-emerald-400">
                            جاهز للاستلام: {group.readyCount.toLocaleString('en-US')}
                          </span>
                        </div>

                        {group.pendingCount > 0 && (
                          <div className="no-print relative w-full sm:w-64">
                            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              type="text"
                              value={searchByItem[group.itemId] ?? ''}
                              onChange={(e) =>
                                setSearchByItem((prev) => ({
                                  ...prev,
                                  [group.itemId]: e.target.value,
                                }))
                              }
                              placeholder="ابحث بالاسم أو الباركود..."
                              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-9 pl-3 py-1.5 text-xs text-slate-900 dark:text-white min-h-[38px]"
                            />
                          </div>
                        )}
                      </div>

                      {group.pendingCount === 0 ? (
                        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                          <CheckCircle2 className="w-4 h-4" />
                          <span>تم استلام هذا العنصر بالكامل من جميع المتسابقين.</span>
                        </div>
                      ) : filtered.length === 0 ? (
                        <div className="text-xs text-slate-500 dark:text-neutral-400 py-2">
                          لا توجد نتائج مطابقة للبحث.
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {visibleParticipants.map((p) => (
                              <div
                                key={p.barcode}
                                className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50/70 dark:bg-neutral-900/60 px-3 py-2 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                    {p.name}
                                  </div>
                                  <div className="text-[11px] text-slate-500 dark:text-neutral-400 truncate font-ascii-mono" dir="ltr">
                                    {p.barcode}
                                    {p.extra ? ` · ${p.extra}` : ''}
                                  </div>
                                </div>
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                                    p.isReady
                                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                      : 'bg-slate-200 dark:bg-neutral-800 text-slate-600 dark:text-neutral-400'
                                  }`}
                                >
                                  {p.isReady ? 'جاهز' : 'بانتظار السابق'}
                                </span>
                              </div>
                            ))}
                          </div>

                          {hasMoreThan50 && (
                            <div className="no-print pt-1 flex items-center justify-between gap-2">
                              <span className="text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num">
                                عرض {visibleParticipants.length.toLocaleString('en-US')} من{' '}
                                {filtered.length.toLocaleString('en-US')}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setShowAllByItem((prev) => ({
                                    ...prev,
                                    [group.itemId]: !showAll,
                                  }))
                                }
                                className="rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-900 hover:bg-slate-100 dark:hover:bg-neutral-800 px-3.5 py-1.5 text-xs font-bold text-slate-700 dark:text-neutral-200 min-h-[36px]"
                              >
                                {showAll
                                  ? 'عرض أول 50 فقط'
                                  : `عرض الكل (${filtered.length.toLocaleString('en-US')})`}
                              </button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 6: Audit & Offline / Conflicts Summary */}
          <section className="print-section space-y-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>6. التدقيق والمراجعة</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                    عمليات إلغاء التسليم
                  </div>
                  <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white font-mono-num">
                    {report.audit.undoneCount.toLocaleString('en-US')}
                  </div>
                </div>
                <RotateCcw className="w-6 h-6 text-slate-400 dark:text-neutral-500 shrink-0" />
              </div>

              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                    تسليمات أوفلاين
                  </div>
                  <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white font-mono-num">
                    {report.audit.offlineDeliveriesCount.toLocaleString('en-US')}
                  </div>
                </div>
                <WifiOff className="w-6 h-6 text-amber-500 shrink-0" />
              </div>

              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                    التعارضات المفتوحة (على الإيفنت)
                  </div>
                  <div
                    className={`mt-1 text-2xl font-bold font-mono-num ${
                      report.audit.openConflictsCount > 0
                        ? 'text-amber-600 dark:text-amber-400'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }`}
                  >
                    {report.audit.openConflictsCount.toLocaleString('en-US')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={onOpenConflictsTab}
                  className="no-print rounded-xl border border-amber-500/60 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-950/70 px-3 py-2 text-xs font-bold min-h-[38px] shrink-0"
                >
                  فتح التعارضات
                </button>
              </div>
            </div>

            {report.audit.undoneEntries.length > 0 && (
              <div className="print-card rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900 text-xs font-bold text-slate-700 dark:text-neutral-200">
                  تفاصيل عمليات الإلغاء ({report.audit.undoneEntries.length.toLocaleString('en-US')})
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-right text-xs">
                    <thead className="border-b border-slate-100 dark:border-neutral-800 text-slate-500 dark:text-neutral-400">
                      <tr>
                        <th className="py-2.5 px-4 font-bold">المتسابق</th>
                        <th className="py-2.5 px-3 font-bold">الباركود</th>
                        <th className="py-2.5 px-3 font-bold">العنصر</th>
                        <th className="py-2.5 px-3 font-bold">المنفّذ</th>
                        <th className="py-2.5 px-3 font-bold">الوقت</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                      {report.audit.undoneEntries.map((u) => (
                        <tr key={u.logId}>
                          <td className="py-2.5 px-4 font-bold text-slate-900 dark:text-white">
                            {u.participantName}
                          </td>
                          <td className="py-2.5 px-3 font-ascii-mono text-slate-600 dark:text-neutral-300" dir="ltr">
                            {u.barcode}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 dark:text-neutral-200">
                            {u.itemName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 dark:text-neutral-300">
                            {u.organizerName}
                          </td>
                          <td className="py-2.5 px-3 font-mono-num text-slate-600 dark:text-neutral-400">
                            {formatCairoTime(u.timestamp)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
};
