'use client';

import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  Copy,
  Edit3,
  Link2,
  ListChecks,
  Lock,
  MessageCircle,
  MessageSquareText,
  Phone,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Unlock,
  Unlink,
  UserPlus,
  X,
} from 'lucide-react';
import {
  buildOrganizerMagicUrl,
  buildOrganizerWhatsAppHref,
  buildOrganizerWhatsAppMessage,
  normalizeWhatsAppPhone,
} from '@/lib/admin-auth';
import {
  createOrganizerDoc,
  deleteOrganizerDoc,
  updateEventDoc,
  updateOrganizerDoc,
} from '@/lib/firestore-store';
import {
  formatArabicDateTime,
  fromDateTimeLocalValue,
  getEventRegistrationState,
  toDateTimeLocalValue,
  wouldCreateDependencyCycle,
} from '@/lib/marathon-logic';
import type {
  DeliverableItem,
  MarathonEvent,
  Organizer,
} from '@/lib/types';

interface EventSettingsOrganizersTabProps {
  event: MarathonEvent;
  organizers: Organizer[];
}

export const EventSettingsOrganizersTab: React.FC<EventSettingsOrganizersTabProps> = ({
  event,
  organizers,
}) => {
  // Registration open/close schedule state
  const [regStatus, setRegStatus] = useState<'auto' | 'open' | 'closed'>(
    event.registrationStatus ?? 'auto'
  );
  const [opensAtLocal, setOpensAtLocal] = useState(() =>
    toDateTimeLocalValue(event.registrationOpensAt)
  );
  const [closesAtLocal, setClosesAtLocal] = useState(() =>
    toDateTimeLocalValue(event.registrationClosesAt)
  );
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [scheduleSavedMsg, setScheduleSavedMsg] = useState<string | null>(null);

  // Deliverable Tasks management
  const [newTaskName, setNewTaskName] = useState('');
  const [savingTask, setSavingTask] = useState(false);

  // Create Organizer state
  const [orgName, setOrgName] = useState('');
  const [boothName, setBoothName] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [assignedItems, setAssignedItems] = useState<string[]>(
    event.deliverableItems.map((i) => i.id)
  );
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Edit Organizer Roles inline
  const [editingOrgId, setEditingOrgId] = useState<string | null>(null);
  const [editingRoles, setEditingRoles] = useState<string[]>([]);

  // Clipboard feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const liveRegState = getEventRegistrationState({
    isActive: event.isActive,
    registrationStatus: regStatus,
    registrationOpensAt: fromDateTimeLocalValue(opensAtLocal) || undefined,
    registrationClosesAt: fromDateTimeLocalValue(closesAtLocal) || undefined,
  });

  const persistSchedule = async (
    nextStatus: 'auto' | 'open' | 'closed',
    nextOpensLocal: string,
    nextClosesLocal: string
  ) => {
    setSavingSchedule(true);
    setScheduleSavedMsg(null);
    try {
      await updateEventDoc(event.id, {
        registrationStatus: nextStatus,
        registrationOpensAt: fromDateTimeLocalValue(nextOpensLocal),
        registrationClosesAt: fromDateTimeLocalValue(nextClosesLocal),
      });
      setScheduleSavedMsg('تم حفظ مواعيد الفتح والإغلاق بنجاح');
      setTimeout(() => setScheduleSavedMsg(null), 2500);
    } finally {
      setSavingSchedule(false);
    }
  };

  const handleSelectRegMode = async (mode: 'auto' | 'open' | 'closed') => {
    setRegStatus(mode);
    await persistSchedule(mode, opensAtLocal, closesAtLocal);
  };

  const handleSaveSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    await persistSchedule(regStatus, opensAtLocal, closesAtLocal);
  };

  const handleClearSchedule = async () => {
    setRegStatus('auto');
    setOpensAtLocal('');
    setClosesAtLocal('');
    await persistSchedule('auto', '', '');
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newTaskName.trim();
    if (!clean) return;
    setSavingTask(true);
    try {
      const id = `task_${Date.now().toString(36)}`;
      const nextItems: DeliverableItem[] = [...event.deliverableItems, { id, name: clean }];
      await updateEventDoc(event.id, { deliverableItems: nextItems });
      setNewTaskName('');
      setAssignedItems((prev) => [...prev, id]);
    } finally {
      setSavingTask(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    const nextItems = event.deliverableItems
      .filter((i) => i.id !== taskId)
      .map((i) => (i.dependsOnItemId === taskId ? { id: i.id, name: i.name } : i));
    await updateEventDoc(event.id, { deliverableItems: nextItems });
    setAssignedItems((prev) => prev.filter((id) => id !== taskId));
  };

  const handleSetTaskPrerequisite = async (taskId: string, prereqId: string) => {
    if (prereqId && wouldCreateDependencyCycle(event.deliverableItems, taskId, prereqId)) {
      return;
    }
    const nextItems = event.deliverableItems.map((item) => {
      if (item.id !== taskId) return item;
      return prereqId ? { ...item, dependsOnItemId: prereqId } : { id: item.id, name: item.name };
    });
    await updateEventDoc(event.id, { deliverableItems: nextItems });
  };

  const handleMoveTask = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= event.deliverableItems.length) return;
    const next = [...event.deliverableItems];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    await updateEventDoc(event.id, { deliverableItems: next });
  };

  const handleChainAllTasks = async () => {
    const next = event.deliverableItems.map((item, idx) =>
      idx === 0
        ? { id: item.id, name: item.name }
        : { ...item, dependsOnItemId: event.deliverableItems[idx - 1].id }
    );
    await updateEventDoc(event.id, { deliverableItems: next });
  };

  const handleUnchainAllTasks = async () => {
    const next = event.deliverableItems.map((item) => ({ id: item.id, name: item.name }));
    await updateEventDoc(event.id, { deliverableItems: next });
  };

  const toggleCreateRole = (id: string) => {
    setAssignedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCreateOrganizer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!orgName.trim()) {
      setFormError('يرجى إدخال اسم المنظم');
      return;
    }
    if (event.deliverableItems.length === 0) {
      setFormError('أضف مهمة تسليم واحدة على الأقل أعلاه أولاً');
      return;
    }
    if (assignedItems.length === 0) {
      setFormError('اختر وظيفة / مهمة واحدة على الأقل لهذا المنظم');
      return;
    }
    setFormError(null);
    setCreatingOrg(true);
    try {
      const cleanPhone = normalizeWhatsAppPhone(whatsappPhone);
      await createOrganizerDoc({
        eventId: event.id,
        name: orgName.trim(),
        boothName: boothName.trim(),
        whatsappPhone: cleanPhone || undefined,
        assignedItems,
      });
      setOrgName('');
      setBoothName('');
      setWhatsappPhone('');
    } finally {
      setCreatingOrg(false);
    }
  };

  const startEditingRoles = (org: Organizer) => {
    setEditingOrgId(org.id);
    setEditingRoles(org.assignedItems);
  };

  const toggleEditRole = (id: string) => {
    setEditingRoles((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const saveEditedRoles = async (org: Organizer) => {
    if (editingRoles.length === 0) return;
    await updateOrganizerDoc(org.id, { assignedItems: editingRoles });
    setEditingOrgId(null);
  };

  const getMagicLink = (org: Organizer) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    return buildOrganizerMagicUrl(origin, org, event.id);
  };

  const handleCopyLink = async (org: Organizer) => {
    try {
      await navigator.clipboard.writeText(getMagicLink(org));
      setCopiedId(org.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  const handleCopyMessage = async (org: Organizer) => {
    try {
      const msg = buildOrganizerWhatsAppMessage(getMagicLink(org), org, event);
      await navigator.clipboard.writeText(msg);
      setCopiedMsgId(org.id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Section 0: Registration Open / Close Schedule */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarClock className="w-5 h-5 text-emerald-600 shrink-0" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                مواعيد وحالة فتح وإغلاق التسجيل للمنظمين
              </h2>
              <p className="text-xs text-slate-500 dark:text-neutral-400">
                حدد متى يفتح الإيفنت ومتى يغلق؛ إذا كان مغلقاً أو لم يحن موعده سيظهر للمنظم أن التسجيل لم يفتح بعد.
              </p>
            </div>
          </div>

          <span
            data-testid="schedule-live-badge"
            className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold shrink-0 ${
              liveRegState.isOpen
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
            }`}
          >
            {liveRegState.isOpen ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
            <span>{liveRegState.label}</span>
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(
            [
              { id: 'auto', label: 'تلقائي بالمواعيد' },
              { id: 'open', label: 'مفتوح الآن' },
              { id: 'closed', label: 'إغلاق مؤقت' },
            ] as const
          ).map((mode) => (
            <button
              key={mode.id}
              type="button"
              disabled={savingSchedule}
              data-testid={`schedule-mode-${mode.id}`}
              onClick={() => void handleSelectRegMode(mode.id)}
              className={`rounded-xl border px-3 py-2.5 text-xs font-bold min-h-[44px] transition-colors ${
                regStatus === mode.id
                  ? mode.id === 'closed'
                    ? 'border-red-600 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300'
                    : 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                  : 'border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black text-slate-700 dark:text-neutral-300'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <form onSubmit={(e) => void handleSaveSchedule(e)} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <label
                htmlFor="registration-opens-input"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
              >
                موعد فتح التسجيل (اختياري)
              </label>
              <input
                id="registration-opens-input"
                data-testid="registration-opens-input"
                type="datetime-local"
                dir="ltr"
                value={opensAtLocal}
                onChange={(e) => setOpensAtLocal(e.target.value)}
                className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-xs sm:text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>

            <div className="min-w-0">
              <label
                htmlFor="registration-closes-input"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
              >
                موعد إغلاق التسجيل (اختياري)
              </label>
              <input
                id="registration-closes-input"
                data-testid="registration-closes-input"
                type="datetime-local"
                dir="ltr"
                value={closesAtLocal}
                onChange={(e) => setClosesAtLocal(e.target.value)}
                className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-xs sm:text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>
          </div>

          {(event.registrationOpensAt || event.registrationClosesAt) && (
            <div className="text-xs text-slate-500 dark:text-neutral-400 flex flex-wrap gap-x-4 gap-y-1">
              {event.registrationOpensAt && (
                <span>يفتح: {formatArabicDateTime(event.registrationOpensAt)}</span>
              )}
              {event.registrationClosesAt && (
                <span>يُغلق: {formatArabicDateTime(event.registrationClosesAt)}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={savingSchedule}
              data-testid="save-schedule-btn"
              className="rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-4 py-2.5 text-xs font-bold min-h-[42px] disabled:opacity-50"
            >
              {savingSchedule ? 'جاري الحفظ...' : 'حفظ مواعيد الفتح والإغلاق'}
            </button>
            {(opensAtLocal || closesAtLocal || regStatus !== 'auto') && (
              <button
                type="button"
                disabled={savingSchedule}
                data-testid="clear-schedule-btn"
                onClick={() => void handleClearSchedule()}
                className="rounded-xl border border-slate-300 dark:border-neutral-700 px-3.5 py-2.5 text-xs font-bold text-slate-700 dark:text-neutral-300 min-h-[42px]"
              >
                مسح المواعيد (مفتوح دائماً)
              </button>
            )}
            {scheduleSavedMsg && (
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">
                {scheduleSavedMsg}
              </span>
            )}
          </div>
        </form>
      </section>

      {/* Section 1: Tasks / Deliverable Items Settings */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-4 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <ListChecks className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              إعدادات المهام والوظائف في هذا الإيفنت
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              المهام التي يتم توزيعها على المتسابقين (مثل: التيشيرت، رقم الصدر، الشنطة، الميدالية...)
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleAddTask(e)} className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="text"
            value={newTaskName}
            onChange={(e) => setNewTaskName(e.target.value)}
            placeholder="أضف مهمة جديدة (مثال: التيشيرت)"
            className="flex-1 min-w-0 w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
          />
          <button
            type="submit"
            disabled={savingTask || !newTaskName.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-5 py-2.5 text-xs font-bold min-h-[44px] whitespace-nowrap disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>إضافة مهمة</span>
          </button>
        </form>

        {event.deliverableItems.length >= 2 && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleChainAllTasks()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-600/40 bg-emerald-50/70 dark:bg-emerald-950/30 px-3 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100 dark:hover:bg-emerald-950/60 min-h-[38px]"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>ربط بالتسلسل التلقائي (1 ← 2 ← 3)</span>
            </button>
            {event.deliverableItems.some((i) => Boolean(i.dependsOnItemId)) && (
              <button
                type="button"
                onClick={() => void handleUnchainAllTasks()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 px-3 py-2 text-xs font-bold text-slate-600 dark:text-neutral-300 hover:bg-slate-100 dark:hover:bg-neutral-900 min-h-[38px]"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>إلغاء كل القيود</span>
              </button>
            )}
          </div>
        )}

        {event.deliverableItems.length === 0 ? (
          <p className="text-xs text-slate-500 dark:text-neutral-400">
            لا توجد مهام مضافة حتى الآن. أضف مهمة واحدة على الأقل لتوزيعها على المنظمين.
          </p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-neutral-800 border border-slate-200 dark:border-neutral-800 rounded-xl overflow-hidden">
            {event.deliverableItems.map((item, idx) => {
              const availablePrereqs = event.deliverableItems.filter(
                (cand) =>
                  cand.id !== item.id &&
                  !wouldCreateDependencyCycle(event.deliverableItems, item.id, cand.id)
              );

              return (
                <div
                  key={item.id}
                  className="px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50 dark:bg-black/40"
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    <span className="inline-flex items-center justify-center rounded-lg bg-slate-200/80 dark:bg-neutral-800 px-2 py-1 text-[11px] font-bold font-mono-num text-slate-700 dark:text-neutral-200 shrink-0">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white overflow-x-auto whitespace-nowrap">
                      {item.name}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0 max-w-full min-w-0">
                    {availablePrereqs.length > 0 && (
                      <select
                        aria-label={`الشرط المسبق لمهمة ${item.name}`}
                        value={item.dependsOnItemId ?? ''}
                        onChange={(e) => void handleSetTaskPrerequisite(item.id, e.target.value)}
                        className="w-full sm:w-auto min-w-0 max-w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-3 py-1.5 text-xs font-semibold text-slate-800 dark:text-neutral-200 min-h-[38px]"
                      >
                        <option value="">بدون شرط مسبق</option>
                        {availablePrereqs.map((prereq) => (
                          <option key={prereq.id} value={prereq.id}>
                            بعد إتمام: {prereq.name}
                          </option>
                        ))}
                      </select>
                    )}

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => void handleMoveTask(idx, -1)}
                        aria-label={`تقديم ${item.name}`}
                        className="p-2 rounded-lg border border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === event.deliverableItems.length - 1}
                        onClick={() => void handleMoveTask(idx, 1)}
                        aria-label={`تأخير ${item.name}`}
                        className="p-2 rounded-lg border border-slate-200 dark:border-neutral-800 text-slate-600 dark:text-neutral-300 disabled:opacity-30 min-h-[36px] min-w-[36px] flex items-center justify-center"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => void handleDeleteTask(item.id)}
                      aria-label={`حذف مهمة ${item.name}`}
                      className="inline-flex items-center gap-1 rounded-lg text-xs font-semibold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 px-2.5 py-1.5 min-h-[36px]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>حذف</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Section 2: Organizers & Multi-Role Assignment + WhatsApp Links */}
      <section className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 space-y-5 min-w-0 overflow-hidden">
        <div className="flex items-center gap-2 min-w-0">
          <UserPlus className="w-5 h-5 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              إضافة منظم وتحديد وظائفه
            </h2>
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              يمكنك اختيار وظيفة واحدة أو أكثر للمنظم؛ إذا اخترت أكثر من وظيفة سيتبدل بينها من هاتفه بسهولة.
            </p>
          </div>
        </div>

        <form onSubmit={(e) => void handleCreateOrganizer(e)} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="min-w-0">
              <label
                htmlFor="org-name-input"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
              >
                اسم المنظم
              </label>
              <input
                id="org-name-input"
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="مثال: خالد محمود"
                className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>
            <div className="min-w-0">
              <label
                htmlFor="org-booth-input"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
              >
                اسم البوث (اختياري)
              </label>
              <input
                id="org-booth-input"
                type="text"
                value={boothName}
                onChange={(e) => setBoothName(e.target.value)}
                placeholder="مثال: بوث 1"
                className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>
            <div className="min-w-0">
              <label
                htmlFor="org-whatsapp-input"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
              >
                رقم واتساب المنظم (اختياري)
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="org-whatsapp-input"
                  type="tel"
                  dir="ltr"
                  value={whatsappPhone}
                  onChange={(e) => setWhatsappPhone(e.target.value)}
                  placeholder="01012345678"
                  className="w-full min-w-0 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-9 pl-3 py-2.5 text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
                />
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-2">
              الوظائف المصرح للمنظم بتسليمها:
            </div>
            {event.deliverableItems.length === 0 ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                أضف مهاماً في القسم العلوي أولاً لتتمكن من إسنادها للمنظمين.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {event.deliverableItems.map((item) => (
                  <label
                    key={item.id}
                    className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold cursor-pointer min-h-[44px] transition-colors ${
                      assignedItems.includes(item.id)
                        ? 'border-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                        : 'border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black text-slate-700 dark:text-neutral-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={assignedItems.includes(item.id)}
                      onChange={() => toggleCreateRole(item.id)}
                      className="w-4 h-4 accent-emerald-600 rounded"
                    />
                    <span>{item.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}

          <button
            type="submit"
            disabled={creatingOrg}
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 text-sm min-h-[44px] disabled:opacity-50"
          >
            <Plus className="w-4 h-4" />
            <span>{creatingOrg ? 'جاري الحفظ...' : 'إضافة المنظم وتوليد رابط الإيفنت'}</span>
          </button>
        </form>

        {/* Organizers List */}
        <div className="pt-4 border-t border-slate-100 dark:border-neutral-800 space-y-3">
          <div className="text-sm font-bold text-slate-900 dark:text-white">
            قائمة المنظمين في هذا الإيفنت ({organizers.length})
          </div>

          {organizers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-neutral-800 p-6 text-center text-xs text-slate-500 dark:text-neutral-400">
              لم تتم إضافة أي منظمين لهذا الإيفنت بعد.
            </div>
          ) : (
            <div className="space-y-3">
              {organizers.map((org) => {
                const assignedNames = event.deliverableItems
                  .filter((i) => org.assignedItems.includes(i.id))
                  .map((i) => i.name)
                  .join(' · ');
                const isEditing = editingOrgId === org.id;

                return (
                  <div
                    key={org.id}
                    data-testid={`organizer-row-${org.magicToken}`}
                    className={`min-w-0 overflow-hidden rounded-2xl border p-4 transition-colors space-y-3 ${
                      org.isActive
                        ? 'border-slate-200 dark:border-neutral-800 bg-slate-50/40 dark:bg-black/40'
                        : 'border-red-300 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20'
                    }`}
                  >
                    <div className="min-w-0 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm min-w-0">
                          <span className="font-bold text-slate-900 dark:text-white max-w-full overflow-x-auto whitespace-nowrap">
                            {org.name}
                          </span>
                          {org.boothName && (
                            <span className="text-xs text-slate-500 dark:text-neutral-400 max-w-full overflow-x-auto whitespace-nowrap">
                              · {org.boothName}
                            </span>
                          )}
                          <span className="text-xs font-mono-num font-bold text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                            · سلّم {org.deliveredCount} عنصر
                          </span>
                        </div>

                        <div className="text-xs text-slate-600 dark:text-neutral-400 overflow-x-auto whitespace-nowrap pb-0.5">
                          الوظائف: {assignedNames || 'لا يوجد'}
                          {org.whatsappPhone && (
                            <>
                              {' '}
                              · واتساب:{' '}
                              <span dir="ltr" className="font-ascii-mono font-semibold">
                                +{org.whatsappPhone}
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <a
                          href={buildOrganizerWhatsAppHref(getMagicLink(org), org, event)}
                          target="_blank"
                          rel="noopener noreferrer"
                          data-testid={`whatsapp-btn-${org.magicToken}`}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold min-h-[42px]"
                        >
                          <MessageCircle className="w-4 h-4" />
                          <span>{org.whatsappPhone ? 'إرسال مباشر واتساب' : 'واتساب'}</span>
                        </a>

                        <button
                          type="button"
                          onClick={() => void handleCopyMessage(org)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-bold text-slate-800 dark:text-white min-h-[42px]"
                        >
                          {copiedMsgId === org.id ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-600" />
                              <span>نُسخت الرسالة</span>
                            </>
                          ) : (
                            <>
                              <MessageSquareText className="w-4 h-4" />
                              <span>نسخ الرسالة</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => void handleCopyLink(org)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-bold text-slate-800 dark:text-white min-h-[42px]"
                        >
                          {copiedId === org.id ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-600" />
                              <span>تم النسخ</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>نسخ الرابط</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            isEditing ? setEditingOrgId(null) : startEditingRoles(org)
                          }
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 min-h-[42px]"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>تعديل الوظائف</span>
                        </button>

                        <button
                          type="button"
                          data-testid={`killswitch-${org.magicToken}`}
                          onClick={() =>
                            void updateOrganizerDoc(org.id, { isActive: !org.isActive })
                          }
                          className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold min-h-[42px] ${
                            org.isActive
                              ? 'bg-red-600 hover:bg-red-700 text-white'
                              : 'bg-slate-900 dark:bg-white text-white dark:text-black'
                          }`}
                        >
                          {org.isActive ? (
                            <>
                              <ShieldAlert className="w-4 h-4" />
                              <span>تجميد</span>
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="w-4 h-4" />
                              <span>إعادة تفعيل</span>
                            </>
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => void deleteOrganizerDoc(org.id)}
                          aria-label={`حذف ${org.name}`}
                          className="p-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 min-h-[42px] min-w-[42px] flex items-center justify-center"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Inline Role Editor */}
                    {isEditing && (
                      <div className="pt-3 border-t border-slate-200 dark:border-neutral-800 space-y-2.5">
                        <div className="text-xs font-bold text-slate-700 dark:text-neutral-300">
                          تحديث وظائف {org.name}:
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {event.deliverableItems.map((item) => (
                            <label
                              key={item.id}
                              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-neutral-700 bg-white dark:bg-black px-3 py-1.5 text-xs font-semibold cursor-pointer min-h-[38px]"
                            >
                              <input
                                type="checkbox"
                                checked={editingRoles.includes(item.id)}
                                onChange={() => toggleEditRole(item.id)}
                                className="w-4 h-4 accent-emerald-600 rounded"
                              />
                              <span>{item.name}</span>
                            </label>
                          ))}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={editingRoles.length === 0}
                            onClick={() => void saveEditedRoles(org)}
                            className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-xs font-bold min-h-[36px] disabled:opacity-50"
                          >
                            حفظ التغييرات
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingOrgId(null)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 dark:border-neutral-700 px-3 py-2 text-xs font-semibold min-h-[36px]"
                          >
                            <X className="w-3.5 h-3.5" />
                            <span>إلغاء</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
