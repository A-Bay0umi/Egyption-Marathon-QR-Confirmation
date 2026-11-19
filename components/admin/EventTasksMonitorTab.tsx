'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Activity,
  ArrowRight,
  Award,
  CheckCircle2,
  ChevronLeft,
  ClipboardCheck,
  Clock,
  CupSoda,
  Download,
  Eye,
  EyeOff,
  Hash,
  Link2,
  Lock,
  PackageCheck,
  RotateCcw,
  Search,
  ShieldAlert,
  Shirt,
  ShoppingBag,
  Timer,
  X,
} from 'lucide-react';
import { verifyAdminPasscode } from '@/lib/admin-auth';
import { commitAdminUndo } from '@/lib/firestore-store';
import {
  computeEventStats,
  extractParticipantDisplayName,
  formatArabicTime,
  formatRelativeArabicTime,
  getPrerequisiteItem,
  isPrerequisiteMet,
  matchesSearchQuery,
} from '@/lib/marathon-logic';
import type { ActivityLog, DeliverableItem, MarathonEvent, Participant } from '@/lib/types';

interface EventTasksMonitorTabProps {
  event: MarathonEvent;
  participants: Participant[];
  logs: ActivityLog[];
}

function TaskIcon({ taskName, className }: { taskName: string; className?: string }) {
  const name = taskName.toLowerCase();
  if (/تيشيرت|تي شيرت|ملابس|قميص|shirt|tee|jersey|hoodie/.test(name)) {
    return <Shirt className={className} />;
  }
  if (/ميدال|جائز|كأس|medal|award|trophy/.test(name)) {
    return <Award className={className} />;
  }
  if (/تسجيل|تأكيد|حضور|دخول|check|reg|entry/.test(name)) {
    return <ClipboardCheck className={className} />;
  }
  if (/رقم|صدر|bib|number|tag/.test(name)) {
    return <Hash className={className} />;
  }
  if (/شنط|حقيب|كيس|باكت|bag|kit|pack/.test(name)) {
    return <ShoppingBag className={className} />;
  }
  if (/ماء|ميا|مشروب|عصير|زجاج|water|drink|fuel/.test(name)) {
    return <CupSoda className={className} />;
  }
  if (/شريح|توقيت|ساع|chip|timing/.test(name)) {
    return <Timer className={className} />;
  }
  return <PackageCheck className={className} />;
}

