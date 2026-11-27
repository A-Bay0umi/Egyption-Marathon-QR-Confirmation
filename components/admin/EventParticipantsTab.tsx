'use client';

import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
} from 'lucide-react';
import {
  batchImportParticipantsFirestore,
  deleteParticipantDoc,
  updateEventDoc,
  upsertSingleParticipantDoc,
} from '@/lib/firestore-store';
import {
  autoSuggestColumnMapping,
  extractParticipantDisplayName,
  matchesSearchQuery,
} from '@/lib/marathon-logic';
import type { MarathonEvent, Participant } from '@/lib/types';

interface EventParticipantsTabProps {
  event: MarathonEvent;
  participants: Participant[];
}

export const EventParticipantsTab: React.FC<EventParticipantsTabProps> = ({
  event,
  participants,
}) => {
  // Single participant manual add
  const [nameInput, setNameInput] = useState('');
  const [barcodeInput, setBarcodeInput] = useState('');
  const [bibInput, setBibInput] = useState('');
  const [sizeInput, setSizeInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [addingOne, setAddingOne] = useState(false);

  // Excel/CSV import state
  const [showImport, setShowImport] = useState(false);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState('');
  const [barcodeField, setBarcodeField] = useState('');
  const [nameField, setNameField] = useState('');
  const [searchFields, setSearchFields] = useState<string[]>([]);
  const [displayFields, setDisplayFields] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, processed: 0, total: 0 });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savingNameField, setSavingNameField] = useState(false);

  // Search participants in this event
  const [searchQuery, setSearchQuery] = useState('');

  const availableColumns = useMemo(() => {
    const colSet = new Set<string>();
    if (event.nameField) colSet.add(event.nameField);
    for (const p of participants) {
      for (const k of Object.keys(p.dynamicData)) {
        if (k.trim()) colSet.add(k);
      }
    }
    return Array.from(colSet);
  }, [event.nameField, participants]);

  const filteredParticipants = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return participants;
    return participants.filter((p) => matchesSearchQuery(p, q));
  }, [participants, searchQuery]);

  const handleAddSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameInput.trim() || !barcodeInput.trim()) return;
    setAddingOne(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      const dynamicData: Record<string, string> = {
        الاسم: nameInput.trim(),
      };
      if (bibInput.trim()) dynamicData['رقم الصدر'] = bibInput.trim();
      if (sizeInput.trim()) dynamicData['مقاس التيشيرت'] = sizeInput.trim();
      if (phoneInput.trim()) dynamicData['رقم الموبايل'] = phoneInput.trim();

      await upsertSingleParticipantDoc({
        event,
        barcode: barcodeInput.trim(),
        dynamicData,
        currentCount: participants.length,
      });

      setNameInput('');
      setBarcodeInput('');
      setBibInput('');
      setSizeInput('');
      setPhoneInput('');
      setStatusMessage('تمت إضافة المتسابق إلى Firebase بنجاح.');
    } catch {
      setErrorMessage('تعذر إضافة المتسابق. يرجى التأكد من الباركود.');
    } finally {
      setAddingOne(false);
    }
  };

  const applyParsedGrid = (rawHeaders: string[], rawRows: Record<string, string>[], label: string) => {
    const cleanHeaders = rawHeaders.map((h) => String(h).trim()).filter(Boolean);
    if (cleanHeaders.length === 0 || rawRows.length === 0) {
      setErrorMessage('الملف لا يحتوي على أعمدة أو صفوف صالحة.');
      return;
    }
    const suggested = autoSuggestColumnMapping(cleanHeaders);
    setHeaders(cleanHeaders);
    setRows(rawRows);
    setFileName(label);
    setBarcodeField(suggested.barcodeField);
    setNameField(suggested.nameField ?? '');
    setSearchFields(suggested.searchFields);
    setDisplayFields(suggested.displayFields);
    setErrorMessage(null);
    setStatusMessage(null);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawMatrix = XLSX.utils.sheet_to_json<(string | number)[]>(firstSheet, {
        header: 1,
        defval: '',
      });
      if (rawMatrix.length < 2) {
        setErrorMessage('الشيت فارغ أو يحتوي على صف واحد فقط.');
        return;
      }
      const headerRow = rawMatrix[0].map((c) => String(c ?? '').trim());
      const mappedRows = rawMatrix
        .slice(1)
        .filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''))
        .map((r) => {
          const obj: Record<string, string> = {};
          headerRow.forEach((h, idx) => {
            if (h) obj[h] = String(r[idx] ?? '').trim();
          });
          return obj;
        });

      applyParsedGrid(headerRow, mappedRows, file.name);
    } catch {
      setErrorMessage('تعذر قراءة ملف Excel / CSV.');
    }
  };

  const toggleSelection = (list: string[], setter: (next: string[]) => void, field: string) => {
    setter(list.includes(field) ? list.filter((f) => f !== field) : [...list, field]);
  };

  const handleConfirmImport = async () => {
    if (!barcodeField) {
      setErrorMessage('يرجى تحديد عمود الباركود.');
      return;
    }
    setImporting(true);
    setErrorMessage(null);
    try {
      const count = await batchImportParticipantsFirestore({
        eventId: event.id,
        rows,
        barcodeField,
        nameField: nameField || undefined,
        searchFields,
        displayFields,
        displayLabels: {},
        onProgress: (percent, processed, total) => setProgress({ percent, processed, total }),
      });
      setStatusMessage(`تم حفظ ${count} متسابق على Firebase بنجاح!`);
      setShowImport(false);
      setRows([]);
      setHeaders([]);
    } catch {
      setErrorMessage('حدث خطأ أثناء رفع المتسابقين إلى Firebase.');
    } finally {
      setImporting(false);
    }
  };

  const handleChangeEventNameField = async (nextField: string) => {
    setSavingNameField(true);
    setErrorMessage(null);
    setStatusMessage(null);
    try {
      await updateEventDoc(event.id, { nameField: nextField });
      setStatusMessage(
        nextField
          ? `تم تحديد عمود "${nextField}" كاسم المتسابق بنجاح.`
          : 'تمت إعادة اختيار عمود الاسم إلى الوضع التلقائي.'
      );
    } catch {
      setErrorMessage('تعذر تحديث عمود الاسم. يرجى المحاولة مرة أخرى.');
    } finally {
      setSavingNameField(false);
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {statusMessage && (
        <div className="rounded-2xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 p-3.5 text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/50 p-3.5 text-xs font-bold text-red-800 dark:text-red-200">
          {errorMessage}
        </div>
      )}

      {/* Add Single Participant Form */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <UserPlus className="w-5 h-5 text-emerald-600 shrink-0" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              إضافة متسابقين لهذا الإيفنت
            </h2>
          </div>

          <button
            type="button"
            onClick={() => setShowImport((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2 text-xs font-bold text-slate-800 dark:text-white min-h-[42px]"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
            <span>{showImport ? 'إغلاق رفع الشيت' : 'استيراد شيت Excel / CSV'}</span>
          </button>
        </div>

        <form onSubmit={(e) => void handleAddSingle(e)} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            placeholder="اسم المتسابق *"
            required
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
          />
          <input
            type="text"
            dir="ltr"
            value={barcodeInput}
            onChange={(e) => setBarcodeInput(e.target.value)}
            placeholder="Barcode (ex: RUN-101) *"
            required
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
          />
          <input
            type="text"
            value={bibInput}
            onChange={(e) => setBibInput(e.target.value)}
            placeholder="رقم الصدر (اختياري)"
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
          />
          <input
            type="text"
            value={sizeInput}
            onChange={(e) => setSizeInput(e.target.value)}
            placeholder="المقاس (مثال: L)"
            className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
          />
          <div className="flex gap-2 min-w-0">
            <input
              type="tel"
              dir="ltr"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              placeholder="الموبايل"
              className="flex-1 min-w-0 w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2.5 text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
            />
            <button
              type="submit"
              disabled={addingOne}
              className="inline-flex items-center justify-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold min-h-[44px] whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة</span>
            </button>
          </div>
        </form>

        {/* Excel / CSV Bulk Importer */}
        {showImport && (
          <div className="pt-4 border-t border-slate-100 dark:border-neutral-800 space-y-4">
            <label className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black p-6 cursor-pointer hover:border-emerald-600 transition-colors">
              <Upload className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-bold text-slate-700 dark:text-neutral-200">
                {fileName ? `تم اختيار: ${fileName} (${rows.length} صف)` : 'اختر ملف Excel (.xlsx / .xls) أو CSV'}
              </span>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => void handleFileUpload(e)}
                className="sr-only"
              />
            </label>

            {headers.length > 0 && (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label
                      htmlFor="import-barcode-field"
                      className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
                    >
                      عمود الباركود / الكود المميز (مطلوب)
                    </label>
                    <select
                      id="import-barcode-field"
                      value={barcodeField}
                      onChange={(e) => setBarcodeField(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                    >
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="import-name-field"
                      className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
                    >
                      عمود اسم المتسابق (الاسم الظاهر)
                    </label>
                    <select
                      id="import-name-field"
                      data-testid="import-name-field-select"
                      value={nameField}
                      onChange={(e) => setNameField(e.target.value)}
                      className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                    >
                      <option value="">تحديد تلقائي (افتراضي)</option>
                      {headers.map((h) => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-w-0">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-2">
                      أعمدة البحث السريع:
                    </div>
                    <div className="flex flex-wrap gap-2 min-w-0">
                      {headers.map((h) => (
                        <label
                          key={h}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 px-3 py-1.5 text-xs font-semibold cursor-pointer min-h-[38px] max-w-full overflow-x-auto whitespace-nowrap"
                        >
                          <input
                            type="checkbox"
                            checked={searchFields.includes(h)}
                            onChange={() => toggleSelection(searchFields, setSearchFields, h)}
                            className="w-4 h-4 accent-emerald-600 rounded shrink-0"
                          />
                          <span>{h}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-2">
                      البيانات الظاهرة للمنظم عند المسح:
                    </div>
                    <div className="flex flex-wrap gap-2 min-w-0">
                      {headers.map((h) => (
                        <label
                          key={h}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 px-3 py-1.5 text-xs font-semibold cursor-pointer min-h-[38px] max-w-full overflow-x-auto whitespace-nowrap"
                        >
                          <input
                            type="checkbox"
                            checked={displayFields.includes(h)}
                            onChange={() => toggleSelection(displayFields, setDisplayFields, h)}
                            className="w-4 h-4 accent-emerald-600 rounded shrink-0"
                          />
                          <span>{h}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                {importing && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-bold font-mono-num">
                      <span>جاري الرفع إلى Firebase...</span>
                      <span>
                        {progress.processed} / {progress.total} ({progress.percent}%)
                      </span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-slate-200 dark:bg-neutral-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-600 transition-all"
                        style={{ width: `${progress.percent}%` }}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  disabled={importing}
                  onClick={() => void handleConfirmImport()}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 text-sm min-h-[48px] disabled:opacity-50"
                >
                  {importing ? 'جاري الحفظ...' : `اعتماد وحفظ ${rows.length} متسابق على Firebase`}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Participants Directory for This Event */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 min-w-0">
          <h3 className="text-base font-bold text-slate-900 dark:text-white">
            الأشخاص المسجلون في هذا الإيفنت ({filteredParticipants.length})
          </h3>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full lg:w-auto min-w-0">
            {availableColumns.length > 0 && (
              <div className="flex items-center gap-2 min-w-0">
                <label
                  htmlFor="event-name-field-select"
                  className="text-xs font-bold text-slate-700 dark:text-neutral-300 whitespace-nowrap shrink-0"
                >
                  عمود الاسم:
                </label>
                <select
                  id="event-name-field-select"
                  data-testid="event-name-field-select"
                  disabled={savingNameField}
                  value={event.nameField ?? ''}
                  onChange={(e) => void handleChangeEventNameField(e.target.value)}
                  className="w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2 text-xs sm:text-sm font-semibold text-slate-900 dark:text-white min-h-[44px] disabled:opacity-50"
                >
                  <option value="">تحديد تلقائي (افتراضي)</option>
                  {availableColumns.map((col) => (
                    <option key={col} value={col}>
                      {col}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="relative w-full sm:w-64 min-w-0">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث بالاسم، الباركود، الموبايل..."
                className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-10 pl-3 py-2 text-sm text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>
          </div>
        </div>

        {participants.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-neutral-800 p-8 text-center text-sm text-slate-500 dark:text-neutral-400">
            لا يوجد أشخاص مسجلون في هذا الإيفنت حتى الآن. أضف أول متسابق أو ارفع ملف Excel.
          </div>
        ) : filteredParticipants.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-neutral-800 p-6 text-center text-sm text-slate-500 dark:text-neutral-400">
            لا توجد نتائج مطابقة للبحث.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-neutral-800 border border-slate-200 dark:border-neutral-800 rounded-xl overflow-hidden">
            {filteredParticipants.slice(0, 150).map((p) => {
              const pName = extractParticipantDisplayName(p, event.displayFields, event.nameField);
              const details = Object.entries(p.dynamicData)
                .filter(([k, val]) => val && k !== event.nameField && val !== pName)
                .map(([k, val]) => `${k}: ${val}`)
                .join(' · ');

              return (
                <div
                  key={p.barcode}
                  className="p-3.5 sm:px-4 bg-white dark:bg-neutral-950 flex items-center justify-between gap-3 min-w-0"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 overflow-x-auto whitespace-nowrap">
                      <span className="text-sm font-bold text-slate-900 dark:text-white">
                        {pName}
                      </span>
                      <span
                        dir="ltr"
                        className="text-xs font-ascii-mono text-slate-500 dark:text-neutral-400"
                      >
                        {p.barcode}
                      </span>
                    </div>
                    {details && (
                      <div className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5 overflow-x-auto whitespace-nowrap">
                        {details}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      void deleteParticipantDoc(event.id, p.barcode, participants.length - 1)
                    }
                    aria-label={`حذف ${pName}`}
                    className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 min-h-[40px] min-w-[40px] flex items-center justify-center shrink-0"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
