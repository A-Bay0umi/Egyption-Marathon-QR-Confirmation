'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Code2,
  Copy,
  FileSpreadsheet,
  Plus,
  RefreshCw,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { updateEventDoc } from '@/lib/firestore-store';
import { extractParticipantDisplayName, normalizeBarcode } from '@/lib/marathon-logic';
import {
  buildDefaultColorRules,
  buildDefaultSheetsColumns,
  columnIndexToLetter,
  evaluateColorRulesForRow,
  formatDeliveryTime12hEn,
  generateGoogleAppsScriptCode,
  isValidAppsScriptUrl,
} from '@/lib/sheets-sync';
import type {
  MarathonEvent,
  Organizer,
  Participant,
  SheetsColorRule,
  SheetsColumnMapping,
  SheetsColumnSourceType,
} from '@/lib/types';
import { SheetsColorRulesSection } from './SheetsColorRulesSection';

interface EventSheetsDesignerTabProps {
  event: MarathonEvent;
  organizers: Organizer[];
  participants: Participant[];
  availableParticipantFields: string[];
  onManualSyncSheets?: () => Promise<void>;
  sheetsSyncStatus?: 'idle' | 'syncing' | 'success' | 'error';
  sheetsSyncMessage?: string | null;
  sheetsLastSyncedAt?: string | null;
}

type CreatorCategory = 'excel' | 'delivery' | 'static';
type DeliveryMetricOption =
  | 'item_status'
  | 'item_time'
  | 'item_organizer'
  | 'item_organizer_name'
  | 'item_booth';

const DELIVERY_METRIC_OPTIONS: Array<{ value: DeliveryMetricOption; label: string }> = [
  { value: 'item_status', label: 'حالة التسليم (Delivered / Not Delivered)' },
  { value: 'item_time', label: 'وقت التسليم (12 ساعة بالثانية إنجليزي)' },
  { value: 'item_organizer', label: 'اسم المنظم + البوث معاً' },
  { value: 'item_organizer_name', label: 'اسم المنظم فقط' },
  { value: 'item_booth', label: 'اسم البوث فقط' },
];

function describeColumnSource(
  col: SheetsColumnMapping,
  event: MarathonEvent
): string {
  const itemName =
    event.deliverableItems.find((i) => i.id === col.itemId)?.name ?? 'مهمة غير محددة';
  switch (col.sourceType) {
    case 'barcode':
      return 'من الإكسل · الباركود / رقم التذكرة';
    case 'participant_name':
      return 'من الإكسل · اسم المتسابق';
    case 'dynamic_field':
      return `من الإكسل · ${col.fieldKey || 'حقل غير محدد'}`;
    case 'item_status':
      return `من التسليم · ${itemName} · الحالة`;
    case 'item_time':
      return `من التسليم · ${itemName} · وقت التسليم`;
    case 'item_organizer':
      return `من التسليم · ${itemName} · المنظم والبوث`;
    case 'item_organizer_name':
      return `من التسليم · ${itemName} · اسم المنظم`;
    case 'item_booth':
      return `من التسليم · ${itemName} · اسم البوث`;
    case 'static_text':
      return `نص ثابت · ${col.staticValue || '(فارغ)'}`;
    default:
      return '';
  }
}

