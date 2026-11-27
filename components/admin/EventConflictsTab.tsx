'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  RefreshCw,
  Smartphone,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { resolveDeliveryConflictDoc } from '@/lib/firestore-store';
import {
  detectDeliveryConflicts,
  extractParticipantDisplayName,
  formatArabicDateTime,
  formatArabicTime,
} from '@/lib/marathon-logic';
import type {
  ActivityLog,
  DeliveryConflict,
  DeliveryConflictResolution,
  MarathonEvent,
  Organizer,
  Participant,
} from '@/lib/types';

interface EventConflictsTabProps {
  event: MarathonEvent;
  participants: Participant[];
  organizers: Organizer[];
  logs: ActivityLog[];
  resolutions: Record<string, DeliveryConflictResolution>;
  loaded: boolean;
  loading: boolean;
  onRefresh: () => Promise<void>;
  onResolutionSaved: (resolution: DeliveryConflictResolution) => void;
}

export const EventConflictsTab: React.FC<EventConflictsTabProps> = ({
  event,
  participants,
  organizers,
  logs,
  resolutions,
  loaded,
  loading,
  onRefresh,
  onResolutionSaved,
}) => {
  const [filterMode, setFilterMode] = useState<'open' | 'all'>('open');
  const [notesByKey, setNotesByKey] = useState<Record<string, string>>({});
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const participantByBarcode = useMemo(() => {
    const map = new Map<string, Participant>();
    for (const p of participants) {
      map.set(p.barcode, p);
    }
    return map;
  }, [participants]);

  const conflicts = useMemo(
    () => detectDeliveryConflicts(logs, organizers),
    [logs, organizers]
  );

  const enrichedConflicts = useMemo(() => {
    return conflicts.map((conflict) => {
      const resolution = resolutions[conflict.conflictKey];
      const isResolved = Boolean(
        resolution &&
          resolution.status === 'resolved' &&
          conflict.deliveries.length <= resolution.resolvedLogCount
      );
      const reopenedAfterResolve = Boolean(
        resolution && conflict.deliveries.length > resolution.resolvedLogCount
      );
      return {
        conflict,
        resolution,
        isResolved,
        reopenedAfterResolve,
      };
    });
  }, [conflicts, resolutions]);

  const openCount = useMemo(
    () => enrichedConflicts.filter((c) => !c.isResolved).length,
    [enrichedConflicts]
  );

  const resolvedCount = enrichedConflicts.length - openCount;

  const visibleConflicts = useMemo(() => {
    if (filterMode === 'all') return enrichedConflicts;
    return enrichedConflicts.filter((c) => !c.isResolved);
  }, [enrichedConflicts, filterMode]);

  const handleMarkReviewed = async (conflict: DeliveryConflict) => {
    setResolvingKey(conflict.conflictKey);
    setActionError(null);
    try {
      const saved = await resolveDeliveryConflictDoc({
        eventId: event.id,
        barcode: conflict.barcode,
        itemId: conflict.itemId,
        resolvedLogCount: conflict.deliveries.length,
        note: notesByKey[conflict.conflictKey],
      });
      onResolutionSaved(saved);
    } catch {
      setActionError('تعذر حفظ حالة المراجعة على Firebase. يرجى المحاولة مرة أخرى.');
    } finally {
      setResolvingKey(null);
    }
  };

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      {/* Header & Controls */}
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-3 min-w-0 overflow-hidden">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span>كشف تعارضات التسليم الأوفلاين</span>
          </h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5 font-mono-num">
            {loaded
              ? `مفتوحة: ${openCount} · تمت مراجعتها: ${resolvedCount} · إجمالي السجلات المفحوصة: ${logs.length}`
              : 'جاري فحص سجل التسليمات...'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-xl bg-slate-100 dark:bg-neutral-900 p-1 border border-slate-200 dark:border-neutral-800">
            <button
              type="button"
              data-testid="conflicts-filter-open"
              onClick={() => setFilterMode('open')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors min-h-[36px] font-mono-num ${
                filterMode === 'open'
                  ? 'bg-white dark:bg-black text-emerald-700 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-neutral-400'
              }`}
            >
              المفتوحة ({openCount})
            </button>
            <button
              type="button"
              data-testid="conflicts-filter-all"
              onClick={() => setFilterMode('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors min-h-[36px] font-mono-num ${
                filterMode === 'all'
                  ? 'bg-white dark:bg-black text-emerald-700 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-600 dark:text-neutral-400'
              }`}
            >
              الكل ({enrichedConflicts.length})
            </button>
          </div>

          <button
            type="button"
            data-testid="refresh-conflicts-btn"
            disabled={loading}
            onClick={() => void onRefresh()}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold min-h-[42px] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{loading ? 'جاري التحديث...' : 'تحديث'}</span>
          </button>
        </div>
      </div>

      {actionError && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3.5 text-xs font-bold text-red-800 dark:text-red-200">
          {actionError}
        </div>
      )}

      {/* Conflicts List */}
      {loading && !loaded ? (
        <div className="space-y-3">
          {[1, 2].map((idx) => (
            <div
              key={idx}
              className="h-36 rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 animate-pulse"
            />
          ))}
        </div>
      ) : visibleConflicts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 text-center space-y-2">
          <CheckCircle2 className="w-10 h-10 text-emerald-600 dark:text-emerald-400 mx-auto" />
          <div className="text-sm font-bold text-slate-900 dark:text-white">
            {enrichedConflicts.length === 0
              ? 'لا توجد تعارضات تسليم في هذا الإيفنت'
              : 'لا توجد تعارضات مفتوحة — تمت مراجعة جميع الحالات'}
          </div>
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            اضغط &quot;تحديث&quot; لجلب أحدث التسليمات المتزامنة من أجهزة المنظمين.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visibleConflicts.map(({ conflict, resolution, isResolved, reopenedAfterResolve }) => {
            const participant = participantByBarcode.get(conflict.barcode);
            const displayName = participant
              ? extractParticipantDisplayName(participant, event.displayFields, event.nameField)
              : conflict.participantName;

            const recorded = participant?.deliveries?.[conflict.itemId];
            let matchedDeliveryIdx = -1;
            if (recorded?.status === 'delivered') {
              matchedDeliveryIdx = conflict.deliveries.findIndex(
                (d) =>
                  d.organizerId === recorded.deliveredByOrganizerId &&
                  (d.clientDeliveredAt === recorded.deliveredAt ||
                    d.timestamp === recorded.deliveredAt)
              );
              if (matchedDeliveryIdx === -1) {
                matchedDeliveryIdx = conflict.deliveries.findIndex(
                  (d) => d.organizerId === recorded.deliveredByOrganizerId
                );
              }
            }

            const noteValue =
              notesByKey[conflict.conflictKey] ?? (reopenedAfterResolve ? '' : resolution?.note ?? '');

            return (
              <article
                key={conflict.conflictKey}
                data-testid={`conflict-card-${conflict.conflictKey}`}
                className={`rounded-2xl border p-4 sm:p-5 space-y-4 transition-colors min-w-0 overflow-hidden ${
                  isResolved
                    ? 'border-emerald-200 dark:border-emerald-900/70 bg-white dark:bg-neutral-950'
                    : 'border-amber-300 dark:border-amber-800 bg-white dark:bg-neutral-950'
                }`}
              >
                {/* Card Header */}
                <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-neutral-800">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white">
                        {displayName}
                      </h3>
                      <span
                        dir="ltr"
                        className="text-xs font-ascii-mono rounded-lg bg-slate-100 dark:bg-neutral-900 px-2 py-0.5 text-slate-700 dark:text-neutral-300"
                      >
                        {conflict.barcode}
                      </span>
                    </div>
                    <div className="text-xs font-bold text-emerald-700 dark:text-emerald-400 font-mono-num">
                      العنصر: {conflict.itemName} · عدد التسليمات المتعارضة:{' '}
                      {conflict.deliveries.length}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {isResolved ? (
                      <span className="inline-flex items-center gap-1 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-3 py-1.5 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>تمت المراجعة</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 px-3 py-1.5 text-xs font-bold text-amber-800 dark:text-amber-300">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>
                          {reopenedAfterResolve ? 'مفتوح مجدداً (تسليم إضافي)' : 'تعارض مفتوح'}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Ordered Deliveries Timeline */}
                <div className="space-y-2">
                  <div className="text-xs font-bold text-slate-600 dark:text-neutral-400">
                    سجل التسليمات المرتّب بالوقت:
                  </div>
                  <div className="space-y-2">
                    {conflict.deliveries.map((deliv, idx) => {
                      const isRecordedInFile = idx === matchedDeliveryIdx;
                      return (
                        <div
                          key={`${deliv.logId}-${idx}`}
                          className={`rounded-2xl border p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 ${
                            isRecordedInFile
                              ? 'border-emerald-500/60 bg-emerald-50/50 dark:bg-emerald-950/30'
                              : 'border-slate-200 dark:border-neutral-800 bg-slate-50/70 dark:bg-black/60'
                          }`}
                        >
                          <div className="space-y-1 min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-xs sm:text-sm overflow-x-auto whitespace-nowrap">
                              <span className="inline-flex items-center justify-center rounded-md bg-slate-200 dark:bg-neutral-800 px-1.5 py-0.5 text-[11px] font-bold font-mono-num text-slate-700 dark:text-neutral-300">
                                #{idx + 1}
                              </span>
                              <span className="font-bold text-slate-900 dark:text-white">
                                {deliv.organizerName}
                              </span>
                              {deliv.boothName && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 dark:text-neutral-300">
                                  <MapPin className="w-3 h-3 shrink-0" />
                                  <span>{deliv.boothName}</span>
                                </span>
                              )}
                              {isRecordedInFile && (
                                <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 text-white px-2 py-0.5 text-[11px] font-bold">
                                  <CheckCircle2 className="w-3 h-3 shrink-0" />
                                  <span>المسجّل حالياً في ملف المتسابق</span>
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-x-3 text-[11px] text-slate-500 dark:text-neutral-400 font-mono-num overflow-x-auto whitespace-nowrap">
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3 shrink-0" />
                                <span>{formatArabicTime(deliv.timestamp)}</span>
                                <span className="hidden sm:inline">
                                  ({formatArabicDateTime(deliv.timestamp)})
                                </span>
                              </span>
                              {deliv.deviceId && (
                                <span className="inline-flex items-center gap-1">
                                  <Smartphone className="w-3 h-3 shrink-0" />
                                  <span dir="ltr" className="font-ascii-mono">
                                    {deliv.deviceId}
                                  </span>
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {deliv.viaOffline ? (
                              <span className="inline-flex items-center gap-1 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2.5 py-1 text-xs font-bold text-amber-800 dark:text-amber-300">
                                <WifiOff className="w-3.5 h-3.5 shrink-0" />
                                <span>أوفلاين</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                                <Wifi className="w-3.5 h-3.5 shrink-0" />
                                <span>أونلاين</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Existing resolution summary if resolved */}
                {isResolved && resolution && (
                  <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 text-xs text-emerald-900 dark:text-emerald-200 space-y-1">
                    <div className="font-bold font-mono-num">
                      تمت المراجعة بتاريخ {formatArabicDateTime(resolution.resolvedAt)} (عند{' '}
                      {resolution.resolvedLogCount} تسليمات)
                    </div>
                    {resolution.note && <div>ملاحظة: {resolution.note}</div>}
                  </div>
                )}

                <p className="text-xs text-slate-600 dark:text-neutral-400">
                  المتسابق استلم العنصر فعلاً، والتسليم الزائد يُعتبر وحدة إضافية خرجت من المخزون
                </p>

                {/* Action Bar: Review Only */}
                <div className="pt-2 border-t border-slate-100 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center gap-2.5">
                  <input
                    type="text"
                    maxLength={500}
                    value={noteValue}
                    onChange={(e) =>
                      setNotesByKey((prev) => ({
                        ...prev,
                        [conflict.conflictKey]: e.target.value,
                      }))
                    }
                    placeholder="ملاحظة المراجعة (اختياري، حتى 500 حرف)..."
                    className="flex-1 min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2 text-xs sm:text-sm text-slate-900 dark:text-white min-h-[42px]"
                  />

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      data-testid={`resolve-conflict-${conflict.conflictKey}`}
                      disabled={resolvingKey === conflict.conflictKey}
                      onClick={() => void handleMarkReviewed(conflict)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold min-h-[42px] whitespace-nowrap disabled:opacity-50"
                    >
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        {resolvingKey === conflict.conflictKey
                          ? 'جاري الحفظ...'
                          : isResolved
                          ? 'تحديث المراجعة'
                          : 'تمت المراجعة'}
                      </span>
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

    </div>
  );
};
