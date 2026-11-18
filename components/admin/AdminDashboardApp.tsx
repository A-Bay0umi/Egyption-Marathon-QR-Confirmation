'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  BarChart3,
  CalendarCog,
  FileSpreadsheet,
  LogOut,
  Moon,
  ScanBarcode,
  Sun,
  Users,
} from 'lucide-react';
import { AdminAuthGate } from './AdminAuthGate';
import { EventsTab } from './EventsTab';
import { OrganizersTab } from './OrganizersTab';
import { ReportsTab } from './ReportsTab';
import { SheetImportTab } from './SheetImportTab';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { ADMIN_SESSION_STORAGE_KEY } from '@/lib/admin-auth';
import {
  getFirebaseServices,
  initFirebaseAuth,
  signOutFirebase,
  testFirestoreConnection,
} from '@/lib/firebase';
import {
  getStateSnapshot,
  subscribeFirestoreLiveFeed,
  subscribeLocalSync,
  type MarathonAppState,
} from '@/lib/demo-store';
import { formatRelativeArabicTime } from '@/lib/marathon-logic';
import type { ActivityLog } from '@/lib/types';

type AdminTab = 'events' | 'import' | 'organizers' | 'reports';

const THEME_STORAGE_KEY = 'marathon_high_contrast_dark';