function previewCellValue(
  col: SheetsColumnMapping,
  sample: Participant | undefined,
  event: MarathonEvent,
  boothByOrgId: Map<string, string>
): string {
  if (!sample) {
    if (col.sourceType === 'static_text') return col.staticValue ?? '';
    if (col.sourceType === 'item_status') return 'Not Delivered';
    return '—';
  }
  const deliv = col.itemId ? sample.deliveries?.[col.itemId] : undefined;
  const booth = deliv ? (boothByOrgId.get(deliv.deliveredByOrganizerId) ?? '') : '';
  const orgName = deliv?.deliveredByOrganizerName ?? '';
  const orgLabel = booth && orgName ? `${orgName} (${booth})` : orgName || booth;

  switch (col.sourceType) {
    case 'barcode':
      return normalizeBarcode(sample.barcode) || sample.barcode;
    case 'participant_name':
      return extractParticipantDisplayName(sample, event.displayFields, event.nameField);
    case 'dynamic_field':
      return col.fieldKey ? String(sample.dynamicData?.[col.fieldKey] ?? '') : '';
    case 'item_status':
      return deliv?.status === 'delivered' ? 'Delivered' : 'Not Delivered';
    case 'item_time':
      return deliv?.status === 'delivered' ? formatDeliveryTime12hEn(deliv.deliveredAt) : '';
    case 'item_organizer':
      return deliv?.status === 'delivered' ? orgLabel : '';
    case 'item_organizer_name':
      return deliv?.status === 'delivered' ? orgName : '';
    case 'item_booth':
      return deliv?.status === 'delivered' ? booth : '';
    case 'static_text':
      return col.staticValue ?? '';
    default:
      return '';
  }
}

