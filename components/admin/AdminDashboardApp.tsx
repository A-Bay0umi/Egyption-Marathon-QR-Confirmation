'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  ClipboardList,
  LogOut,
  Moon,
  Plus,
  QrCode,
  Settings2,
  Sun,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { AdminAuthGate } from './AdminAuthGate';
import { EventParticipantsTab } from './EventParticipantsTab';
import { EventSettingsOrganizersTab } from './EventSettingsOrganizersTab';
import { EventTasksMonitorTab } from './EventTasksMonitorTab';
import { BrandLogo } from '@/components/BrandLogo';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { ADMIN_SESSION_STORAGE_KEY, isAdminSavedLocally } from '@/lib/admin-auth';
import { testFirestoreConnection } from '@/lib/firebase';
import {
  createEventDoc,
  deleteEventDoc,
  setActiveEventDoc,
  subscribeEventLogs,
  subscribeEventOrganizers,
  subscribeEventParticipants,
  subscribeEvents,
} from '@/lib/firestore-store';
import type { ActivityLog, DeliverableItem, MarathonEvent, Organizer, Participant } from '@/lib/types';

type EventTab = 'tasks' | 'settings' | 'people';

const THEME_STORAGE_KEY = 'marathon_high_contrast_dark';

export const AdminDashboardApp: React.FC = () => {
  const [authReady, setAuthReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Live Firestore collections
  const [events, setEvents] = useState<MarathonEvent[]>([]);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EventTab>('tasks');

  // Selected event sub-data from Firestore
  const [eventParticipants, setEventParticipants] = useState<Participant[]>([]);
  const [eventOrganizers, setEventOrganizers] = useState<Organizer[]>([]);
  const [eventLogs, setEventLogs] = useState<ActivityLog[]>([]);

  // Create Event modal/panel state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newTaskInput, setNewTaskInput] = useState('');
  const [newTasks, setNewTasks] = useState<DeliverableItem[]>([]);
  const [chainNewTasks, setChainNewTasks] = useState(false);
  const [setAsActiveOnCreate, setSetAsActiveOnCreate] = useState(true);
  const [creatingEvent, setCreatingEvent] = useState(false);

  // Delete confirmation modal state
  const [confirmDeleteEvent, setConfirmDeleteEvent] = useState<MarathonEvent | null>(null);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [firestoreError, setFirestoreError] = useState<string | null>(null);

  useEffect(() => {
    void testFirestoreConnection();

    queueMicrotask(() => {
      const savedDark = window.localStorage.getItem(THEME_STORAGE_KEY) === 'true';
      setDarkMode(savedDark);
      document.documentElement.classList.toggle('dark', savedDark);
      setNewDate(new Date().toISOString().slice(0, 10));
      setIsAuthenticated(isAdminSavedLocally());
      setAuthReady(true);
    });
  }, []);

  // Subscribe to all events from Firebase once authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    const unsub = subscribeEvents(
      (list) => {
        setEvents(list);
        setEventsLoaded(true);
        setFirestoreError(null);
      },
      (err) => {
        setFirestoreError(err.message);
        setEventsLoaded(true);
      }
    );
    return () => unsub();
  }, [isAuthenticated]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  // Subscribe to isolated participants, organizers, and logs for the opened event
  useEffect(() => {
    if (!isAuthenticated || !selectedEventId) return;

    const unsubParticipants = subscribeEventParticipants(selectedEventId, setEventParticipants);
    const unsubOrganizers = subscribeEventOrganizers(selectedEventId, setEventOrganizers);
    const unsubLogs = subscribeEventLogs(selectedEventId, setEventLogs);

    return () => {
      unsubParticipants();
      unsubOrganizers();
      unsubLogs();
    };
  }, [isAuthenticated, selectedEventId]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, String(next));
    document.documentElement.classList.toggle('dark', next);
  };

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
    setIsAuthenticated(false);
    setSelectedEventId(null);
  };

  const handleAddInitialTask = () => {
    const clean = newTaskInput.trim();
    if (!clean) return;
    setNewTasks((prev) => [
      ...prev,
      { id: `task_${Date.now().toString(36)}_${prev.length}`, name: clean },
    ]);
    setNewTaskInput('');
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreatingEvent(true);
    setFirestoreError(null);
    try {
      const preparedTasks: DeliverableItem[] = chainNewTasks
        ? newTasks.map((t, idx) =>
            idx > 0 ? { ...t, dependsOnItemId: newTasks[idx - 1].id } : t
          )
        : newTasks;

      const createdId = await createEventDoc({
        name: newName.trim(),
        date: newDate || new Date().toISOString().slice(0, 10),
        deliverableItems: preparedTasks,
        setAsActive: setAsActiveOnCreate || events.length === 0,
        existingEvents: events,
      });
      setNewName('');
      setNewTasks([]);
      setNewTaskInput('');
      setChainNewTasks(false);
      setShowCreateModal(false);
      setSelectedEventId(createdId);
      setActiveTab(preparedTasks.length > 0 ? 'tasks' : 'settings');
    } catch (err) {
      setFirestoreError(
        err instanceof Error ? err.message : 'تعذر حفظ الماراثون على Firebase'
      );
    } finally {
      setCreatingEvent(false);
    }
  };

  const handleDeleteEvent = async () => {
    if (!confirmDeleteEvent) return;
    setDeletingEvent(true);
    try {
      const deletingId = confirmDeleteEvent.id;
      await deleteEventDoc(deletingId);
      if (selectedEventId === deletingId) {
        setSelectedEventId(null);
      }
      setConfirmDeleteEvent(null);
    } catch (err) {
      setFirestoreError(
        err instanceof Error ? err.message : 'تعذر حذف الماراثون من Firebase'
      );
    } finally {
      setDeletingEvent(false);
    }
  };

  if (!authReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black">
        <span className="text-sm font-semibold text-slate-600 dark:text-neutral-300">
          جاري التحميل...
        </span>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <AdminAuthGate onPasscodeSuccess={() => setIsAuthenticated(true)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white pb-16">
      {/* Compact Sticky Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-neutral-800 bg-white/95 dark:bg-black/95 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {selectedEvent ? (
              <button
                type="button"
                onClick={() => setSelectedEventId(null)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-800 min-h-[42px] shrink-0"
              >
                <ArrowRight className="w-4 h-4" />
                <span>الماراثونات</span>
              </button>
            ) : (
              <BrandLogo size={38} showText={false} />
            )}

            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white truncate">
                {selectedEvent ? selectedEvent.name : 'EM QR — إدارة الماراثونات'}
              </h1>
              {selectedEvent ? (
                <div className="text-xs text-slate-500 dark:text-neutral-400 truncate font-mono-num">
                  {selectedEvent.date} · {selectedEvent.isActive ? 'الإيفنت الشغال حالياً' : 'غير مفعّل'}
                </div>
              ) : (
                <div dir="ltr" className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 truncate text-right">
                  Egyptian Marathon QR
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-neutral-900 px-3 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-800 min-h-[42px]"
            >
              <QrCode className="w-4 h-4 text-emerald-600" />
              <span className="hidden sm:inline">شاشة المسح</span>
            </Link>
            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label="تبديل الوضع الليلي"
              className="p-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-100 dark:bg-neutral-900 min-h-[42px] min-w-[42px] flex items-center justify-center"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="تسجيل الخروج"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 px-3 py-2 text-xs font-bold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-900 min-h-[42px]"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-5 space-y-6">
        {firestoreError && (
          <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 p-4 text-xs font-semibold text-red-800 dark:text-red-200">
            تنبيه قاعدة البيانات: {firestoreError}
          </div>
        )}

        {/* STAGE 1: Marathons Directory */}
        {!selectedEvent ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white">
                  قائمة الماراثونات والإيفنتات
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-neutral-400 mt-0.5">
                  أضف ماراثوناً جديداً، حدد الإيفنت الشغال الآن، أو ادخل على أي إيفنت لإدارة مهامه ومنظميه.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 text-sm min-h-[46px] whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>إضافة ماراثون جديد</span>
              </button>
            </div>

            {!eventsLoaded ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="h-44 rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 animate-pulse"
                  />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-10 text-center space-y-3">
                <Calendar className="w-10 h-10 text-emerald-600 mx-auto" />
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  لا توجد ماراثونات مسجلة بعد
                </h3>
                <p className="text-sm text-slate-500 dark:text-neutral-400 max-w-md mx-auto">
                  ابدأ بإنشاء أول ماراثون الآن ليتم حفظه على Firebase وإضافة المهام والمنظمين والمتسابقين بداخله.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-6 py-3 text-sm min-h-[48px]"
                >
                  <Plus className="w-4 h-4" />
                  <span>إنشاء أول ماراثون</span>
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {events.map((ev) => (
                  <div
                    key={ev.id}
                    data-testid={`event-card-${ev.id}`}
                    className={`rounded-2xl border p-5 flex flex-col justify-between gap-4 transition-colors ${
                      ev.isActive
                        ? 'border-emerald-600 bg-white dark:bg-neutral-950 ring-1 ring-emerald-600/30'
                        : 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950'
                    }`}
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug">
                          {ev.name}
                        </h3>
                        {ev.isActive && (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400 shrink-0 whitespace-nowrap">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>شغال الآن</span>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-neutral-400 font-mono-num">
                        {ev.date} · {ev.totalParticipants} متسابق · {ev.deliverableItems.length} مهام
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 dark:border-neutral-800 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedEventId(ev.id);
                          setActiveTab('tasks');
                        }}
                        className="flex-1 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black font-bold px-4 py-2.5 text-xs min-h-[44px] whitespace-nowrap"
                      >
                        فتح الإيفنت
                      </button>

                      {!ev.isActive && (
                        <button
                          type="button"
                          onClick={() => void setActiveEventDoc(ev.id, events)}
                          className="rounded-xl border border-emerald-600 text-emerald-700 dark:text-emerald-400 font-bold px-3.5 py-2.5 text-xs min-h-[44px] whitespace-nowrap hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                        >
                          تشغيل الآن
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => setConfirmDeleteEvent(ev)}
                        aria-label={`حذف ${ev.name}`}
                        className="p-2.5 rounded-xl border border-slate-200 dark:border-neutral-800 text-slate-500 hover:text-red-600 hover:border-red-300 min-h-[44px] min-w-[44px] flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          /* STAGE 2: Inside Selected Event -> Strictly 3 Focused Tabs */
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              {/* 3 Focused Tabs */}
              <nav
                aria-label="صفحات الإيفنت"
                className="flex items-center gap-1.5 overflow-x-auto p-1.5 rounded-2xl bg-slate-200/70 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800 w-full sm:w-auto"
              >
                {(
                  [
                    { id: 'tasks', label: 'المهام والتسليم', icon: ClipboardList },
                    { id: 'settings', label: 'إعدادات المهام والمنظمين', icon: Settings2 },
                    { id: 'people', label: 'الأشخاص', icon: Users },
                  ] as const
                ).map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 min-h-[44px] transition-colors ${
                        active
                          ? 'bg-white dark:bg-black text-emerald-700 dark:text-emerald-400 shadow-sm'
                          : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </nav>

              {!selectedEvent.isActive && (
                <button
                  type="button"
                  onClick={() => void setActiveEventDoc(selectedEvent.id, events)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 text-xs font-bold min-h-[44px]"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>تحديد هذا الإيفنت كـ شغال الآن</span>
                </button>
              )}
            </div>

            {activeTab === 'tasks' && (
              <EventTasksMonitorTab
                event={selectedEvent}
                participants={eventParticipants}
                logs={eventLogs}
              />
            )}

            {activeTab === 'settings' && (
              <EventSettingsOrganizersTab
                event={selectedEvent}
                organizers={eventOrganizers}
              />
            )}

            {activeTab === 'people' && (
              <EventParticipantsTab
                event={selectedEvent}
                participants={eventParticipants}
              />
            )}
          </div>
        )}
      </main>

      {/* Create Event Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                إضافة ماراثون جديد
              </h3>
              <button
                type="button"
                aria-label="إغلاق"
                onClick={() => setShowCreateModal(false)}
                className="p-2 rounded-xl text-slate-500 hover:bg-slate-100 dark:hover:bg-neutral-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreateEvent(e)} className="space-y-4">
              <div>
                <label
                  htmlFor="new-event-name"
                  className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
                >
                  اسم الماراثون / الإيفنت
                </label>
                <input
                  id="new-event-name"
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="مثال: ماراثون القاهرة 2026"
                  className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
                />
              </div>

              <div>
                <label
                  htmlFor="new-event-date"
                  className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
                >
                  تاريخ الإيفنت
                </label>
                <input
                  id="new-event-date"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1">
                  مهام التوزيع المبدئية (اختياري — يمكنك التعديل لاحقاً)
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTaskInput}
                    onChange={(e) => setNewTaskInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddInitialTask();
                      }
                    }}
                    placeholder="مثال: تيشيرت أو رقم الصدر"
                    className="flex-1 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2 text-sm text-slate-900 dark:text-white min-h-[44px]"
                  />
                  <button
                    type="button"
                    onClick={handleAddInitialTask}
                    className="rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-4 py-2 text-xs font-bold min-h-[44px]"
                  >
                    إضافة
                  </button>
                </div>

                {newTasks.length > 0 && (
                  <div className="mt-2.5 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {newTasks.map((t, idx) => (
                        <span
                          key={t.id}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black px-2.5 py-1 text-xs font-semibold"
                        >
                          <span className="text-emerald-700 dark:text-emerald-400 font-mono-num">
                            {idx + 1}.
                          </span>
                          <span>{t.name}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setNewTasks((prev) => prev.filter((item) => item.id !== t.id))
                            }
                            aria-label={`إزالة ${t.name}`}
                            className="text-slate-400 hover:text-red-600"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </span>
                      ))}
                    </div>

                    {newTasks.length >= 2 && (
                      <label className="inline-flex items-center gap-2 text-xs font-bold text-emerald-700 dark:text-emerald-400 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={chainNewTasks}
                          onChange={(e) => setChainNewTasks(e.target.checked)}
                          className="w-4 h-4 accent-emerald-600 rounded"
                        />
                        <span>تفعيل التسلسل التلقائي (كل مهمة تشترط إتمام التي قبلها)</span>
                      </label>
                    )}
                  </div>
                )}
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-neutral-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={setAsActiveOnCreate}
                  onChange={(e) => setSetAsActiveOnCreate(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded"
                />
                <span>تفعيل هذا الإيفنت كـ شغال الآن</span>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-xl border border-slate-300 dark:border-neutral-700 px-4 py-2.5 text-xs font-bold min-h-[44px]"
                >
                  إلغاء
                </button>
                <button
                  type="submit"
                  disabled={creatingEvent}
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-2.5 text-xs font-bold min-h-[44px] disabled:opacity-50"
                >
                  {creatingEvent ? 'جاري الحفظ...' : 'حفظ الماراثون'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Event Confirmation Modal */}
      {confirmDeleteEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 shadow-2xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              تأكيد حذف الماراثون
            </h3>
            <p className="text-sm text-slate-600 dark:text-neutral-300 leading-relaxed">
              هل أنت متأكد من حذف إيفنت &quot;{confirmDeleteEvent.name}&quot;؟ سيتم حذف جميع المتسابقين والمنظمين المرتبطين به من Firebase نهائياً.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteEvent(null)}
                className="rounded-xl border border-slate-300 dark:border-neutral-700 px-4 py-2 text-xs font-bold min-h-[44px]"
              >
                إلغاء
              </button>
              <button
                type="button"
                disabled={deletingEvent}
                onClick={() => void handleDeleteEvent()}
                className="rounded-xl bg-red-600 hover:bg-red-700 text-white px-5 py-2 text-xs font-bold min-h-[44px] disabled:opacity-50"
              >
                {deletingEvent ? 'جاري الحذف...' : 'حذف نهائياً'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
