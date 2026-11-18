'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  BrainCircuit,
  Download,
  RotateCcw,
  Search,
  Send,
  TableProperties,
  X,
} from 'lucide-react';
import { performAdminUndo } from '@/lib/demo-store';
import { getSheetsAccessToken, signInWithGoogleSheets } from '@/lib/firebase';
import {
  computeEventStats,
  extractParticipantDisplayName,
  formatArabicTime,
  matchesSearchQuery,
} from '@/lib/marathon-logic';
import type { DeliverableItem, MarathonEvent, Participant } from '@/lib/types';

interface ReportsTabProps {
  activeEvent: MarathonEvent | null;
  participants: Participant[];
  adminName: string;
  useFirestore: boolean;
  idToken: string | null;
}

export const ReportsTab: React.FC<ReportsTabProps> = ({
  activeEvent,
  participants,
  adminName,
  useFirestore,
  idToken,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSheetsConfirm, setShowSheetsConfirm] = useState(false);
  const [sheetsStatus, setSheetsStatus] = useState<{
    type: 'success' | 'error';
    text: string;
    url?: string;
  } | null>(null);
  const [exportingSheets, setExportingSheets] = useState(false);

  // AI Thinking High advisor state
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const stats = useMemo(() => {
    if (!activeEvent) return [];
    return computeEventStats(participants, activeEvent.deliverableItems);
  }, [activeEvent, participants]);

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return participants;
    return participants.filter((p) => matchesSearchQuery(p, q));
  }, [participants, searchQuery]);

  const buildExportGrid = () => {
    if (!activeEvent) return { headers: [], rows: [] as string[][] };
    const dynamicKeys =
      activeEvent.displayFields.length > 0
        ? activeEvent.displayFields
        : Object.keys(participants[0]?.dynamicData ?? {});

    const itemHeaders = activeEvent.deliverableItems.flatMap((item) => [
      `${item.name} (الحالة)`,
      `${item.name} (المنظم)`,
      `${item.name} (الوقت)`,
    ]);

    const headers = ['الباركود', ...dynamicKeys, ...itemHeaders];
    const rows = participants.map((p) => {
      const base = [p.barcode, ...dynamicKeys.map((k) => p.dynamicData[k] ?? '')];
      const delivs = activeEvent.deliverableItems.flatMap((item) => {
        const d = p.deliveries?.[item.id];
        if (!d) return ['لم يستلم', '', ''];
        return ['تم التسليم', d.deliveredByOrganizerName, formatArabicTime(d.deliveredAt)];
      });
      return [...base, ...delivs];
    });
    return { headers, rows };
  };

  const handleExportExcel = () => {
    if (!activeEvent) return;
    const { headers, rows } = buildExportGrid();
    const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'تقرير التسليم');
    XLSX.writeFile(workbook, `${activeEvent.name}-audit-report.xlsx`);
  };

  const handleConfirmExportToGoogleSheets = async () => {
    if (!activeEvent) return;
    setShowSheetsConfirm(false);
    setExportingSheets(true);
    setSheetsStatus(null);
    try {
      let token = await getSheetsAccessToken();
      if (!token) {
        const authRes = await signInWithGoogleSheets();
        token = authRes.accessToken;
      }
      if (!token) {
        setSheetsStatus({
          type: 'error',
          text: 'يرجى تسجيل الدخول بحساب Google لمنح صلاحية إنشاء جدول Google Sheets.',
        });
        return;
      }

      const { headers, rows } = buildExportGrid();
      const res = await fetch('/api/sheets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: `تقرير ${activeEvent.name} - ${new Date().toLocaleDateString('ar-EG')}`,
          rows: [headers, ...rows],
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSheetsStatus({ type: 'error', text: data.error || 'فشل التصدير إلى Google Sheets' });
        return;
      }

      setSheetsStatus({
        type: 'success',
        text: 'تم إنشاء وتصدير التقرير النهائي إلى Google Sheets بنجاح!',
        url: data.spreadsheetUrl,
      });
    } catch {
      setSheetsStatus({ type: 'error', text: 'تعذر الاتصال بخدمة Google Sheets' });
    } finally {
      setExportingSheets(false);
    }
  };

  const handleUndo = async (barcode: string, item: DeliverableItem) => {
    if (!activeEvent) return;
    await performAdminUndo({
      eventId: activeEvent.id,
      barcode,
      item,
      adminName,
      displayFields: activeEvent.displayFields,
      useFirestore,
      idToken,
    });
  };

  const handleAskAiAdvisor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiQuestion.trim() || !activeEvent) return;
    setAiLoading(true);
    setAiError(null);
    try {
      // Aggregate T-shirt sizes & delivery summary cleanly
      const sizeBreakdown: Record<string, { total: number; delivered: number }> = {};
      for (const p of participants) {
        const size = p.dynamicData['مقاس التيشيرت'] || p.dynamicData['Size'] || 'غير محدد';
        if (!sizeBreakdown[size]) sizeBreakdown[size] = { total: 0, delivered: 0 };
        sizeBreakdown[size].total += 1;
        if (p.deliveries?.tshirt?.status === 'delivered') {
          sizeBreakdown[size].delivered += 1;
        }
      }

      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'ops_query',
          question: aiQuestion.trim(),
          eventSummary: {
            eventName: activeEvent.name,
            totalParticipants: participants.length,
            itemStats: stats,
            tshirtSizeBreakdown: sizeBreakdown,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAiError(data.error || 'تعذر الحصول على رد من مستشار الذكاء الاصطناعي');
        return;
      }
      setAiAnswer(data.answer);
    } catch {
      setAiError('تعذر الاتصال بخدمة الذكاء الاصطناعي');
    } finally {
      setAiLoading(false);
    }
  };

  if (!activeEvent) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 text-center text-sm text-slate-500">
        لا يوجد إيفنت نشط لعرض تقاريره.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Real-Time Progress Bars per Item */}
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            نسب التسليم اللحظية — {activeEvent.name}
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleExportExcel}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold min-h-[44px]"
            >
              <Download className="w-4 h-4" />
              <span>تصدير تقرير Excel (.xlsx)</span>
            </button>
            <button
              type="button"
              disabled={exportingSheets}
              onClick={() => setShowSheetsConfirm(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-4 py-2 text-xs font-bold text-slate-800 dark:text-white hover:bg-slate-50 dark:hover:bg-neutral-900 min-h-[44px]"
            >
              <TableProperties className="w-4 h-4 text-emerald-600" />
              <span>{exportingSheets ? 'جاري التصدير...' : 'تصدير إلى Google Sheets'}</span>
            </button>
          </div>
        </div>

        {sheetsStatus && (
          <div
            className={`mb-4 rounded-xl p-3 text-xs font-bold flex flex-wrap items-center justify-between gap-2 border ${
              sheetsStatus.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                : 'bg-red-50 dark:bg-red-950/60 border-red-200 dark:border-red-900 text-red-800 dark:text-red-200'
            }`}
          >
            <span>{sheetsStatus.text}</span>
            {sheetsStatus.url && (
              <a
                href={sheetsStatus.url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-4 font-bold"
              >
                فتح الجدول في Google Sheets
              </a>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((st) => (
            <div
              key={st.itemId}
              className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black p-4"
            >
              <div className="flex items-center justify-between text-xs font-bold text-slate-700 dark:text-neutral-300">
                <span>{st.itemName}</span>
                <span className="font-mono-num text-emerald-700 dark:text-emerald-400">
                  {st.delivered} / {st.total}
                </span>
              </div>
              <div className="mt-2.5 w-full h-2.5 rounded-full bg-slate-200 dark:bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${st.percentage}%` }}
                />
              </div>
              <div className="mt-1.5 text-xs font-mono-num text-slate-500 dark:text-neutral-400">
                {st.percentage}% مكتمل
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Gemini High Thinking Operations Advisor */}
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5">
        <div className="flex items-center gap-2 mb-2">
          <BrainCircuit className="w-5 h-5 text-emerald-600" />
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            مستشار العمليات الذكي (تحليل متعمق للتوزيع والمقاسات)
          </h3>
        </div>
        <form onSubmit={(e) => void handleAskAiAdvisor(e)} className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={aiQuestion}
            onChange={(e) => setAiQuestion(e.target.value)}
            placeholder="مثال: ما هي المقاسات الأكثر سحباً وهل نحتاج إعادة توزيع المنظمين على البوثات؟"
            className="flex-1 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
          />
          <button
            type="submit"
            disabled={aiLoading}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-5 py-2.5 text-xs font-bold min-h-[44px] whitespace-nowrap"
          >
            <Send className="w-4 h-4" />
            <span>{aiLoading ? 'جاري التفكير...' : 'تحليل فوري'}</span>
          </button>
        </form>
        {aiError && <p className="mt-2 text-xs font-semibold text-red-600">{aiError}</p>}
        {aiAnswer && (
          <div className="mt-4 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black p-4 text-sm text-slate-800 dark:text-neutral-200 whitespace-pre-wrap leading-relaxed">
            {aiAnswer}
          </div>
        )}
      </div>

      {/* Searchable Participant Audit Table with Admin-Only Undo Override */}
      <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            سجل المتسابقين والتحكم بالتسليم ({filteredParticipants.length})
          </h3>
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالاسم، الباركود، الموبايل..."
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-10 pl-3 py-2 text-sm text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-800">
          <table className="w-full text-right text-xs">
            <thead className="bg-slate-100 dark:bg-neutral-900 text-slate-700 dark:text-neutral-300">
              <tr>
                <th className="px-3 py-3 font-bold whitespace-nowrap">الباركود</th>
                <th className="px-3 py-3 font-bold whitespace-nowrap">المتسابق والبيانات</th>
                <th className="px-3 py-3 font-bold whitespace-nowrap">حالة المستلزمات وإلغاء التسليم</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
              {filteredParticipants.length === 0 ? (
                <tr>
                  <td colSpan={3} className="p-6 text-center text-slate-500">
                    لا توجد سجلات مطابقة.
                  </td>
                </tr>
              ) : (
                filteredParticipants.slice(0, 100).map((p) => {
                  const pName = extractParticipantDisplayName(p, activeEvent.displayFields);
                  return (
                    <tr key={p.barcode} className="bg-white dark:bg-neutral-950 align-top">
                      <td className="px-3 py-3 font-mono-num font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {p.barcode}
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-slate-900 dark:text-white text-sm">
                          {pName}
                        </div>
                        <div className="mt-1 text-slate-500 dark:text-neutral-400">
                          {activeEvent.displayFields
                            .filter((f) => p.dynamicData[f] && p.dynamicData[f] !== pName)
                            .map((f) => `${activeEvent.displayLabels?.[f] || f}: ${p.dynamicData[f]}`)
                            .join(' · ')}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          {activeEvent.deliverableItems.map((item) => {
                            const d = p.deliveries?.[item.id];
                            if (!d) {
                              return (
                                <span
                                  key={item.id}
                                  className="text-xs text-slate-400 dark:text-neutral-500 py-1 px-2 border border-slate-200 dark:border-neutral-800 rounded-lg"
                                >
                                  {item.name}: لم يستلم
                                </span>
                              );
                            }
                            return (
                              <div
                                key={item.id}
                                className="flex items-center gap-2 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1.5"
                              >
                                <div className="text-xs">
                                  <span className="font-bold text-emerald-900 dark:text-emerald-200">
                                    {item.name}
                                  </span>
                                  <span className="text-emerald-700 dark:text-emerald-400 mr-1.5 font-mono-num">
                                    ({d.deliveredByOrganizerName} · {formatArabicTime(d.deliveredAt)})
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  data-testid={`admin-undo-${p.barcode}-${item.id}`}
                                  onClick={() => void handleUndo(p.barcode, item)}
                                  className="inline-flex items-center gap-1 rounded-md bg-red-600 hover:bg-red-700 text-white px-2 py-1 text-[11px] font-bold whitespace-nowrap"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>إلغاء التسليم (تراجع)</span>
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Custom Confirmation Modal for Google Sheets Write Operation */}
      {showSheetsConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                تأكيد التصدير إلى Google Sheets
              </h3>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setShowSheetsConfirm(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-neutral-300 leading-relaxed">
              سيتم إنشاء ملف Google Sheets جديد في حسابك يتضمن سجل التسليم الكامل لـ{' '}
              <strong className="font-mono-num">{participants.length}</strong> متسابق في إيفنت &quot;
              {activeEvent.name}&quot;. هل تريد المتابعة؟
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowSheetsConfirm(false)}
                className="rounded-xl border border-slate-300 dark:border-neutral-700 px-4 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 min-h-[44px]"
              >
                إلغاء
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmExportToGoogleSheets()}
                className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2 text-xs font-bold min-h-[44px]"
              >
                تأكيد وإنشاء الجدول
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
