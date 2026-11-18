'use client';

import React, { useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  FileSpreadsheet,
  Sparkles,
  TableProperties,
  Upload,
} from 'lucide-react';
import { batchImportParticipants } from '@/lib/demo-store';
import { getSheetsAccessToken, signInWithGoogleSheets } from '@/lib/firebase';
import { autoSuggestColumnMapping } from '@/lib/marathon-logic';
import type { MarathonEvent } from '@/lib/types';

interface SheetImportTabProps {
  activeEvent: MarathonEvent | null;
  useFirestore: boolean;
  idToken: string | null;
  onImportDone: () => void;
}

export const SheetImportTab: React.FC<SheetImportTabProps> = ({
  activeEvent,
  useFirestore,
  idToken,
  onImportDone,
}) => {
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState<string>('');

  const [barcodeField, setBarcodeField] = useState<string>('');
  const [searchFields, setSearchFields] = useState<string[]>([]);
  const [displayFields, setDisplayFields] = useState<string[]>([]);
  const [displayLabels, setDisplayLabels] = useState<Record<string, string>>({});

  // Google Sheets state
  const [sheetUrl, setSheetUrl] = useState('');
  const [sheetTabs, setSheetTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState('');
  const [sheetsLoading, setSheetsLoading] = useState(false);

  // AI Thinking High mapping state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);

  // Progress & status
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const applySuggestedMapping = (hdrs: string[]) => {
    const suggested = autoSuggestColumnMapping(hdrs);
    setBarcodeField(suggested.barcodeField);
    setSearchFields(suggested.searchFields);
    setDisplayFields(suggested.displayFields);
    setDisplayLabels(suggested.displayLabels);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    setStatusMessage(null);
    setAiNote(null);

    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, {
        defval: '',
      });

      if (jsonRows.length === 0) {
        setErrorMsg('الملف فارغ أو لا يحتوي على صفوف بيانات.');
        return;
      }

      const hdrs = Object.keys(jsonRows[0]).map((h) => String(h).trim()).filter(Boolean);
      const cleanRows = jsonRows.map((r) => {
        const out: Record<string, string> = {};
        for (const h of hdrs) {
          out[h] = String(r[h] ?? '').trim();
        }
        return out;
      });

      setFileName(file.name);
      setHeaders(hdrs);
      setRows(cleanRows);
      applySuggestedMapping(hdrs);
    } catch {
      setErrorMsg('تعذر قراءة الملف. تأكد أنه بصيغة .xlsx أو .xls أو .csv صالحة.');
    }
  };

  const handleLoadGoogleSheet = async (tabOverride?: string) => {
    if (!sheetUrl.trim()) {
      setErrorMsg('يرجى لصق رابط أو معرف جدول Google Sheets أولاً.');
      return;
    }
    setErrorMsg(null);
    setSheetsLoading(true);
    try {
      let token = await getSheetsAccessToken();
      if (!token) {
        const authRes = await signInWithGoogleSheets();
        token = authRes.accessToken;
      }
      if (!token) {
        setErrorMsg('لم يتم الحصول على صلاحية الوصول إلى Google Sheets.');
        return;
      }

      const qs = new URLSearchParams({ spreadsheetId: sheetUrl.trim() });
      if (tabOverride) qs.set('sheetName', tabOverride);

      const res = await fetch(`/api/sheets?${qs.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'تعذر قراءة جدول Google Sheets');
        return;
      }

      setFileName(`Google Sheet: ${data.title} (${data.activeSheet})`);
      setSheetTabs(data.sheetTitles || []);
      setSelectedTab(data.activeSheet || '');
      setHeaders(data.headers || []);
      setRows(data.rows || []);
      applySuggestedMapping(data.headers || []);
    } catch {
      setErrorMsg('حدث خطأ أثناء الاتصال بـ Google Sheets.');
    } finally {
      setSheetsLoading(false);
    }
  };

  const handleAiSmartMap = async () => {
    if (headers.length === 0) return;
    setAiLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'map_columns',
          headers,
          sampleRows: rows.slice(0, 3),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'تعذر تشغيل الاقتراح الذكي للأعمدة.');
        return;
      }
      if (data.mapping) {
        if (headers.includes(data.mapping.barcodeField)) {
          setBarcodeField(data.mapping.barcodeField);
        }
        const validSearch = (data.mapping.searchFields || []).filter((f: string) =>
          headers.includes(f)
        );
        const validDisplay = (data.mapping.displayFields || []).filter((f: string) =>
          headers.includes(f)
        );
        if (validSearch.length > 0) setSearchFields(validSearch);
        if (validDisplay.length > 0) {
          setDisplayFields(validDisplay);
          const labels: Record<string, string> = {};
          validDisplay.forEach((f: string) => {
            labels[f] = displayLabels[f] || f;
          });
          setDisplayLabels(labels);
        }
        setAiNote(data.mapping.reasoningArabic || 'تم تحليل الأعمدة واقتراح التعيين الأمثل.');
      }
    } catch {
      setErrorMsg('فشل الاتصال بخدمة التحليل الذكي.');
    } finally {
      setAiLoading(false);
    }
  };

  const toggleMultiField = (
    field: string,
    list: string[],
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    if (list.includes(field)) {
      setter(list.filter((f) => f !== field));
    } else {
      setter([...list, field]);
    }
  };

  const handleCommitImport = async () => {
    if (!activeEvent) {
      setErrorMsg('يرجى تفعيل إيفنت أولاً من تبويب إدارة الإيفنتات.');
      return;
    }
    if (!barcodeField) {
      setErrorMsg('يرجى اختيار عمود الباركود (إلزامي).');
      return;
    }
    setImporting(true);
    setProgress(0);
    setErrorMsg(null);
    setStatusMessage(null);

    try {
      const count = await batchImportParticipants({
        eventId: activeEvent.id,
        rows,
        barcodeField,
        searchFields,
        displayFields,
        displayLabels,
        useFirestore,
        idToken,
        onProgress: (pct) => setProgress(pct),
      });
      setStatusMessage(`تم رفع وحفظ ${count} متسابق في الإيفنت "${activeEvent.name}" بنجاح!`);
      onImportDone();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'فشل رفع البيانات');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload File or Import from Google Sheets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5">
          <div className="flex items-center gap-2 mb-2">
            <Upload className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              رفع ملف Excel أو CSV
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mb-4">
            تتم قراءة الملف على جهازك مباشرة دون قيود حجم، مع معاينة فورية لأول 3 صفوف.
          </p>
          <label
            htmlFor="sheet-file-input"
            className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black p-6 cursor-pointer hover:border-emerald-500 transition-colors"
          >
            <FileSpreadsheet className="w-8 h-8 text-emerald-600 mb-2" />
            <span className="text-sm font-bold text-slate-800 dark:text-white">
              {fileName ? `الملف المختار: ${fileName}` : 'اختر ملف .xlsx أو .xls أو .csv'}
            </span>
            <input
              id="sheet-file-input"
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => void handleFileUpload(e)}
              className="sr-only"
            />
          </label>
        </div>

        {/* Google Sheets Direct Connector */}
        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5">
          <div className="flex items-center gap-2 mb-2">
            <TableProperties className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              استيراد مباشر من Google Sheets
            </h2>
          </div>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mb-4">
            الصق رابط جدول Google Sheets وسيتم اكتشاف الصفحات (Tabs) واستيراد بيانات المتسابقين.
          </p>
          <div className="space-y-3">
            <input
              type="text"
              dir="ltr"
              value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={sheetsLoading}
                onClick={() => void handleLoadGoogleSheet()}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-4 py-2.5 text-xs font-bold min-h-[44px]"
              >
                {sheetsLoading ? 'جاري الجلب...' : 'جلب البيانات من Google Sheets'}
              </button>

              {sheetTabs.length > 1 && (
                <select
                  aria-label="اختيار صفحة الجدول"
                  value={selectedTab}
                  onChange={(e) => {
                    setSelectedTab(e.target.value);
                    void handleLoadGoogleSheet(e.target.value);
                  }}
                  className="rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2 text-xs font-semibold min-h-[44px]"
                >
                  {sheetTabs.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 p-4 text-sm font-semibold text-red-800 dark:text-red-200">
          {errorMsg}
        </div>
      )}

      {statusMessage && (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 p-4 text-sm font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* 3-Row Preview & Interactive Column Mapping */}
      {headers.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                معاينة أول 3 صفوف وتحديد الأعمدة ({rows.length} متسابق)
              </h3>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
                حدد عمود الباركود وأعمدة البحث الذكي والحقول التي تظهر على شاشة المنظم.
              </p>
            </div>
            <button
              type="button"
              disabled={aiLoading}
              onClick={() => void handleAiSmartMap()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 px-4 py-2 text-xs font-bold min-h-[44px]"
            >
              <Sparkles className="w-4 h-4" />
              <span>{aiLoading ? 'جاري التحليل...' : 'اقتراح ذكي للأعمدة (Gemini)'}</span>
            </button>
          </div>

          {aiNote && (
            <div className="rounded-xl bg-slate-50 dark:bg-black border border-slate-200 dark:border-neutral-800 p-3 text-xs text-slate-700 dark:text-neutral-300">
              {aiNote}
            </div>
          )}

          {/* 3-Row Table Preview */}
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-neutral-800">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-100 dark:bg-neutral-900 text-slate-700 dark:text-neutral-300">
                <tr>
                  {headers.map((h) => (
                    <th key={h} className="px-3 py-2.5 font-bold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-neutral-800">
                {rows.slice(0, 3).map((row, idx) => (
                  <tr key={idx} className="bg-white dark:bg-neutral-950">
                    {headers.map((h) => (
                      <td key={h} className="px-3 py-2 text-slate-700 dark:text-neutral-300 whitespace-nowrap">
                        {row[h]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Interactive Mapping Controls */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* 1. Barcode Field */}
            <div>
              <label
                htmlFor="map-barcode-select"
                className="block text-xs font-bold text-slate-800 dark:text-neutral-200 mb-2"
              >
                1. عمود الباركود الفريد (إلزامي)
              </label>
              <select
                id="map-barcode-select"
                value={barcodeField}
                onChange={(e) => setBarcodeField(e.target.value)}
                className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
              >
                <option value="">-- اختر العمود --</option>
                {headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>

            {/* 2. Search Fields */}
            <div>
              <div className="text-xs font-bold text-slate-800 dark:text-neutral-200 mb-2">
                2. أعمدة البحث الذكي (الاسم / الموبايل / Bib)
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                {headers.map((h) => (
                  <label
                    key={h}
                    className="flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300 cursor-pointer py-1"
                  >
                    <input
                      type="checkbox"
                      checked={searchFields.includes(h)}
                      onChange={() => toggleMultiField(h, searchFields, setSearchFields)}
                      className="w-4 h-4 accent-emerald-600 rounded"
                    />
                    <span>{h}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* 3. Visible Organizer Fields + Arabic Custom Labels */}
            <div>
              <div className="text-xs font-bold text-slate-800 dark:text-neutral-200 mb-2">
                3. الحقول الظاهرة للمنظم + التسمية العربية
              </div>
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {headers.map((h) => {
                  const checked = displayFields.includes(h);
                  return (
                    <div key={h} className="space-y-1">
                      <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-neutral-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            toggleMultiField(h, displayFields, setDisplayFields);
                            if (!checked && !displayLabels[h]) {
                              setDisplayLabels((prev) => ({ ...prev, [h]: h }));
                            }
                          }}
                          className="w-4 h-4 accent-emerald-600 rounded"
                        />
                        <span className="font-semibold">{h}</span>
                      </label>
                      {checked && (
                        <input
                          type="text"
                          value={displayLabels[h] ?? h}
                          onChange={(e) =>
                            setDisplayLabels((prev) => ({ ...prev, [h]: e.target.value }))
                          }
                          placeholder="تسمية عربية اختيارية"
                          className="w-full rounded-lg border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black px-2.5 py-1 text-xs"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {importing && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs font-bold text-slate-700 dark:text-neutral-300 font-mono-num">
                <span>جاري رفع الدفعات (400 سجل/دفعة)...</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-3 rounded-full bg-slate-200 dark:bg-neutral-800 overflow-hidden">
                <div
                  className="h-full bg-emerald-600 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            type="button"
            disabled={importing || !barcodeField}
            onClick={() => void handleCommitImport()}
            className="w-full sm:w-auto rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold px-6 py-3 text-sm min-h-[48px]"
          >
            {importing
              ? 'جاري الحفظ...'
              : `اعتماد ورفع ${rows.length} متسابق إلى "${activeEvent?.name ?? 'الإيفنت'}"`}
          </button>
        </div>
      )}
    </div>
  );
};