export const EventTasksMonitorTab: React.FC<EventTasksMonitorTabProps> = ({
  event,
  participants,
  logs,
}) => {
  const [drilledTaskId, setDrilledTaskId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'delivered' | 'pending'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [undoingKey, setUndoingKey] = useState<string | null>(null);
  const [showLogs, setShowLogs] = useState(false);

  // Passcode-gated undo confirmation modal
  const [pendingUndo, setPendingUndo] = useState<{
    participant: Participant;
    item: DeliverableItem;
  } | null>(null);
  const [undoPasscode, setUndoPasscode] = useState('');
  const [showUndoPasscode, setShowUndoPasscode] = useState(false);
  const [undoPasscodeError, setUndoPasscodeError] = useState<string | null>(null);

  const activeTask: DeliverableItem | undefined = useMemo(
    () =>
      drilledTaskId
        ? event.deliverableItems.find((item) => item.id === drilledTaskId)
        : undefined,
    [event.deliverableItems, drilledTaskId]
  );

  const activePrereq = useMemo(
    () => (activeTask ? getPrerequisiteItem(activeTask, event.deliverableItems) : null),
    [activeTask, event.deliverableItems]
  );

  const stats = useMemo(
    () => computeEventStats(participants, event.deliverableItems),
    [participants, event.deliverableItems]
  );

  const activeTaskStat = useMemo(
    () => (activeTask ? stats.find((s) => s.itemId === activeTask.id) ?? null : null),
    [stats, activeTask]
  );

  const activeTaskLogs = useMemo(() => {
    if (!activeTask) return logs;
    return logs.filter((l) => l.itemId === activeTask.id || l.itemName === activeTask.name);
  }, [activeTask, logs]);

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim();
    return participants.filter((p) => {
      if (q && !matchesSearchQuery(p, q)) return false;
      if (!activeTask) return true;
      const isDelivered = p.deliveries?.[activeTask.id]?.status === 'delivered';
      const prereqOk = isPrerequisiteMet(p, activeTask, event.deliverableItems);
      if (statusFilter === 'delivered') return isDelivered;
      if (statusFilter === 'ready') return !isDelivered && prereqOk;
      if (statusFilter === 'pending') return !isDelivered;
      return true;
    });
  }, [participants, searchQuery, activeTask, statusFilter, event.deliverableItems]);

  const handleOpenTask = (taskId: string) => {
    setDrilledTaskId(taskId);
    setStatusFilter('all');
    setSearchQuery('');
    setShowLogs(false);
  };

  const handleRequestUndo = (participant: Participant, item: DeliverableItem) => {
    setPendingUndo({ participant, item });
    setUndoPasscode('');
    setShowUndoPasscode(false);
    setUndoPasscodeError(null);
  };

  const handleConfirmUndoWithPasscode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingUndo) return;
    if (!verifyAdminPasscode(undoPasscode)) {
      setUndoPasscodeError('كلمة مرور الإدارة غير صحيحة');
      return;
    }

    const { participant, item } = pendingUndo;
    const key = `${participant.barcode}-${item.id}`;
    setUndoPasscodeError(null);
    setUndoingKey(key);
    try {
      await commitAdminUndo({
        eventId: event.id,
        participant,
        item,
        adminName: 'مدير السباق',
        displayFields: event.displayFields,
      });
      setPendingUndo(null);
      setUndoPasscode('');
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

  // LEVEL 1: Tasks Icons Overview Grid (Click any task icon to drill in)
  if (!activeTask) {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              أيقونات المهام ({event.deliverableItems.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
              اضغط على أي أيقونة للدخول إليها ومشاهدة تفاصيل التسليم أو إلغائها لهذه المهمة فقط
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

        {/* Task Icon Tiles with Progress Bars */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stats.map((st, idx) => {
            const remaining = Math.max(0, st.total - st.delivered);
            return (
              <button
                key={st.itemId}
                type="button"
                data-testid={`task-tile-${st.itemId}`}
                onClick={() => handleOpenTask(st.itemId)}
                className="group text-right rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 hover:border-emerald-600 dark:hover:border-emerald-500 hover:shadow-md transition-all flex flex-col justify-between gap-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <TaskIcon taskName={st.itemName} className="w-6 h-6 text-emerald-700 dark:text-emerald-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] font-bold text-slate-400 dark:text-neutral-500 font-mono-num">
                        مهمة #{idx + 1}
                      </div>
                      <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
                        {st.itemName}
                      </h3>
                    </div>
                  </div>

                  <span className="inline-flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-neutral-900 px-2.5 py-1.5 text-xs font-bold text-slate-700 dark:text-neutral-200 group-hover:bg-emerald-600 group-hover:text-white transition-colors shrink-0">
                    <span>دخول</span>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </span>
                </div>

                {st.prerequisiteName && (
                  <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 dark:text-emerald-300 bg-emerald-50/70 dark:bg-emerald-950/30 rounded-xl px-2.5 py-1.5 w-fit max-w-full">
                    <Link2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="truncate">
                      من أصل {st.total} أتموا &quot;{st.prerequisiteName}&quot;
                    </span>
                  </div>
                )}

                <div className="space-y-2 pt-1">
                  <div className="flex items-center justify-between text-xs font-mono-num">
                    <span className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">
                      {st.delivered} / {st.total}
                    </span>
                    <span className="font-bold text-slate-800 dark:text-neutral-200">
                      {st.percentage}%
                    </span>
                  </div>

                  <div
                    role="progressbar"
                    aria-valuenow={st.percentage}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`نسبة إنجاز ${st.itemName}`}
                    className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-neutral-800 overflow-hidden"
                  >
                    <div
                      className="h-full bg-emerald-600 rounded-full transition-all"
                      style={{ width: `${st.percentage}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num">
                    <span>تم التسليم: {st.delivered}</span>
                    <span>متبقي: {remaining}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // LEVEL 2: Inside the Selected Task (Only manages THIS specific task!)
  const deliveredCount = activeTaskStat?.delivered ?? 0;
  const totalEligible = activeTaskStat?.total ?? participants.length;
  const pct = activeTaskStat?.percentage ?? 0;

  return (
    <div className="space-y-4">
      {/* Back Bar & Task Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setDrilledTaskId(null)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-800 min-h-[42px] shrink-0"
            >
              <ArrowRight className="w-4 h-4" />
              <span>كل المهام</span>
            </button>

            <div className="w-11 h-11 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200/80 dark:border-emerald-800/70 flex items-center justify-center shrink-0">
              <TaskIcon taskName={activeTask.name} className="w-5 h-5 text-emerald-700 dark:text-emerald-400" />
            </div>

            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                {activeTask.name}
              </h2>
              {activePrereq ? (
                <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 truncate">
                  محسوب على من أتموا &quot;{activePrereq.name}&quot; ({totalEligible} متسابق)
                </div>
              ) : (
                <div className="text-xs text-slate-500 dark:text-neutral-400 font-mono-num">
                  إجمالي المتسابقين: {totalEligible}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowLogs((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 min-h-[40px]"
            >
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>سجل المهمة ({activeTaskLogs.length})</span>
            </button>
          </div>
        </div>

        {/* Dedicated Progress Bar for This Task */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs font-mono-num">
            <span className="font-bold text-emerald-700 dark:text-emerald-400">
              تم تسليم {deliveredCount} من {totalEligible}
            </span>
            <span className="font-bold text-slate-800 dark:text-neutral-200">{pct}% مكتمل</span>
          </div>
          <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-neutral-800 overflow-hidden">
            <div
              className="h-full bg-emerald-600 rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 dark:text-neutral-400">
            ملاحظة: الضغط على &quot;إلغاء التسليم&quot; هنا يلغي تسليم <strong>{activeTask.name}</strong> فقط دون المساس بباقي مهام المتسابق.
          </p>
        </div>
      </div>

      {/* Collapsible Task Activity Log */}
      {showLogs && (
        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4">
          <div className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-2.5">
            سجل حركات: {activeTask.name}
          </div>
          {activeTaskLogs.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              لا توجد حركات مسجلة لهذه المهمة حتى الآن.
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-neutral-800">
              {activeTaskLogs.map((log) => (
                <div
                  key={log.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="text-slate-800 dark:text-neutral-200">
                    <span className="font-bold">
                      {log.action === 'delivered' ? 'تم التسليم' : 'تم إلغاء التسليم'}
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
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="text-xs font-bold text-slate-600 dark:text-neutral-400 font-mono-num">
            النتائج المعروضة: {filteredParticipants.length} متسابق
          </div>

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
            {/* Segmented Filter */}
            <div className="inline-flex rounded-xl bg-slate-100 dark:bg-neutral-900 p-1 border border-slate-200 dark:border-neutral-800 overflow-x-auto">
              {(
                [
                  { id: 'all', label: 'الكل' },
                  ...(activePrereq ? [{ id: 'ready' as const, label: 'جاهز الآن' }] : []),
                  { id: 'delivered', label: 'تم التسليم' },
                  { id: 'pending', label: 'لم يستلم' },
                ] satisfies Array<{
                  id: 'all' | 'ready' | 'delivered' | 'pending';
                  label: string;
                }>
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
                          onClick={() => handleRequestUndo(p, activeTask)}
                          className="inline-flex items-center gap-1 rounded-xl bg-red-600 hover:bg-red-700 text-white px-3 py-2 text-xs font-bold min-h-[40px] whitespace-nowrap disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>إلغاء تسليم {activeTask.name}</span>
                        </button>
                      </>
                    ) : activePrereq && !isPrerequisiteMet(p, activeTask, event.deliverableItems) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-400">
                        <Lock className="w-3.5 h-3.5" />
                        <span>بانتظار &quot;{activePrereq.name}&quot;</span>
                      </span>
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

      {/* Passcode Verification Modal for Undo Delivery */}
      {pendingUndo && (
        <div
          data-testid="undo-passcode-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        >
          <div className="w-full max-w-md rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    تأكيد إلغاء التسليم
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-neutral-400">
                    يتطلب إدخال كلمة مرور الإدارة
                  </p>
                </div>
              </div>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => {
                  setPendingUndo(null);
                  setUndoPasscode('');
                  setUndoPasscodeError(null);
                }}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black p-3.5 text-xs sm:text-sm space-y-1">
              <div className="font-bold text-slate-900 dark:text-white">
                المهمة: {pendingUndo.item.name}
              </div>
              <div className="text-slate-600 dark:text-neutral-300">
                المتسابق:{' '}
                {extractParticipantDisplayName(pendingUndo.participant, event.displayFields)} (
                <span dir="ltr" className="font-ascii-mono">
                  {pendingUndo.participant.barcode}
                </span>
                )
              </div>
            </div>

            <form onSubmit={(e) => void handleConfirmUndoWithPasscode(e)} className="space-y-3">
              <div>
                <label
                  htmlFor="undo-admin-passcode"
                  className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
                >
                  كلمة مرور الإدارة
                </label>
                <div className="relative">
                  <input
                    id="undo-admin-passcode"
                    type={showUndoPasscode ? 'text' : 'password'}
                    dir="ltr"
                    autoFocus
                    required
                    value={undoPasscode}
                    onChange={(e) => {
                      setUndoPasscode(e.target.value);
                      setUndoPasscodeError(null);
                    }}
                    placeholder="••••••••••••"
                    className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pl-11 pr-3.5 py-2.5 text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[46px]"
                  />
                  <button
                    type="button"
                    aria-label={showUndoPasscode ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                    onClick={() => setShowUndoPasscode((prev) => !prev)}
                    className="absolute left-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                  >
                    {showUndoPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {undoPasscodeError && (
                <p role="alert" className="text-xs font-bold text-red-600 dark:text-red-400">
                  {undoPasscodeError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setPendingUndo(null);
                    setUndoPasscode('');
                    setUndoPasscodeError(null);
                  }}
                  className="rounded-xl border border-slate-300 dark:border-neutral-700 px-4 py-2.5 text-xs font-bold min-h-[44px]"
                >
                  تراجع
                </button>
                <button
                  type="submit"
                  data-testid="confirm-undo-passcode-btn"
                  disabled={
                    !undoPasscode.trim() ||
                    undoingKey === `${pendingUndo.participant.barcode}-${pendingUndo.item.id}`
                  }
                  className="rounded-xl bg-red-600 hover:bg-red-700 text-white px-5 py-2.5 text-xs font-bold min-h-[44px] disabled:opacity-50"
                >
                  {undoingKey === `${pendingUndo.participant.barcode}-${pendingUndo.item.id}`
                    ? 'جاري الإلغاء...'
                    : 'تأكيد إلغاء التسليم'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
