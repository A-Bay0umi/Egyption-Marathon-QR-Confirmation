'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Activity,
  CheckCircle2,
  Clock,
  Download,
  RotateCcw,
  Search,
} from 'lucide-react';
import { commitAdminUndo } from '@/lib/firestore-store';
import {
  computeEventStats,
  extractParticipantDisplayName,
  formatArabicTime,
  formatRelativeArabicTime,
  matchesSearchQuery,
} from '@/lib/marathon-logic';
import type { ActivityLog, DeliverableItem, MarathonEvent, Participant } from '@/lib/types';

interface EventTasksMonitorTabProps {
  event: MarathonEvent;
  participants: Participant[];
  logs: ActivityLog[];
}

export const EventTasksMonitorTab: React.FC<EventTasksMonitorTabProps> = ({
  event,
  participants,
  logs,
}) => {
  const [selectedTaskId, setSelectedTaskId] = useState<string>(
    event.deliverableItems[0]?.id ?? ''
  );
  const [statusFilter, setStatusFilter] = useState<'all' | 'delivered' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [undoingKey, setUndoingKey] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  const activeTaskId = useMemo(() => {
    if (event.deliverableItems.some((item) => item.id === selectedTaskId)) {
      return selectedTaskId;
    }
    return event.deliverableItems[0]?.id ?? '';
  }, [event.deliverableItems, selectedTaskId]);

  const activeTask: DeliverableItem | undefined = useMemo(
    () => event.deliverableItems.find((item) => item.id === activeTaskId),
    [event.deliverableItems, activeTaskId]
  );

  const stats = useMemo(
    () => computeEventStats(participants, event.deliverableItems),
    [participants, event.deliverableItems]
  );

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim();
    return participants.filter((p) => {
      if (q && !matchesSearchQuery(p, q)) return false;
      if (!activeTask) return true;
      const isDelivered = p.deliveries?.[activeTask.id]?.status === 'delivered';
      if (statusFilter === 'delivered') return isDelivered;
      if (statusFilter === 'pending') return !isDelivered;
      return true;
    });
  }, [participants, searchQuery, activeTask, statusFilter]);

  const handleUndo = async (participant: Participant, item: DeliverableItem) => {
    const key = `${participant.barcode}-${item.id}`;
    setUndoingKey(key);
    try {
      await commitAdminUndo({
        eventId: event.id,
        participant,
        item,
        adminName: 'مدير السباق',
        displayFields: event.displayFields,
      });
    } finally {
      setUndoingKey(null);
    }
  };

  const handleExportExcel = () => {
    const dynamicKeys =
      event.displayFields.length > 0
        ? event.displayFields
        : Object.keys(participants[0]?.dynamicData ?? {});

    const itemHeaders = event.deliverableItems.flatMap((item) => [
      `${item.name} (الحالة)`,
      `${item.name} (المنظم)`,
      `${item.name} (الوقت)`,
    ]);

    const headers = ['الباركود', ...dynamicKeys, ...itemHeaders];
    const rows = participants.map((p) => {
      const base = [p.barcode, ...dynamicKeys.map((k) => p.dynamicData[k] ?? '')];
      const delivs = event.deliverableItems.flatMap((item) => {
        const d = p.deliveries?.[item.id];
        if (!d) return ['لم يستلم', '', ''];
        return ['تم التسليم', d.deliveredByOrganizerName, formatArabicTime(d.deliveredAt)];
      });
      return [...base, ...delivs];
    });

    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'سجل التسليم');
    XLSX.writeFile(workbook, `${event.name}-report.xlsx`);
  };

  if (event.deliverableItems.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 text-center">
        <p className="text-sm font-bold text-slate-800 dark:text-white">
          لم تقم بإضافة أي مهام توزيع لهذا الإيفنت بعد
        </p>
        <p className="mt-1.5 text-xs text-slate-500 dark:text-neutral-400">
          انتقل إلى تبويب &quot;إعدادات المهام والمنظمين&quot; لإضافة المهام (مثل التيشيرت، رقم الصدر، الشنطة...)
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Tasks Grid Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            مهام التسليم في الإيفنت
          </h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            اضغط على أي مهمة لمتابعة من استلم ومن لم يستلم وإلغاء التسليم عند الحاجة
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowLogs((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 hover:bg-slate-50 dark:hover:bg-neutral-900 min-h-[44px]"
          >
            <Activity className="w-4 h-4 text-emerald-600" />
            <span>السجل المباشر ({logs.length})</span>
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            disabled={participants.length === 0}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-4 py-2 text-xs font-bold min-h-[44px] disabled:opacity-40"
          >
            <Download className="w-4 h-4" />
            <span>تصدير Excel</span>
          </button>
        </div>
      </div>

      {/* Interactive Task Selector Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((st) => {
          const isSelected = st.itemId === activeTaskId;
          const remaining = Math.max(0, st.total - st.delivered);
          return (
            <button
              key={st.itemId}
              type="button"
              onClick={() => setSelectedTaskId(st.itemId)}
              className={`text-right rounded-2xl border p-4 transition-all min-h-[96px] ${
                isSelected
                  ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/40 ring-1 ring-emerald-600'
                  : 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 hover:border-slate-300 dark:hover:border-neutral-700'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-900 dark:text-white truncate">
                  {st.itemName}
                </span>
                <span className="text-xs font-bold font-mono-num text-emerald-700 dark:text-emerald-400 shrink-0">
                  {st.delivered} / {st.total}
                </span>
              </div>

              <div className="mt-3 w-full h-2 rounded-full bg-slate-200 dark:bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${st.percentage}%` }}
                />
              </div>

              <div className="mt-2 flex items-center justify-between text-xs text-slate-500 dark:text-neutral-400 font-mono-num">
                <span>{st.percentage}% مكتمل</span>
                <span>متبقي {remaining}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Collapsible Live Activity Log */}
      {showLogs && (
        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
          <div className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-2.5">
            آخر عمليات التسليم والتراجع
          </div>
          {logs.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              لا توجد حركات مسجلة حتى الآن.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-neutral-800">
              {logs.map((log) => (
                <div
                  key={log.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="text-slate-800 dark:text-neutral-200">
                    <span className="font-bold">
                      {log.action === 'delivered' ? 'تم تسليم' : 'تم إلغاء تسليم'} {log.itemName}
                    </span>{' '}
                    · {log.participantName} · بواسطة {log.organizerName}
                  </div>
                  <span className="text-slate-400 font-mono-num">
                    {formatRelativeArabicTime(log.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Selected Task Delivery List */}
      {activeTask && (
        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                متابعة مهمة: {activeTask.name}
              </h3>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5 font-mono-num">
                إجمالي النتائج: {filteredParticipants.length} متسابق
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
              {/* Segmented Filter */}
              <div className="inline-flex rounded-xl bg-slate-100 dark:bg-neutral-900 p-1 border border-slate-200 dark:border-neutral-800">
                {(
                  [
                    { id: 'all', label: 'الكل' },
                    { id: 'delivered', label: 'تم التسليم' },
                    { id: 'pending', label: 'لم يستلم' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setStatusFilter(opt.id)}
                    className={`flex-1 sm:flex-initial px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition-colors min-h-[36px] ${
                      statusFilter === opt.id
                        ? 'bg-white dark:bg-black text-emerald-700 dark:text-emerald-400 shadow-sm'
                        : 'text-slate-600 dark:text-neutral-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="relative sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="بحث بالاسم أو الباركود..."
                  className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-10 pl-3 py-2 text-sm text-slate-900 dark:text-white min-h-[44px]"
                />
              </div>
            </div>
          </div>

          {participants.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-neutral-800 p-8 text-center text-sm text-slate-500 dark:text-neutral-400">
              لا يوجد متسابقون في هذا الإيفنت بعد. أضف متسابقين أو ارفع شيت من تبويب &quot;الأشخاص&quot;.
            </div>
          ) : filteredParticipants.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-neutral-800 p-8 text-center text-sm text-slate-500 dark:text-neutral-400">
              لا توجد نتائج مطابقة للبحث أو الفلتر الحالي.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-neutral-800 border border-slate-200 dark:border-neutral-800 rounded-xl overflow-hidden">
              {filteredParticipants.slice(0, 150).map((p) => {
                const name = extractParticipantDisplayName(p, event.displayFields);
                const delivery = p.deliveries?.[activeTask.id];
                const isDelivered = delivery?.status === 'delivered';
                const extraSummary = event.displayFields
                  .filter((f) => p.dynamicData[f] && p.dynamicData[f] !== name)
                  .slice(0, 3)
                  .map((f) => `${f}: ${p.dynamicData[f]}`)
                  .join(' · ');

                return (
                  <div
                    key={p.barcode}
                    className="p-3.5 sm:px-4 bg-white dark:bg-neutral-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold text-slate-900 dark:text-white">
                          {name}
                        </span>
                        <span
                          dir="ltr"
                          className="text-xs font-ascii-mono text-slate-500 dark:text-neutral-400"
                        >
                          {p.barcode}
                        </span>
                      </div>
                      {extraSummary && (
                        <div className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5 truncate">
                          {extraSummary}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-2.5 shrink-0">
                      {isDelivered ? (
                        <>
                          <div className="text-right sm:text-left">
                            <div className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="w-4 h-4" />
                              <span>تم التسليم</span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num">
                              {delivery.deliveredByOrganizerName} ·{' '}
                              {formatArabicTime(delivery.deliveredAt)}
                            </div>
                          </div>
                          <button
                            type="button"
                            disabled={undoingKey === `${p.barcode}-${activeTask.id}`}
                            data-testid={`admin-undo-${p.barcode}-${activeTask.id}`}
                            onClick={() => void handleUndo(p, activeTask)}
                            className="inline-flex items-center gap-1 rounded-xl bg-red-600 hover:bg-red-700 text-white px-3 py-2 text-xs font-bold min-h-[40px] whitespace-nowrap disabled:opacity-50"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>إلغاء التسليم</span>
                          </button>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 dark:text-neutral-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>لم يستلم بعد</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