export const EventSheetsDesignerTab: React.FC<EventSheetsDesignerTabProps> = ({
  event,
  organizers,
  participants,
  availableParticipantFields,
  onManualSyncSheets,
  sheetsSyncStatus = 'idle',
  sheetsSyncMessage = null,
  sheetsLastSyncedAt = null,
}) => {
  // Connection settings
  const [webhookUrl, setWebhookUrl] = useState(event.sheetsWebhookUrl ?? '');
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(event.sheetsAutoSync !== false);

  // User-designed columns (starts empty if never customized, or loads saved columns)
  const [columns, setColumns] = useState<SheetsColumnMapping[]>(() =>
    Array.isArray(event.sheetsColumns) ? event.sheetsColumns : []
  );

  // User-designed row/column conditional color rules
  const [colorRules, setColorRules] = useState<SheetsColorRule[]>(() =>
    Array.isArray(event.sheetsColorRules) ? event.sheetsColorRules : []
  );
  const [colorRulesTouched, setColorRulesTouched] = useState(() =>
    Array.isArray(event.sheetsColorRules)
  );

  // New column creator form state
  const [newHeader, setNewHeader] = useState('');
  const [creatorCategory, setCreatorCategory] = useState<CreatorCategory>('excel');
  const [excelSelection, setExcelSelection] = useState<string>('__barcode__');
  const [customExcelField, setCustomExcelField] = useState('');
  const [deliveryItemId, setDeliveryItemId] = useState<string>(
    event.deliverableItems[0]?.id ?? ''
  );
  const [deliveryMetric, setDeliveryMetric] = useState<DeliveryMetricOption>('item_status');
  const [staticTextValue, setStaticTextValue] = useState('');
  const [creatorError, setCreatorError] = useState<string | null>(null);

  // Save & generated code state
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [codeVisible, setCodeVisible] = useState(
    () => Array.isArray(event.sheetsColumns) && event.sheetsColumns.length > 0
  );
  const [copiedCode, setCopiedCode] = useState(false);

  const boothByOrgId = useMemo(() => {
    const map = new Map<string, string>();
    for (const org of organizers) {
      if (org.boothName) map.set(org.id, org.boothName);
    }
    return map;
  }, [organizers]);

  const previewSamples = useMemo(() => {
    if (participants.length === 0) return [];
    const picked: Participant[] = [];
    const seenBuckets = new Set<string>();
    const itemIds = event.deliverableItems.map((i) => i.id);

    for (const p of participants) {
      const deliveredCount = itemIds.filter((id) => p.deliveries?.[id]?.status === 'delivered').length;
      const bucket =
        itemIds.length === 0
          ? 'any'
          : deliveredCount === itemIds.length
          ? 'all'
          : deliveredCount > 0
          ? 'partial'
          : 'none';
      if (!seenBuckets.has(bucket)) {
        seenBuckets.add(bucket);
        picked.push(p);
      }
      if (picked.length >= 4) break;
    }

    if (picked.length === 0 && participants[0]) {
      picked.push(participants[0]);
    }
    return picked;
  }, [participants, event.deliverableItems]);

  const effectiveColorRulesForPreview = useMemo(() => {
    if (colorRules.length > 0 || colorRulesTouched) return colorRules;
    return buildDefaultColorRules(columns);
  }, [colorRules, colorRulesTouched, columns]);

  const generatedCode = useMemo(
    () =>
      generateGoogleAppsScriptCode(
        event.sheetsWebhookSecret,
        columns,
        colorRulesTouched || colorRules.length > 0 ? colorRules : undefined
      ),
    [event.sheetsWebhookSecret, columns, colorRules, colorRulesTouched]
  );

  const handleSelectExcelOption = (val: string) => {
    setExcelSelection(val);
    setCreatorError(null);
    if (!newHeader.trim()) {
      if (val === '__barcode__') setNewHeader('Tkt Number');
      else if (val === '__name__') setNewHeader('Name');
      else if (val !== '__custom__') setNewHeader(val);
    }
  };

  const handleAddColumn = (e: React.FormEvent) => {
    e.preventDefault();
    setCreatorError(null);

    let header = newHeader.trim();
    let sourceType: SheetsColumnSourceType = 'barcode';
    let fieldKey: string | undefined;
    let itemId: string | undefined;
    let staticValue: string | undefined;

    if (creatorCategory === 'excel') {
      if (excelSelection === '__barcode__') {
        sourceType = 'barcode';
        if (!header) header = 'Tkt Number';
      } else if (excelSelection === '__name__') {
        sourceType = 'participant_name';
        if (!header) header = 'Name';
      } else if (excelSelection === '__custom__') {
        const cleanField = customExcelField.trim();
        if (!cleanField) {
          setCreatorError('اكتب اسم عمود الإكسل الذي تريد سحب البيانات منه.');
          return;
        }
        sourceType = 'dynamic_field';
        fieldKey = cleanField;
        if (!header) header = cleanField;
      } else {
        sourceType = 'dynamic_field';
        fieldKey = excelSelection;
        if (!header) header = excelSelection;
      }
    } else if (creatorCategory === 'delivery') {
      const targetItemId = deliveryItemId || event.deliverableItems[0]?.id || '';
      if (!targetItemId) {
        setCreatorError('أضف مهمة أولاً من تبويب الإعدادات لتتمكن من اختيار بيانات التسليم.');
        return;
      }
      sourceType = deliveryMetric;
      itemId = targetItemId;
      if (!header) {
        const itemName =
          event.deliverableItems.find((i) => i.id === targetItemId)?.name ?? 'Item';
        const suffixMap: Record<DeliveryMetricOption, string> = {
          item_status: 'Status',
          item_time: 'Delivery Time',
          item_organizer: 'Organizer',
          item_organizer_name: 'Organizer Name',
          item_booth: 'Booth',
        };
        header = `${itemName} - ${suffixMap[deliveryMetric]}`;
      }
    } else {
      if (!header) {
        setCreatorError('اكتب عنوان العمود في الصف الأول.');
        return;
      }
      sourceType = 'static_text';
      staticValue = staticTextValue;
    }

    if (columns.length >= 40) {
      setCreatorError('الحد الأقصى هو 40 عموداً في الشيت.');
      return;
    }

    const nextCol: SheetsColumnMapping = {
      id: `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      header,
      sourceType,
      ...(fieldKey ? { fieldKey } : {}),
      ...(itemId ? { itemId } : {}),
      ...(staticValue !== undefined ? { staticValue } : {}),
    };

    setColumns((prev) => [...prev, nextCol]);
    setNewHeader('');
    setCustomExcelField('');
    setStaticTextValue('');
    setSaveMessage(null);
    setSaveError(null);
  };

  const handleMoveColumn = (index: number, delta: -1 | 1) => {
    setColumns((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  };

  const handleRenameColumn = (colId: string, nextHeader: string) => {
    setColumns((prev) =>
      prev.map((c) => (c.id === colId ? { ...c, header: nextHeader } : c))
    );
  };

  const handleDeleteColumn = (colId: string) => {
    setColumns((prev) => prev.filter((c) => c.id !== colId));
  };

  const handleEnsureDefaultColumns = (): SheetsColumnMapping[] => {
    if (columns.length > 0) return columns;
    const nextCols = buildDefaultSheetsColumns(event, availableParticipantFields);
    setColumns(nextCols);
    setCodeVisible(true);
    setSaveError(null);
    setSaveMessage(null);
    return nextCols;
  };

  const handleLoadDefaults = () => {
    const nextCols = buildDefaultSheetsColumns(event, availableParticipantFields);
    setColumns(nextCols);
    if (colorRules.length === 0) {
      setColorRules(buildDefaultColorRules(nextCols));
      setColorRulesTouched(true);
    }
    setCodeVisible(true);
    setSaveError(null);
    setSaveMessage(null);
  };

  const handleClearAllColumns = () => {
    setColumns([]);
    setSaveError(null);
    setSaveMessage(null);
  };

  const handleChangeColorRules = (next: SheetsColorRule[]) => {
    setColorRules(next);
    setColorRulesTouched(true);
    setSaveMessage(null);
    setSaveError(null);
  };

  const handleSaveAndGenerateCode = async () => {
    setSaveMessage(null);
    setSaveError(null);

    const trimmedUrl = webhookUrl.trim();
    if (trimmedUrl && !isValidAppsScriptUrl(trimmedUrl)) {
      setSaveError(
        'رابط Google Apps Script غير صالح. يجب أن يبدأ بـ https://script.google.com/ وينتهي بـ /exec'
      );
      return;
    }

    if (columns.length === 0) {
      setSaveError('أضف عموداً واحداً على الأقل قبل حفظ التصميم وتوليد الكود.');
      return;
    }

    for (let i = 0; i < columns.length; i += 1) {
      if (!columns[i].header.trim()) {
        setSaveError(`اكتب عنوان العمود رقم ${i + 1}.`);
        return;
      }
    }

    setSaving(true);
    try {
      await updateEventDoc(event.id, {
        sheetsWebhookUrl: trimmedUrl,
        sheetsAutoSync: autoSyncEnabled,
        sheetsColumns: columns,
        ...(colorRulesTouched ? { sheetsColorRules: colorRules } : {}),
      });
      setCodeVisible(true);
      setSaveMessage('تم حفظ أعمدة الشيت وقواعد التلوين وتحديث كود Google Apps Script بنجاح.');
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? `تعذر حفظ إعدادات الشيت في قاعدة البيانات: ${err.message}`
          : 'تعذر حفظ إعدادات الشيت في قاعدة البيانات.'
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(generatedCode);
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2400);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* 1. Connection & Auto-Sync Settings */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                ربط Google Sheet والمزامنة التلقائية
              </h2>
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                عند كل عملية تسليم أو تعديل يتم تحديث الصفوف دفعة واحدة مع الحفاظ على التنسيق والتلوين الشرطي وتمديد نطاقه تلقائياً.
              </p>
            </div>
          </div>

          <div className="text-xs font-semibold text-slate-600 dark:text-neutral-400">
            {event.sheetsWebhookUrl
              ? event.sheetsAutoSync !== false
                ? 'الحالة: مربوط · مزامنة تلقائية مفعّلة'
                : 'الحالة: مربوط · مزامنة يدوية فقط'
              : 'الحالة: غير مربوط بعد'}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-end">
          <div className="lg:col-span-8 min-w-0">
            <label
              htmlFor="sheet-tab-webhook-url"
              className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
            >
              رابط Web App من Google Apps Script
            </label>
            <input
              id="sheet-tab-webhook-url"
              data-testid="sheets-webhook-url-input"
              type="url"
              dir="ltr"
              value={webhookUrl}
              onChange={(e) => {
                setWebhookUrl(e.target.value);
                setSaveError(null);
              }}
              placeholder="https://script.google.com/macros/s/.../exec"
              className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-xs sm:text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>

          <div className="lg:col-span-4 min-w-0 flex flex-wrap items-center gap-2">
            {event.sheetsWebhookUrl && onManualSyncSheets && (
              <button
                type="button"
                disabled={sheetsSyncStatus === 'syncing'}
                onClick={() => void onManualSyncSheets()}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-xs font-bold min-h-[44px] disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw
                  className={`w-4 h-4 ${sheetsSyncStatus === 'syncing' ? 'animate-spin' : ''}`}
                />
                <span>
                  {sheetsSyncStatus === 'syncing' ? 'جاري المزامنة...' : 'مزامنة الشيت الآن'}
                </span>
              </button>
            )}
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-neutral-300 cursor-pointer">
          <input
            type="checkbox"
            checked={autoSyncEnabled}
            onChange={(e) => setAutoSyncEnabled(e.target.checked)}
            className="w-4 h-4 accent-emerald-600 rounded"
          />
          <span>تفعيل المزامنة التلقائية مع الشيت عند كل عملية تسليم أو تعديل</span>
        </label>

        {(sheetsSyncMessage || sheetsLastSyncedAt) && (
          <div
            className={`text-xs font-semibold flex flex-wrap items-center gap-2 ${
              sheetsSyncStatus === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-emerald-700 dark:text-emerald-400'
            }`}
          >
            <span>{sheetsSyncMessage}</span>
            {sheetsLastSyncedAt && (
              <span dir="ltr" className="font-ascii-mono tabular-nums text-slate-500 dark:text-neutral-400">
                {sheetsLastSyncedAt}
              </span>
            )}
          </div>
        )}
      </section>

      {/* 2. Dedicated New Column Creator */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            إضافة عمود جديد للشيت
          </h2>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
            اكتب اسم العمود وحدد هل يأخذ بياناته من ملف الإكسل المرفوع أم من بيانات التسليم على الموقع، ثم اضغط إضافة.
          </p>
        </div>

        <form onSubmit={handleAddColumn} className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Step A: Header title */}
            <div className="lg:col-span-4 min-w-0">
              <label
                htmlFor="new-sheet-col-header"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
              >
                1. اسم العمود في الصف الأول
              </label>
              <input
                id="new-sheet-col-header"
                data-testid="new-sheet-col-header"
                type="text"
                dir="ltr"
                value={newHeader}
                onChange={(e) => {
                  setNewHeader(e.target.value);
                  setCreatorError(null);
                }}
                placeholder="مثال: Tkt Number أو T-Shirt Status"
                className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>

            {/* Step B: Category selector */}
            <div className="lg:col-span-4 min-w-0">
              <div className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5">
                2. يجيب البيانات منين؟
              </div>
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 overflow-x-auto">
                <button
                  type="button"
                  data-testid="source-cat-excel"
                  onClick={() => {
                    setCreatorCategory('excel');
                    setCreatorError(null);
                  }}
                  className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors whitespace-nowrap min-h-[36px] ${
                    creatorCategory === 'excel'
                      ? 'bg-white dark:bg-black text-emerald-700 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  ملف الإكسل
                </button>
                <button
                  type="button"
                  data-testid="source-cat-delivery"
                  onClick={() => {
                    setCreatorCategory('delivery');
                    setCreatorError(null);
                  }}
                  className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors whitespace-nowrap min-h-[36px] ${
                    creatorCategory === 'delivery'
                      ? 'bg-white dark:bg-black text-emerald-700 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  بيانات التسليم
                </button>
                <button
                  type="button"
                  data-testid="source-cat-static"
                  onClick={() => {
                    setCreatorCategory('static');
                    setCreatorError(null);
                  }}
                  className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors whitespace-nowrap min-h-[36px] ${
                    creatorCategory === 'static'
                      ? 'bg-white dark:bg-black text-emerald-700 dark:text-emerald-400 shadow-sm'
                      : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  نص ثابت
                </button>
              </div>
            </div>

            {/* Step C: Specific data field */}
            <div className="lg:col-span-4 min-w-0">
              {creatorCategory === 'excel' && (
                <div className="space-y-2 min-w-0">
                  <label
                    htmlFor="excel-field-select"
                    className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
                  >
                    3. اختر العمود من ملف المتسابقين المرفوع
                  </label>
                  <select
                    id="excel-field-select"
                    data-testid="excel-field-select"
                    value={excelSelection}
                    onChange={(e) => handleSelectExcelOption(e.target.value)}
                    className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2.5 text-xs sm:text-sm text-slate-900 dark:text-white min-h-[44px]"
                  >
                    <option value="__barcode__">الباركود / رقم التذكرة (Tkt Number)</option>
                    <option value="__name__">اسم المتسابق المحسوب (Name)</option>
                    {availableParticipantFields.map((field) => (
                      <option key={field} value={field}>
                        عمود الإكسل: {field}
                      </option>
                    ))}
                    <option value="__custom__">كتابة اسم عمود آخر يدوياً...</option>
                  </select>

                  {excelSelection === '__custom__' && (
                    <input
                      type="text"
                      dir="ltr"
                      value={customExcelField}
                      onChange={(e) => setCustomExcelField(e.target.value)}
                      placeholder="اكتب اسم العمود كما في الإكسل"
                      className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2 text-xs font-ascii-mono text-slate-900 dark:text-white min-h-[40px]"
                    />
                  )}
                </div>
              )}

              {creatorCategory === 'delivery' && (
                <div className="space-y-2 min-w-0">
                  <label
                    htmlFor="delivery-item-select"
                    className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
                  >
                    3. اختر المهمة وما يظهر عنها
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <select
                      id="delivery-item-select"
                      data-testid="delivery-item-select"
                      value={deliveryItemId || event.deliverableItems[0]?.id || ''}
                      onChange={(e) => setDeliveryItemId(e.target.value)}
                      className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-2.5 py-2.5 text-xs text-slate-900 dark:text-white min-h-[44px]"
                    >
                      {event.deliverableItems.length === 0 ? (
                        <option value="">لا توجد مهام بعد</option>
                      ) : (
                        event.deliverableItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name}
                          </option>
                        ))
                      )}
                    </select>

                    <select
                      aria-label="نوع بيانات التسليم"
                      data-testid="delivery-metric-select"
                      value={deliveryMetric}
                      onChange={(e) =>
                        setDeliveryMetric(e.target.value as DeliveryMetricOption)
                      }
                      className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-2.5 py-2.5 text-xs text-slate-900 dark:text-white min-h-[44px]"
                    >
                      {DELIVERY_METRIC_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {creatorCategory === 'static' && (
                <div className="min-w-0">
                  <label
                    htmlFor="static-text-input"
                    className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
                  >
                    3. القيمة النصية الثابتة
                  </label>
                  <input
                    id="static-text-input"
                    type="text"
                    value={staticTextValue}
                    onChange={(e) => setStaticTextValue(e.target.value)}
                    placeholder="مثال: 15th Marathon"
                    className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                  />
                </div>
              )}
            </div>
          </div>

          {creatorError && (
            <p className="text-xs font-bold text-red-600 dark:text-red-400">{creatorError}</p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="submit"
              data-testid="add-sheet-column-btn"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 text-xs sm:text-sm font-bold min-h-[44px] whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة العمود للشيت</span>
            </button>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleLoadDefaults}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-900 px-3.5 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 min-h-[40px] whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>تعبئة الأعمدة الافتراضية تلقائياً</span>
              </button>
              {columns.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllColumns}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 dark:border-red-900 px-3.5 py-2 text-xs font-bold text-red-700 dark:text-red-300 min-h-[40px] whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>مسح كل الأعمدة</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </section>

      {/* 3. Live Sheet Table Preview & Column Order */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-5 min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              شكل الشيت والأعمدة المضافة ({columns.length} عمود)
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              معاينة حية للصف الأول (خلفية برتقالية، خط أسود عريض، توسيط) ومثال لصف بيانات بالترتيب الذي حددته.
            </p>
          </div>
        </div>

        {columns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 dark:border-neutral-700 p-8 text-center space-y-2">
            <p className="text-sm font-bold text-slate-700 dark:text-neutral-200">
              لم تُضف أي أعمدة بعد
            </p>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              استخدم خانة &quot;إضافة عمود جديد للشيت&quot; بالأعلى لإضافة الأعمدة بالترتيب الذي تريده، أو اضغط &quot;تعبئة الأعمدة الافتراضية تلقائياً&quot;.
            </p>
          </div>
        ) : (
          <>
            {/* Live spreadsheet table preview */}
            <div className="w-full max-w-full overflow-x-auto rounded-xl border border-slate-300 dark:border-neutral-700">
              <table dir="ltr" className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-[#FF9800] text-black font-bold">
                    {columns.map((col, idx) => (
                      <th
                        key={col.id}
                        className="border border-amber-600/40 px-4 py-3 text-center align-middle whitespace-nowrap font-bold text-black"
                      >
                        <span className="tabular-nums opacity-65 mr-1.5 text-[10px] font-ascii-mono">
                          {columnIndexToLetter(idx)} ·
                        </span>
                        <span>{col.header || `Column ${idx + 1}`}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(previewSamples.length > 0 ? previewSamples : [undefined]).map((sample, rowIdx) => {
                    const rowValues = columns.map((col) =>
                      previewCellValue(col, sample, event, boothByOrgId)
                    );
                    const cellStyles = evaluateColorRulesForRow(
                      effectiveColorRulesForPreview,
                      columns,
                      rowValues
                    );

                    return (
                      <tr
                        key={sample?.barcode ?? `demo_${rowIdx}`}
                        className="bg-white dark:bg-neutral-950 text-slate-800 dark:text-neutral-200"
                      >
                        {columns.map((col, colIdx) => {
                          const cellStyle = cellStyles[colIdx];
                          return (
                            <td
                              key={col.id}
                              style={
                                cellStyle
                                  ? {
                                      backgroundColor: cellStyle.backgroundColor,
                                      color: cellStyle.color || '#000000',
                                      fontWeight: cellStyle.fontWeight ?? 'normal',
                                    }
                                  : undefined
                              }
                              title={cellStyle?.ruleName}
                              className="border border-slate-200 dark:border-neutral-800 px-4 py-2.5 text-center align-middle whitespace-nowrap font-ascii-mono tabular-nums"
                            >
                              {rowValues[colIdx] || '—'}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Editable ordered column rows */}
            <div className="divide-y divide-slate-200 dark:divide-neutral-800 border border-slate-200 dark:border-neutral-800 rounded-xl overflow-hidden min-w-0">
              {columns.map((col, idx) => (
                <div
                  key={col.id}
                  className="p-3 bg-white dark:bg-neutral-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0"
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="w-8 h-7 rounded-lg bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 flex items-center justify-center text-xs font-bold font-ascii-mono tabular-nums text-slate-700 dark:text-neutral-200 shrink-0">
                      {columnIndexToLetter(idx)}
                    </span>

                    <div className="flex-1 min-w-0 grid grid-cols-1 md:grid-cols-2 gap-2 items-center">
                      <input
                        type="text"
                        dir="ltr"
                        aria-label={`عنوان العمود ${idx + 1}`}
                        value={col.header}
                        onChange={(e) => handleRenameColumn(col.id, e.target.value)}
                        className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-1.5 text-xs font-bold font-ascii-mono text-slate-900 dark:text-white min-h-[38px]"
                      />
                      <div className="text-xs text-slate-500 dark:text-neutral-400 overflow-x-auto whitespace-nowrap pb-0.5">
                        {describeColumnSource(col, event)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                    <button
                      type="button"
                      aria-label="تحريك لأعلى"
                      disabled={idx === 0}
                      onClick={() => handleMoveColumn(idx, -1)}
                      className="p-2 rounded-lg border border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-900 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label="تحريك لأسفل"
                      disabled={idx === columns.length - 1}
                      onClick={() => handleMoveColumn(idx, 1)}
                      className="p-2 rounded-lg border border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-900 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`حذف عمود ${col.header}`}
                      onClick={() => handleDeleteColumn(col.id)}
                      className="p-2 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 min-h-[36px] min-w-[36px] flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {/* 4. Dynamic Conditional Formatting Color Rules */}
      <SheetsColorRulesSection
        columns={columns}
        rules={colorRules}
        onChangeRules={handleChangeColorRules}
        onEnsureColumns={handleEnsureDefaultColumns}
      />

      {/* Save & Generate Section */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-3 min-w-0 overflow-hidden">
        {saveError && (
          <p className="text-xs font-bold text-red-600 dark:text-red-400">{saveError}</p>
        )}
        {saveMessage && (
          <p className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
            {saveMessage}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving}
            data-testid="save-generate-sheets-code-btn"
            onClick={() => void handleSaveAndGenerateCode()}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-5 py-3 text-xs sm:text-sm font-bold min-h-[44px] disabled:opacity-50 whitespace-nowrap"
          >
            <Code2 className="w-4 h-4" />
            <span>{saving ? 'جاري الحفظ...' : 'حفظ الأعمدة والألوان وتوليد كود Apps Script'}</span>
          </button>

          {columns.length > 0 && (
            <button
              type="button"
              onClick={() => setCodeVisible((prev) => !prev)}
              className="rounded-xl border border-slate-300 dark:border-neutral-700 px-4 py-2.5 text-xs font-bold text-slate-700 dark:text-neutral-200 min-h-[44px] whitespace-nowrap"
            >
              {codeVisible ? 'إخفاء الكود' : 'عرض الكود المولّد'}
            </button>
          )}
        </div>
      </section>

      {/* 4. Generated Google Apps Script Code */}
      {codeVisible && columns.length > 0 && (
        <section
          data-testid="generated-apps-script-section"
          className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                كود Google Apps Script الجاهز ({columns.length} عمود)
              </h2>
              <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
                1. افتح Google Sheet ← Extensions ← Apps Script · 2. الصق الكود واحفظه · 3. للربط الأول: Deploy ← New deployment ← Web app (Anyone). ولأي تحديث جديد: Deploy ← Manage deployments ← تعديل ← اختر New version ثم Deploy.
              </p>
            </div>

            <button
              type="button"
              data-testid="copy-apps-script-btn"
              onClick={() => void handleCopyCode()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-xs font-bold min-h-[42px] whitespace-nowrap shrink-0"
            >
              {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              <span>{copiedCode ? 'تم نسخ الكود' : 'نسخ الكود'}</span>
            </button>
          </div>

          <pre
            dir="ltr"
            data-testid="generated-apps-script-code"
            className="w-full max-w-full max-h-96 overflow-auto rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black p-4 text-[11px] font-ascii-mono text-slate-800 dark:text-neutral-200 leading-relaxed"
          >
            {generatedCode}
          </pre>
        </section>
      )}
    </div>
  );
};
