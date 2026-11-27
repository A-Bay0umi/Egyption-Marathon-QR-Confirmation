'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Eye,
  EyeOff,
  Palette,
  Plus,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  buildDefaultColorRules,
  buildSheetsRuleFormula,
  checkColorRulesPriority,
  columnIndexToLetter,
  sortColorRulesByPriority,
} from '@/lib/sheets-sync';
import type {
  SheetsColorCondition,
  SheetsColorRule,
  SheetsColorRuleMode,
  SheetsColumnMapping,
  SheetsDeliveryPresetType,
  SheetsRuleOperator,
} from '@/lib/types';

interface SheetsColorRulesSectionProps {
  columns: SheetsColumnMapping[];
  rules: SheetsColorRule[];
  onChangeRules: (next: SheetsColorRule[]) => void;
  onEnsureColumns?: () => SheetsColumnMapping[];
}

const PRESET_COLOR_SWATCHES: Array<{ label: string; bg: string; font?: string; bold?: boolean }> = [
  { label: 'أخضر (مكتمل)', bg: '#B8E0B8', font: '#000000', bold: false },
  { label: 'أصفر فاقع (جزئي)', bg: '#FFFF00', font: '#000000', bold: true },
  { label: 'أحمر (غير مسلّم)', bg: '#F5B3B3', font: '#000000', bold: false },
  { label: 'برتقالي فاتح', bg: '#FFE0B2', font: '#000000', bold: false },
  { label: 'أزرق سماوي', bg: '#BBDEFB', font: '#000000', bold: false },
  { label: 'بنفسجي فاتح', bg: '#E1BEE7', font: '#000000', bold: false },
  { label: 'رمادي محايد', bg: '#E2E8F0', font: '#0F172A', bold: false },
];

const OPERATOR_OPTIONS: Array<{ value: SheetsRuleOperator; label: string; needsValue: boolean }> = [
  { value: 'is_delivered', label: 'متسلّم (Delivered)', needsValue: false },
  { value: 'is_not_delivered', label: 'غير متسلّم (Not Delivered)', needsValue: false },
  { value: 'equals', label: 'يساوي (=)', needsValue: true },
  { value: 'not_equals', label: 'لا يساوي (<>)', needsValue: true },
  { value: 'contains', label: 'يحتوي على نص', needsValue: true },
  { value: 'not_contains', label: 'لا يحتوي على نص', needsValue: true },
  { value: 'is_empty', label: 'فارغ (Blank)', needsValue: false },
  { value: 'is_not_empty', label: 'غير فارغ', needsValue: false },
];