export const AdminDashboardApp: React.FC = () => {
  const [authReady, setAuthReady] = useState(false);
  const [adminUser, setAdminUser] = useState<{
    uid: string;
    email: string;
    isDemo: boolean;
  } | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);

  const [appState, setAppState] = useState<MarathonAppState | null>(null);
  const [remoteLogs, setRemoteLogs] = useState<ActivityLog[] | null>(null);
  const [activeTab, setActiveTab] = useState<AdminTab>('reports');
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    void testFirestoreConnection();

    queueMicrotask(() => {
      setAppState(getStateSnapshot());
      const savedDark = window.localStorage.getItem(THEME_STORAGE_KEY) === 'true';
      setDarkMode(savedDark);
      document.documentElement.classList.toggle('dark', savedDark);

      const hasLocalAdmin =
        window.localStorage.getItem(ADMIN_SESSION_STORAGE_KEY) === 'authenticated';
      if (hasLocalAdmin) {
        setAdminUser({ uid: 'local_admin', email: 'مدير السباق', isDemo: true });
        setAuthReady(true);
      }
    });

    const unsubAuth = initFirebaseAuth(async (user) => {
      if (user) {
        const token = await user.getIdToken().catch(() => null);
        setIdToken(token);
        setAdminUser({ uid: user.uid, email: user.email || 'مدير السباق', isDemo: false });
      } else {
        setIdToken(null);
      }
      setAuthReady(true);
    });

    const unsubLocal = subscribeLocalSync((next) => {
      setAppState(next);
    });

    return () => {
      unsubAuth();
      unsubLocal();
    };
  }, []);

  const activeEvent = useMemo(() => {
    if (!appState) return null;
    return appState.events.find((e) => e.isActive) ?? appState.events[0] ?? null;
  }, [appState]);

  const activeEventId = activeEvent?.id ?? null;
  useEffect(() => {
    if (!activeEventId || !adminUser || adminUser.isDemo) return;
    return subscribeFirestoreLiveFeed(activeEventId, true, (logs) => {
      setRemoteLogs(logs);
    });
  }, [activeEventId, adminUser]);

  const liveLogs = useMemo(() => {
    if (!appState || !activeEvent) return [];
    const local = appState.logsByEvent[activeEvent.id] ?? [];
    if (remoteLogs && remoteLogs.length > 0 && !adminUser?.isDemo) {
      return remoteLogs.slice(0, 20);
    }
    return local.slice(0, 20);
  }, [appState, activeEvent, remoteLogs, adminUser]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, String(next));
    document.documentElement.classList.toggle('dark', next);
  };

  const handleLogout = async () => {
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(ADMIN_SESSION_STORAGE_KEY);
    }
    if (!adminUser?.isDemo) {
      await signOutFirebase();
    }
    setAdminUser(null);
    setIdToken(null);
  };

  if (!authReady || !appState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black">
        <span className="text-sm font-semibold text-slate-600 dark:text-neutral-300">
          جاري التحميل...
        </span>
      </div>
    );
  }

  if (!adminUser) {
    return (
      <AdminAuthGate
        onPasscodeSuccess={() =>
          setAdminUser({ uid: 'local_admin', email: 'مدير السباق', isDemo: true })
        }
        onGoogleSuccess={async (email) => {
          const { auth } = getFirebaseServices();
          const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
          setIdToken(token);
          setAdminUser({
            uid: auth.currentUser?.uid || 'google_admin',
            email,
            isDemo: false,
          });
        }}
      />
    );
  }

  const useFirestore = !adminUser.isDemo;
  const participants = activeEvent ? appState.participantsByEvent[activeEvent.id] ?? [] : [];

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white pb-16">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-neutral-800 bg-white/95 dark:bg-black/95 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white whitespace-nowrap">
              لوحة إدارة توزيع الماراثون
            </h1>
            <span className="hidden md:inline text-xs text-slate-500 dark:text-neutral-400 truncate">
              · {activeEvent?.name ?? 'لا يوجد إيفنت نشط'} · {adminUser.email}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label="تبديل الوضع الليلي"
              className="p-2.5 rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-100 dark:bg-neutral-900 min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {darkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
            </button>
            <Link
              href="/?token=DEMO-BOOTH-A"
              className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold min-h-[44px] whitespace-nowrap"
            >
              <ScanBarcode className="w-4 h-4" />
              <span>واجهة الماسح</span>
            </Link>
            <button
              type="button"
              onClick={() => void handleLogout()}
              aria-label="تسجيل الخروج"
              className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-neutral-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-900 min-h-[44px]"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">خروج</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 space-y-6">
        {/* Pinned Real-Time Live Activity Feed */}
        <section
          aria-label="شريط النشاط اللحظي"
          className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4"
        >
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>شريط النشاط اللحظي</span>
            </div>
            <span className="text-xs text-slate-500 dark:text-neutral-400 font-mono-num">
              آخر {liveLogs.length} عمليات
            </span>
          </div>

          {liveLogs.length === 0 ? (
            <p className="text-xs text-slate-500 dark:text-neutral-400">
              لم يتم تسجيل أي عمليات تسليم بعد لهذا الإيفنت.
            </p>
          ) : (
            <div className="max-h-36 overflow-y-auto divide-y divide-slate-100 dark:divide-neutral-800">
              {liveLogs.map((log) => (
                <div
                  key={log.id}
                  className="py-2 flex flex-wrap items-center justify-between gap-2 text-xs"
                >
                  <div className="text-slate-800 dark:text-neutral-200">
                    <span className="font-bold">
                      {log.action === 'delivered' ? '🟢' : '↩️'} {formatRelativeArabicTime(log.timestamp)}:
                    </span>{' '}
                    {log.action === 'delivered' ? (
                      <>
                        المشترك <strong>{log.participantName}</strong> استلم{' '}
                        <strong>{log.itemName}</strong> بواسطة المنظم{' '}
                        <strong>{log.organizerName}</strong>
                      </>
                    ) : (
                      <>
                        تراجع إداري عن تسليم <strong>{log.itemName}</strong> للمشترك{' '}
                        <strong>{log.participantName}</strong> بواسطة{' '}
                        <strong>{log.organizerName}</strong>
                      </>
                    )}
                  </div>
                  <span className="font-mono-num text-slate-400">{log.barcode}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 4 Navigation Tabs */}
        <nav
          aria-label="أقسام لوحة الإدارة"
          className="flex items-center gap-1.5 overflow-x-auto p-1.5 rounded-2xl bg-slate-200/70 dark:bg-neutral-900 border border-slate-200 dark:border-neutral-800"
        >
          {(
            [
              { id: 'reports', label: 'التقارير والتحكم', icon: BarChart3 },
              { id: 'events', label: 'إدارة الإيفنتات', icon: CalendarCog },
              { id: 'import', label: 'رفع الشيت وتحديد الأعمدة', icon: FileSpreadsheet },
              { id: 'organizers', label: 'إدارة المنظمين والصلاحيات', icon: Users },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold whitespace-nowrap shrink-0 min-h-[44px] transition-colors ${
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

        {/* Tab Content */}
        {activeTab === 'events' && (
          <EventsTab
            events={appState.events}
            useFirestore={useFirestore}
            idToken={idToken}
            ownerUid={adminUser.uid}
          />
        )}

        {activeTab === 'import' && (
          <SheetImportTab
            activeEvent={activeEvent}
            useFirestore={useFirestore}
            idToken={idToken}
            onImportDone={() => setActiveTab('reports')}
          />
        )}

        {activeTab === 'organizers' && (
          <OrganizersTab
            activeEvent={activeEvent}
            organizers={appState.organizers}
            useFirestore={useFirestore}
            idToken={idToken}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsTab
            activeEvent={activeEvent}
            participants={participants}
            adminName={adminUser.email}
            useFirestore={useFirestore}
            idToken={idToken}
          />
        )}
      </main>
    </div>
  );
};
