'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  BarChart3,
  Check,
  CheckCircle2,
  Copy,
  Download,
  Package,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Users,
  WifiOff,
} from 'lucide-react';
import { extractParticipantDisplayName } from '@/lib/marathon-logic';
import { buildGeneralReport, buildWhatsAppGeneralReportSummary } from '@/lib/report-logic';
import { formatDeliveryTime12hEn } from '@/lib/sheets-sync';
import type { ActivityLog, MarathonEvent, Organizer, Participant } from '@/lib/types';

interface EventDayReportTabProps {
  event: MarathonEvent;
  participants: Participant[];
  organizers: Organizer[];
  logs: ActivityLog[];
  loaded: boolean;
  loading: boolean;
  error: string | null;
  onRefresh: () => Promise<void>;
}

const ITEM_BAR_COLORS = [
  'bg-emerald-600 dark:bg-emerald-500',
  'bg-sky-600 dark:bg-sky-500',
  'bg-amber-500 dark:bg-amber-400',
  'bg-violet-600 dark:bg-violet-500',
  'bg-rose-600 dark:bg-rose-500',
  'bg-teal-600 dark:bg-teal-500',
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
  loaded,
  loading,
  error,
  onRefresh,
}) => {
  const [searchByItem, setSearchByItem] = useState<Record<string, string>>({});
  const [showAllByItem, setShowAllByItem] = useState<Record<string, boolean>>({});
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const report = useMemo(
    () =>
      buildGeneralReport({
        event,
        participants,
        logs,
      }),
    [event, participants, logs]
  );

  const boothByOrgId = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizers) {
      if (org.boothName) map.set(org.id, org.boothName);
    }
    return map;
  }, [organizers]);

  const handleCopyWhatsApp = async () => {
    const summaryText = buildWhatsAppGeneralReportSummary(report, event);
    const ok = await copyTextWithFallback(summaryText);
    setCopyStatus(ok ? 'copied' : 'error');
    window.setTimeout(() => {
      setCopyStatus('idle');
    }, 2600);
  };

  const handleDownloadReportExcel = () => {
    const workbook = XLSX.utils.book_new();

    // Sheet 1: Per-item completion stats
    const statsHeaders = [
      'العنصر / المهمة',
      'المسلَّم',
      'الإجمالي المؤهل',
      'المتبقي',
      'نسبة الإنجاز (%)',
      'جاهز للاستلام',
      'الشرط المسبق',
    ];
    const statsRows = report.itemStats.map((item) => [
      item.itemName,
      item.delivered,
      item.total,
      item.remaining,
      item.percentage,
      item.readyToReceiveCount,
      item.prerequisiteName ?? '',
    ]);
    const statsSheet = XLSX.utils.aoa_to_sheet([statsHeaders, ...statsRows]);
    XLSX.utils.book_append_sheet(workbook, statsSheet, 'إنجاز العناصر');

    // Sheet 2: Full participants delivery matrix with 12h English digits + seconds
    const dynamicKeys =
      event.displayFields.length > 0
        ? event.displayFields
        : Object.keys(participants[0]?.dynamicData ?? {});
    const itemHeaders = event.deliverableItems.flatMap((item) => [
      `${item.name} - الحالة`,
      `${item.name} - وقت التسليم`,
      `${item.name} - المنظم`,
    ]);
    const participantsHeaders = ['الباركود', 'الاسم', ...dynamicKeys, ...itemHeaders];
    const participantsRows = participants.map((p) => {
      const name = extractParticipantDisplayName(p, event.displayFields, event.nameField);
      const base = [p.barcode, name, ...dynamicKeys.map((k) => p.dynamicData[k] ?? '')];
      const delivs = event.deliverableItems.flatMap((item) => {
        const rec = p.deliveries?.[item.id];
        if (!rec || rec.status !== 'delivered') {
          return ['لم يستلم', '', ''];
        }
        const booth = boothByOrgId.get(rec.deliveredByOrganizerId);
        const orgLabel = booth
          ? `${rec.deliveredByOrganizerName} (${booth})`
          : rec.deliveredByOrganizerName;
        return ['تم التسليم', formatDeliveryTime12hEn(rec.deliveredAt), orgLabel];
      });
      return [...base, ...delivs];
    });
    const participantsSheet = XLSX.utils.aoa_to_sheet([participantsHeaders, ...participantsRows]);
    XLSX.utils.book_append_sheet(workbook, participantsSheet, 'سجل التسليم');

    // Sheet 3: Not yet received per item
    const pendingHeaders = ['العنصر', 'الباركود', 'الاسم', 'بيانات إضافية', 'حالة الاستلام'];
    const pendingRows = report.pendingByItem.flatMap((group) =>
      group.participants.map((p) => [
        group.itemName,
        p.barcode,
        p.name,
        p.extra,
        p.isReady ? 'جاهز للاستلام' : 'بانتظار السابق',
      ])
    );
    const pendingSheet = XLSX.utils.aoa_to_sheet([pendingHeaders, ...pendingRows]);
    XLSX.utils.book_append_sheet(workbook, pendingSheet, 'لم يستلموا بعد');

    // Sheet 4: Undone audit logs (if any)
    if (report.audit.undoneEntries.length > 0) {
      const undoneHeaders = ['المتسابق', 'الباركود', 'العنصر', 'المنفّذ', 'وقت الإلغاء'];
      const undoneRows = report.audit.undoneEntries.map((u) => [
        u.participantName,
        u.barcode,
        u.itemName,
        u.organizerName,
        formatDeliveryTime12hEn(u.timestamp),
      ]);
      const undoneSheet = XLSX.utils.aoa_to_sheet([undoneHeaders, ...undoneRows]);
      XLSX.utils.book_append_sheet(workbook, undoneSheet, 'سجل الإلغاء');
    }

    XLSX.writeFile(workbook, `${event.name}-general-report.xlsx`);
  };

  return (
    <div className="space-y-6">
      {/* Header & Action Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            <span>التقرير العام للإيفنت</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5 font-mono-num">
            إجمالي المتسابقين: {report.totalParticipants.toLocaleString('en-US')} · جميع التسليمات المسجلة على الإيفنت
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
            data-testid="download-report-excel-btn"
            onClick={handleDownloadReportExcel}
            disabled={participants.length === 0 && event.deliverableItems.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold min-h-[42px] disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            <span>تحميل التقرير Excel</span>
          </button>
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
            className="rounded-xl border border-red-300 dark:border-red-800 px-3 py-1.5 text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 shrink-0"
          >
            إعادة المحاولة
          </button>
        </div>
      )}

      {/* Initial Loading Skeleton */}
      {loading && !loaded ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="h-32 rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <>
          {/* SECTION 1: Per-Item Completion */}
          <section className="space-y-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>إنجاز المهام والعناصر</span>
            </h3>

            {report.itemStats.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-center text-xs text-slate-500 dark:text-neutral-400">
                لا توجد مهام أو عناصر توزيع مضافة لهذا الإيفنت.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {report.itemStats.map((item, idx) => {
                  const barColor = ITEM_BAR_COLORS[idx % ITEM_BAR_COLORS.length];
                  return (
                    <div
                      key={item.itemId}
                      className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 space-y-3"
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

                      <div className="w-full h-2.5 rounded-full bg-slate-100 dark:bg-neutral-800 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${barColor}`}
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
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* SECTION 2: Not-Yet-Received Participants */}
          <section className="space-y-4">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>المتسابقون الذين لم يستلموا بعد</span>
            </h3>

            {report.pendingByItem.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-center text-xs text-slate-500 dark:text-neutral-400">
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
                      className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 space-y-3"
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
                          <div className="relative w-full sm:w-64">
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
                                  <div
                                    className="text-[11px] text-slate-500 dark:text-neutral-400 truncate font-ascii-mono"
                                    dir="ltr"
                                  >
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
                            <div className="pt-1 flex items-center justify-between gap-2">
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

          {/* SECTION 3: Audit (Undone & Offline count — without conflicts) */}
          <section className="space-y-3">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>التدقيق وسجل الإلغاء</span>
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
              <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 flex items-center justify-between gap-3">
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

              <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                    تسليمات تمت أوفلاين
                  </div>
                  <div className="mt-1 text-2xl font-bold text-slate-900 dark:text-white font-mono-num">
                    {report.audit.offlineDeliveriesCount.toLocaleString('en-US')}
                  </div>
                </div>
                <WifiOff className="w-6 h-6 text-amber-500 shrink-0" />
              </div>
            </div>

            {report.audit.undoneEntries.length > 0 && (
              <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 overflow-hidden">
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
                          <td
                            className="py-2.5 px-3 font-ascii-mono text-slate-600 dark:text-neutral-300"
                            dir="ltr"
                          >
                            {u.barcode}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 dark:text-neutral-200">
                            {u.itemName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-700 dark:text-neutral-300">
                            {u.organizerName}
                          </td>
                          <td
                            className="py-2.5 px-3 font-ascii-mono text-slate-600 dark:text-neutral-400"
                            dir="ltr"
                          >
                            {formatDeliveryTime12hEn(u.timestamp)}
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