function createConditionId(): string {
  return `cond_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
}

function normalizeHexInput(val: string, fallback: string): string {
  const clean = val.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(clean) || /^#[0-9A-Fa-f]{3}$/.test(clean)) {
    return clean.toUpperCase();
  }
  return fallback;
}

export const SheetsColorRulesSection: React.FC<SheetsColorRulesSectionProps> = ({
  columns,
  rules,
  onChangeRules,
  onEnsureColumns,
}) => {
  const statusColumns = useMemo(
    () =>
      columns
        .map((c, idx) => ({ col: c, idx, letter: columnIndexToLetter(idx) }))
        .filter((item) => item.col.sourceType === 'item_status'),
    [columns]
  );

  // Builder state
  const [ruleName, setRuleName] = useState('');
  const [mode, setMode] = useState<SheetsColorRuleMode>('preset_delivery');
  const [presetType, setPresetType] = useState<SheetsDeliveryPresetType>('all_delivered');
  const [selectedPresetColIds, setSelectedPresetColIds] = useState<string[]>([]);

  const [logic, setLogic] = useState<'AND' | 'OR'>('AND');
  const [conditions, setConditions] = useState<SheetsColorCondition[]>(() => [
    {
      id: createConditionId(),
      columnId: columns[0]?.id ?? '',
      operator: 'is_delivered',
      value: '',
    },
  ]);

  const [customFormula, setCustomFormula] = useState('=AND($E2="Delivered",$I2="Delivered")');
  const [backgroundColor, setBackgroundColor] = useState('#B8E0B8');
  const [fontColor, setFontColor] = useState('#000000');
  const [bold, setBold] = useState(false);
  const [targetScope, setTargetScope] = useState<'row' | 'column'>('row');
  const [targetColumnId, setTargetColumnId] = useState<string>('');
  const [requireNonEmptyRow, setRequireNonEmptyRow] = useState(true);
  const [formError, setFormError] = useState<string | null>(null);

  const priorityStatus = useMemo(() => checkColorRulesPriority(rules), [rules]);

  const effectivePresetIds = useMemo(() => {
    const validIds = new Set(statusColumns.map((s) => s.col.id));
    const picked = selectedPresetColIds.filter((id) => validIds.has(id));
    return picked.length > 0 ? picked : statusColumns.map((s) => s.col.id);
  }, [selectedPresetColIds, statusColumns]);

  const handleSelectPresetType = (nextType: SheetsDeliveryPresetType) => {
    setPresetType(nextType);
    setFormError(null);
    if (nextType === 'all_delivered') {
      setBackgroundColor('#B8E0B8');
      setFontColor('#000000');
      setBold(false);
    } else if (nextType === 'partial_delivered') {
      setBackgroundColor('#FFFF00');
      setFontColor('#000000');
      setBold(true);
    } else {
      setBackgroundColor('#F5B3B3');
      setFontColor('#000000');
      setBold(false);
    }
  };

  const togglePresetStatusCol = (colId: string) => {
    setSelectedPresetColIds((prev) => {
      const base = prev.length > 0 ? prev : statusColumns.map((s) => s.col.id);
      if (base.includes(colId)) {
        const next = base.filter((id) => id !== colId);
        return next.length > 0 ? next : base;
      }
      return [...base, colId];
    });
  };

  const handleAddConditionRow = () => {
    if (conditions.length >= 15) return;
    const defaultCol = statusColumns[0]?.col.id ?? columns[0]?.id ?? '';
    const isStatus = statusColumns.some((s) => s.col.id === defaultCol);
    setConditions((prev) => [
      ...prev,
      {
        id: createConditionId(),
        columnId: defaultCol,
        operator: isStatus ? 'is_delivered' : 'equals',
        value: '',
      },
    ]);
  };

  const handleUpdateCondition = (
    condId: string,
    patch: Partial<SheetsColorCondition>
  ) => {
    setConditions((prev) =>
      prev.map((c) => (c.id === condId ? { ...c, ...patch } : c))
    );
    setFormError(null);
  };

  const handleRemoveCondition = (condId: string) => {
    setConditions((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== condId) : prev));
  };

  const resolveCondColId = (colId: string, colsList = columns): string => {
    if (colId && colsList.some((col) => col.id === colId)) return colId;
    return colsList[0]?.id ?? '';
  };

  const handleLoadDefaultTrio = () => {
    setFormError(null);
    const activeCols = columns.length > 0 ? columns : onEnsureColumns?.() ?? [];
    if (activeCols.length === 0) {
      setFormError('أضف أعمدة الشيت أولاً لتتمكن من تطبيق قواعد التلوين.');
      return;
    }
    const defaults = buildDefaultColorRules(activeCols);
    onChangeRules(defaults);
  };

  const handleAutoSortPriority = () => {
    onChangeRules(sortColorRulesByPriority(rules));
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (columns.length === 0) {
      setFormError('أضف أعمدة الشيت أولاً (أو اضغط "تطبيق القواعد الافتراضية") لبناء قواعد التلوين.');
      return;
    }

    if (rules.length >= 20) {
      setFormError('الحد الأقصى هو 20 قاعدة تلوين في الشيت.');
      return;
    }

    let computedName = ruleName.trim();
    const resolvedConds: SheetsColorCondition[] = conditions
      .map((c) => ({ ...c, columnId: resolveCondColId(c.columnId) }))
      .filter((c) => Boolean(c.columnId));

    if (mode === 'preset_delivery') {
      if (statusColumns.length === 0) {
        setFormError('أضف عمود "حالة تسليم (Status)" أولاً لاستخدام القوالب الجاهزة.');
        return;
      }
      if (presetType === 'partial_delivered' && effectivePresetIds.length < 2) {
        setFormError('التسليم الجزئي يتطلب وجود عمودَي حالة تسليم على الأقل.');
        return;
      }
      if (!computedName) {
        computedName =
          presetType === 'all_delivered'
            ? 'الكل متسلّم'
            : presetType === 'partial_delivered'
            ? 'تسليم جزئي'
            : 'لم يُسلَّم أي شيء';
      }
    } else if (mode === 'conditions') {
      if (resolvedConds.length === 0) {
        setFormError('اختر عموداً صحيحاً لشرط التلوين.');
        return;
      }
      for (const cond of resolvedConds) {
        const opDef = OPERATOR_OPTIONS.find((o) => o.value === cond.operator);
        if (opDef?.needsValue && !(cond.value ?? '').trim()) {
          setFormError('اكتب القيمة المطلوبة للمقارنة في الشرط.');
          return;
        }
      }
      if (!computedName) {
        computedName = `شرط مخصص (${resolvedConds.length})`;
      }
    } else {
      if (!customFormula.trim()) {
        setFormError('اكتب معادلة Google Sheets (تبدأ بـ =).');
        return;
      }
      if (!computedName) {
        computedName = 'معادلة مخصصة';
      }
    }

    const effectiveTargetColId =
      targetScope === 'column' ? resolveCondColId(targetColumnId) : '';

    if (targetScope === 'column' && !effectiveTargetColId) {
      setFormError('اختر العمود المراد تلوينه أو اختر تلوين الصف بالكامل.');
      return;
    }

    const safeBg = normalizeHexInput(backgroundColor, '#B8E0B8');
    const safeFont = fontColor.trim() ? normalizeHexInput(fontColor, '#000000') : '';

    const newRule: SheetsColorRule = {
      id: `color_rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      name: computedName,
      enabled: true,
      mode,
      ...(mode === 'preset_delivery'
        ? { presetType, presetColumnIds: effectivePresetIds }
        : {}),
      logic,
      conditions: mode === 'conditions' ? resolvedConds : [],
      ...(mode === 'custom_formula'
        ? {
            customFormula: customFormula.trim().startsWith('=')
              ? customFormula.trim()
              : `=${customFormula.trim()}`,
          }
        : {}),
      requireNonEmptyRow,
      backgroundColor: safeBg,
      ...(safeFont ? { fontColor: safeFont } : {}),
      bold,
      targetScope,
      ...(targetScope === 'column' ? { targetColumnId: effectiveTargetColId } : {}),
    };

    const nextRules = sortColorRulesByPriority([...rules, newRule]);
    onChangeRules(nextRules);
    setRuleName('');
  };

  const handleMoveRule = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChangeRules(next);
  };

  const handleToggleRule = (ruleId: string) => {
    onChangeRules(
      rules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleDeleteRule = (ruleId: string) => {
    onChangeRules(rules.filter((r) => r.id !== ruleId));
  };

  const colIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    columns.forEach((c, idx) => m.set(c.id, idx));
    return m;
  }, [columns]);

  return (
    <section
      data-testid="sheets-color-rules-section"
      className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-5 min-w-0 overflow-hidden"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Palette className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              قواعد تلوين الصفوف التلقائي ({rules.length} قاعدة)
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5">
              حدد ألوان الصفوف حسب حالة التسليم أو أي شروط أخرى بترتيب الأولوية من الأعلى للأسفل — وتتحدث حروف الأعمدة تلقائياً مع أي تعديل في الجدول.
            </p>
          </div>
        </div>

        <button
          type="button"
          data-testid="load-default-color-rules-btn"
          disabled={columns.length === 0 && !onEnsureColumns}
          onClick={handleLoadDefaultTrio}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold min-h-[40px] disabled:opacity-40 whitespace-nowrap shrink-0"
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>تطبيق القواعد الافتراضية (أخضر + أصفر + أحمر)</span>
        </button>
      </div>

      {/* Rule Creator Form */}
      <form
        onSubmit={handleAddRule}
        className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-slate-50/70 dark:bg-neutral-900/50 p-3.5 sm:p-4 space-y-4 min-w-0"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          {/* Mode selector */}
          <div className="lg:col-span-7 min-w-0">
            <div className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5">
              1. اختر طريقة بناء الشرط
            </div>
            <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-white dark:bg-black border border-slate-200 dark:border-neutral-800 overflow-x-auto">
              <button
                type="button"
                data-testid="rule-mode-preset"
                onClick={() => {
                  setMode('preset_delivery');
                  setFormError(null);
                }}
                className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                  mode === 'preset_delivery'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                قوالب التسليم
              </button>
              <button
                type="button"
                data-testid="rule-mode-conditions"
                onClick={() => {
                  setMode('conditions');
                  setFormError(null);
                  if (conditions.length === 0 && columns[0]) {
                    setConditions([
                      {
                        id: createConditionId(),
                        columnId: columns[0].id,
                        operator: columns[0].sourceType === 'item_status' ? 'is_delivered' : 'equals',
                        value: '',
                      },
                    ]);
                  }
                }}
                className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                  mode === 'conditions'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                شروط متعددة (AND/OR)
              </button>
              <button
                type="button"
                data-testid="rule-mode-formula"
                onClick={() => {
                  setMode('custom_formula');
                  setFormError(null);
                }}
                className={`rounded-lg px-2 py-2 text-xs font-bold transition-colors whitespace-nowrap min-h-[38px] ${
                  mode === 'custom_formula'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                معادلة مخصصة
              </button>
            </div>
          </div>

          {/* Rule Name */}
          <div className="lg:col-span-5 min-w-0">
            <label
              htmlFor="new-color-rule-name"
              className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
            >
              2. اسم القاعدة (اختياري)
            </label>
            <input
              id="new-color-rule-name"
              type="text"
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="مثال: VIP متسلم تيشيرت فقط"
              className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-3 py-2 text-sm text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>
        </div>

        {/* Mode A: Preset Delivery Templates */}
        {mode === 'preset_delivery' && (
          <div className="space-y-3 min-w-0">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleSelectPresetType('all_delivered')}
                className={`rounded-xl border p-3 text-right transition-colors min-w-0 ${
                  presetType === 'all_delivered'
                    ? 'border-emerald-600 bg-emerald-50/70 dark:bg-emerald-950/30'
                    : 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-black'
                }`}
              >
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  الكل متسلّم
                </div>
                <div className="text-[11px] text-slate-500 dark:text-neutral-400 mt-0.5">
                  كل المهام المختارة حالتها Delivered
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPresetType('partial_delivered')}
                className={`rounded-xl border p-3 text-right transition-colors min-w-0 ${
                  presetType === 'partial_delivered'
                    ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/30'
                    : 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-black'
                }`}
              >
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  تسليم جزئي
                </div>
                <div className="text-[11px] text-slate-500 dark:text-neutral-400 mt-0.5">
                  مهمة متسلمة على الأقل وأخرى لأ
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPresetType('none_delivered')}
                className={`rounded-xl border p-3 text-right transition-colors min-w-0 ${
                  presetType === 'none_delivered'
                    ? 'border-red-500 bg-red-50/70 dark:bg-red-950/30'
                    : 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-black'
                }`}
              >
                <div className="text-xs font-bold text-slate-900 dark:text-white">
                  لم يُسلَّم أي شيء
                </div>
                <div className="text-[11px] text-slate-500 dark:text-neutral-400 mt-0.5">
                  ولا مهمة متسلمة (مع حماية الصف الفارغ)
                </div>
              </button>
            </div>

            {statusColumns.length > 0 ? (
              <div className="space-y-1.5 min-w-0">
                <div className="text-[11px] font-bold text-slate-600 dark:text-neutral-400">
                  أعمدة الحالة المشمولة في هذا القالب:
                </div>
                <div className="flex flex-wrap gap-2 min-w-0">
                  {statusColumns.map(({ col, letter }) => (
                    <label
                      key={col.id}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-black px-2.5 py-1.5 text-xs font-semibold cursor-pointer max-w-full overflow-x-auto whitespace-nowrap"
                    >
                      <input
                        type="checkbox"
                        checked={effectivePresetIds.includes(col.id)}
                        onChange={() => togglePresetStatusCol(col.id)}
                        className="w-4 h-4 accent-emerald-600 rounded shrink-0"
                      />
                      <span dir="ltr" className="font-ascii-mono text-emerald-700 dark:text-emerald-400 font-bold">
                        {letter}
                      </span>
                      <span>· {col.header}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-amber-700 dark:text-amber-400 font-semibold">
                أضف أعمدة من نوع &quot;حالة التسليم (Status)&quot; بالأعلى ليتم ربط القالب بها تلقائياً.
              </p>
            )}
          </div>
        )}

        {/* Mode B: Multi-condition AND / OR Builder */}
        {mode === 'conditions' && (
          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">
                  منطق الربط:
                </span>
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-neutral-800 bg-white dark:bg-black p-0.5">
                  <button
                    type="button"
                    data-testid="logic-and-btn"
                    onClick={() => setLogic('AND')}
                    className={`rounded-md px-3 py-1 text-xs font-bold whitespace-nowrap ${
                      logic === 'AND'
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-black'
                        : 'text-slate-600 dark:text-neutral-400'
                    }`}
                  >
                    كل الشروط معاً (AND)
                  </button>
                  <button
                    type="button"
                    data-testid="logic-or-btn"
                    onClick={() => setLogic('OR')}
                    className={`rounded-md px-3 py-1 text-xs font-bold whitespace-nowrap ${
                      logic === 'OR'
                        ? 'bg-slate-900 dark:bg-white text-white dark:text-black'
                        : 'text-slate-600 dark:text-neutral-400'
                    }`}
                  >
                    أي شرط واحد (OR)
                  </button>
                </div>
              </div>

              <button
                type="button"
                data-testid="add-condition-row-btn"
                onClick={handleAddConditionRow}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-3 py-1.5 text-xs font-bold text-slate-700 dark:text-neutral-200 min-h-[36px] whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>إضافة شرط فرعي</span>
              </button>
            </div>

            <div className="space-y-2 min-w-0">
              {conditions.map((cond, idx) => {
                const opMeta = OPERATOR_OPTIONS.find((o) => o.value === cond.operator);
                return (
                  <div
                    key={cond.id}
                    className="grid grid-cols-1 md:grid-cols-12 gap-2 items-center rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-black p-2.5 min-w-0"
                  >
                    <div className="md:col-span-4 min-w-0">
                      <select
                        aria-label={`عمود الشرط ${idx + 1}`}
                        value={resolveCondColId(cond.columnId)}
                        onChange={(e) =>
                          handleUpdateCondition(cond.id, { columnId: e.target.value })
                        }
                        className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-950 px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-white min-h-[40px]"
                      >
                        {columns.map((c, cIdx) => (
                          <option key={c.id} value={c.id}>
                            {columnIndexToLetter(cIdx)} · {c.header}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-4 min-w-0">
                      <select
                        aria-label={`نوع المقارنة ${idx + 1}`}
                        value={cond.operator}
                        onChange={(e) =>
                          handleUpdateCondition(cond.id, {
                            operator: e.target.value as SheetsRuleOperator,
                          })
                        }
                        className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-950 px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-white min-h-[40px]"
                      >
                        {OPERATOR_OPTIONS.map((op) => (
                          <option key={op.value} value={op.value}>
                            {op.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="md:col-span-3 min-w-0">
                      {opMeta?.needsValue ? (
                        <input
                          type="text"
                          value={cond.value ?? ''}
                          onChange={(e) =>
                            handleUpdateCondition(cond.id, { value: e.target.value })
                          }
                          placeholder="القيمة (مثال: VIP)"
                          className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-neutral-950 px-2.5 py-2 text-xs text-slate-900 dark:text-white min-h-[40px]"
                        />
                      ) : (
                        <div className="text-[11px] text-slate-400 dark:text-neutral-500 px-2">
                          لا يحتاج قيمة إضافية
                        </div>
                      )}
                    </div>

                    <div className="md:col-span-1 flex justify-end">
                      <button
                        type="button"
                        disabled={conditions.length <= 1}
                        onClick={() => handleRemoveCondition(cond.id)}
                        aria-label="حذف الشرط الفرعي"
                        className="p-2 rounded-lg text-slate-400 hover:text-red-600 disabled:opacity-30 min-h-[38px] min-w-[38px] flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Mode C: Custom Google Sheets Formula */}
        {mode === 'custom_formula' && (
          <div className="space-y-2 min-w-0">
            <label
              htmlFor="custom-sheet-formula-input"
              className="block text-xs font-bold text-slate-700 dark:text-neutral-300"
            >
              معادلة Google Sheets (بدءاً من الصف الثاني)
            </label>
            <input
              id="custom-sheet-formula-input"
              type="text"
              dir="ltr"
              value={customFormula}
              onChange={(e) => {
                setCustomFormula(e.target.value);
                setFormError(null);
              }}
              placeholder='=AND(NOT(ISBLANK($A2)),TRIM($E2)="Delivered",TRIM($C2)="VIP")'
              className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-3.5 py-2.5 text-xs font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
            />
            {columns.length > 0 && (
              <div
                dir="ltr"
                className="text-[11px] font-ascii-mono text-slate-500 dark:text-neutral-400 overflow-x-auto whitespace-nowrap pb-1"
              >
                {columns
                  .map((c, idx) => `${columnIndexToLetter(idx)}: ${c.header}`)
                  .join('  |  ')}
              </div>
            )}
          </div>
        )}

        {/* Visual Style + Scope */}
        <div className="pt-3 border-t border-slate-200 dark:border-neutral-800 space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-slate-700 dark:text-neutral-300">
              3. لون الصف:
            </span>
            {PRESET_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch.bg}
                type="button"
                onClick={() => {
                  setBackgroundColor(swatch.bg);
                  if (swatch.font) setFontColor(swatch.font);
                  if (swatch.bold !== undefined) setBold(swatch.bold);
                }}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-bold transition-all min-h-[34px] whitespace-nowrap ${
                  backgroundColor.toUpperCase() === swatch.bg.toUpperCase()
                    ? 'border-slate-900 dark:border-white ring-1 ring-slate-900 dark:ring-white'
                    : 'border-slate-300 dark:border-neutral-700 bg-white dark:bg-black'
                }`}
              >
                <span
                  className="w-3.5 h-3.5 rounded-sm border border-black/20 shrink-0"
                  style={{ backgroundColor: swatch.bg }}
                />
                <span className="text-slate-800 dark:text-neutral-200">{swatch.label}</span>
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end min-w-0">
            <div className="min-w-0">
              <label
                htmlFor="rule-bg-picker"
                className="block text-[11px] font-bold text-slate-600 dark:text-neutral-400 mb-1"
              >
                لون الخلفية المخصص
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="rule-bg-picker"
                  type="color"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-slate-300 dark:border-neutral-700 p-0.5 bg-white cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  dir="ltr"
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-2.5 py-2 text-xs font-ascii-mono text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>
            </div>

            <div className="min-w-0">
              <label
                htmlFor="rule-font-picker"
                className="block text-[11px] font-bold text-slate-600 dark:text-neutral-400 mb-1"
              >
                لون الخط
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="rule-font-picker"
                  type="color"
                  value={fontColor || '#000000'}
                  onChange={(e) => setFontColor(e.target.value)}
                  className="w-10 h-10 rounded-lg border border-slate-300 dark:border-neutral-700 p-0.5 bg-white cursor-pointer shrink-0"
                />
                <input
                  type="text"
                  dir="ltr"
                  value={fontColor}
                  onChange={(e) => setFontColor(e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-2.5 py-2 text-xs font-ascii-mono text-slate-900 dark:text-white min-h-[40px]"
                />
              </div>
            </div>

            <div className="min-w-0">
              <label
                htmlFor="rule-scope-select"
                className="block text-[11px] font-bold text-slate-600 dark:text-neutral-400 mb-1"
              >
                نطاق التلوين
              </label>
              <select
                id="rule-scope-select"
                value={targetScope === 'column' ? resolveCondColId(targetColumnId) || '__row__' : '__row__'}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '__row__') {
                    setTargetScope('row');
                    setTargetColumnId('');
                  } else {
                    setTargetScope('column');
                    setTargetColumnId(v);
                  }
                }}
                className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-white min-h-[40px]"
              >
                <option value="__row__">الصف بالكامل (كل الأعمدة)</option>
                {columns.map((c, idx) => (
                  <option key={c.id} value={c.id}>
                    عمود فقط: {columnIndexToLetter(idx)} · {c.header}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1.5 min-w-0">
              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={bold}
                  onChange={(e) => setBold(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded"
                />
                <span>خط عريض (Bold)</span>
              </label>
              <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-neutral-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireNonEmptyRow}
                  onChange={(e) => setRequireNonEmptyRow(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded"
                />
                <span>حماية الصفوف الفارغة (ISBLANK)</span>
              </label>
            </div>
          </div>
        </div>

        {formError && (
          <p className="text-xs font-bold text-red-600 dark:text-red-400">{formError}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="submit"
            data-testid="add-color-rule-btn"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-5 py-2.5 text-xs sm:text-sm font-bold min-h-[44px] whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة قاعدة التلوين</span>
          </button>

          <div
            className="rounded-lg border border-black/15 px-3 py-1.5 text-xs tabular-nums"
            style={{
              backgroundColor,
              color: fontColor || '#000000',
              fontWeight: bold ? 'bold' : 'normal',
            }}
          >
            معاينة اللون: 15th Sharm Marathon
          </div>
        </div>
      </form>

      {/* Priority Order Warning */}
      {priorityStatus.hasIssue && (
        <div
          role="alert"
          className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-start gap-2 text-amber-900 dark:text-amber-200 font-semibold min-w-0">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{priorityStatus.message}</span>
          </div>
          <button
            type="button"
            data-testid="auto-sort-color-rules-btn"
            onClick={handleAutoSortPriority}
            className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 text-xs font-bold whitespace-nowrap shrink-0"
          >
            <Wand2 className="w-3.5 h-3.5" />
            <span>ترتيب الأولوية تلقائياً</span>
          </button>
        </div>
      )}

      {/* Rules List */}
      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 dark:border-neutral-700 p-6 text-center space-y-1.5">
          <p className="text-xs font-bold text-slate-700 dark:text-neutral-200">
            لم تُضف قواعد تلوين مخصصة بعد
          </p>
          <p className="text-[11px] text-slate-500 dark:text-neutral-400">
            اضغط &quot;تطبيق القواعد الافتراضية (أخضر + أصفر + أحمر)&quot; بالأعلى أو أنشئ شرطك الخاص.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-neutral-800 border border-slate-200 dark:border-neutral-800 rounded-xl overflow-hidden min-w-0">
          {rules.map((rule, idx) => {
            const compiledFormula = buildSheetsRuleFormula(rule, columns, 2);
            const scopeColIdx =
              rule.targetScope === 'column' && rule.targetColumnId
                ? colIndexMap.get(rule.targetColumnId)
                : undefined;

            return (
              <div
                key={rule.id}
                data-testid={`color-rule-row-${idx}`}
                className={`p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0 transition-opacity ${
                  rule.enabled
                    ? 'bg-white dark:bg-neutral-950'
                    : 'bg-slate-50 dark:bg-neutral-900 opacity-60'
                }`}
              >
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <span className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 flex items-center justify-center text-xs font-bold font-ascii-mono tabular-nums text-slate-700 dark:text-neutral-200 shrink-0 mt-0.5">
                    #{idx + 1}
                  </span>

                  <span
                    className="w-7 h-7 rounded-lg border border-black/20 flex items-center justify-center text-[11px] shrink-0 mt-0.5"
                    style={{
                      backgroundColor: rule.backgroundColor,
                      color: rule.fontColor || '#000000',
                      fontWeight: rule.bold ? 'bold' : 'normal',
                    }}
                    title="لون القاعدة"
                  >
                    Aa
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="text-xs font-bold text-slate-900 dark:text-white overflow-x-auto whitespace-nowrap">
                        {rule.name}
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-neutral-400">
                        ·{' '}
                        {rule.targetScope === 'column'
                          ? scopeColIdx !== undefined
                            ? `العمود ${columnIndexToLetter(scopeColIdx)} (${columns[scopeColIdx]?.header})`
                            : 'عمود محذوف!'
                          : 'الصف بالكامل'}
                      </span>
                    </div>

                    <div
                      dir="ltr"
                      className="text-[11px] font-ascii-mono text-slate-600 dark:text-neutral-400 overflow-x-auto whitespace-nowrap pb-0.5"
                    >
                      {compiledFormula || 'تحقق من الأعمدة المختارة لهذه القاعدة'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                  <button
                    type="button"
                    aria-label="أولوية أعلى"
                    disabled={idx === 0}
                    onClick={() => handleMoveRule(idx, -1)}
                    className="p-2 rounded-lg border border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-900 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    <ArrowUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="أولوية أقل"
                    disabled={idx === rules.length - 1}
                    onClick={() => handleMoveRule(idx, 1)}
                    className="p-2 rounded-lg border border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-900 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    <ArrowDown className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={rule.enabled ? 'تعطيل القاعدة' : 'تفعيل القاعدة'}
                    onClick={() => handleToggleRule(rule.id)}
                    className="p-2 rounded-lg border border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-900 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    {rule.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button
                    type="button"
                    aria-label={`حذف قاعدة ${rule.name}`}
                    onClick={() => handleDeleteRule(rule.id)}
                    className="p-2 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 min-h-[36px] min-w-[36px] flex items-center justify-center"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
