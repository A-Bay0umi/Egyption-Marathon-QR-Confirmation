'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  Moon,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  UserCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { doc, onSnapshot } from 'firebase/firestore';
import { BarcodeCamera } from './BarcodeCamera';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useWebAudio } from '@/hooks/useWebAudio';
import { decodeOrganizerInvite } from '@/lib/admin-auth';
import { getFirebaseServices, testFirestoreConnection } from '@/lib/firebase';
import {
  executeAtomicDelivery,
  flushOfflineQueue,
  getStateSnapshot,
  registerInvitedOrganizerLocally,
  subscribeLocalSync,
  type MarathonAppState,
} from '@/lib/demo-store';
import {
  extractParticipantDisplayName,
  formatArabicTime,
  matchesSearchQuery,
  normalizeBarcode,
} from '@/lib/marathon-logic';
import type { DeliverableItem, Organizer, Participant } from '@/lib/types';

const TOKEN_STORAGE_KEY = 'marathon_organizer_token_v1';
const THEME_STORAGE_KEY = 'marathon_high_contrast_dark';

export const OrganizerScannerApp: React.FC = () => {
  const searchParams = useSearchParams();
  const isOnline = useOnlineStatus();
  const { playSuccessSound, playDuplicateAlertSound, playNotFoundSound } = useWebAudio();

  const [appState, setAppState] = useState<MarathonAppState | null>(null);
  const [activeToken, setActiveToken] = useState<string>('');
  const [darkMode, setDarkMode] = useState(false);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarcode, setSelectedBarcode] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  // Initialize state, theme, and organizer magic link (persisted locally on phone)
  useEffect(() => {
    void testFirestoreConnection();

    const urlToken = searchParams.get('token');
    const urlInvite = searchParams.get('invite');

    queueMicrotask(() => {
      const savedDark = window.localStorage.getItem(THEME_STORAGE_KEY) === 'true';
      setDarkMode(savedDark);
      document.documentElement.classList.toggle('dark', savedDark);

      if (urlInvite) {
        const decoded = decodeOrganizerInvite(urlInvite);
        if (decoded && (!urlToken || decoded.org.magicToken === urlToken.trim())) {
          registerInvitedOrganizerLocally(decoded);
          const clean = decoded.org.magicToken.trim();
          setActiveToken(clean);
          window.localStorage.setItem(TOKEN_STORAGE_KEY, clean);
          window.history.replaceState({}, '', `/?token=${encodeURIComponent(clean)}`);
          setAppState(getStateSnapshot());
          return;
        }
      }

      setAppState(getStateSnapshot());

      if (urlToken && urlToken.trim()) {
        const clean = urlToken.trim();
        setActiveToken(clean);
        window.localStorage.setItem(TOKEN_STORAGE_KEY, clean);
      } else {
        const savedToken = window.localStorage.getItem(TOKEN_STORAGE_KEY);
        if (savedToken) {
          setActiveToken(savedToken);
        }
      }
    });

    const unsub = subscribeLocalSync((next) => {
      setAppState(next);
    });
    return unsub;
  }, [searchParams]);

  // Real-time Firestore listener on organizer doc if signed in
  const organizer: Organizer | null = useMemo(() => {
    if (!appState || !activeToken) return null;
    return (
      appState.organizers.find(
        (o) => o.magicToken === activeToken || o.id === activeToken
      ) ?? null
    );
  }, [appState, activeToken]);

  const organizerId = organizer?.id ?? null;
  useEffect(() => {
    if (!organizerId || !isOnline) return;
    try {
      const { auth, db } = getFirebaseServices();
      if (!auth.currentUser) return;
      const unsub = onSnapshot(
        doc(db, 'organizers', organizerId),
        (snap) => {
          if (!snap.exists()) return;
          const remote = snap.data();
          setAppState((prev) => {
            if (!prev) return prev;
            return {
              ...prev,
              organizers: prev.organizers.map((o) =>
                o.id === organizerId
                  ? {
                      ...o,
                      isActive: Boolean(remote.isActive),
                      deliveredCount:
                        typeof remote.deliveredCount === 'number'
                          ? remote.deliveredCount
                          : o.deliveredCount,
                      assignedItems: Array.isArray(remote.assignedItems)
                        ? remote.assignedItems
                        : o.assignedItems,
                    }
                  : o
              ),
            };
          });
        },
        () => {
          // Ignore snapshot errors when offline or unauthenticated
        }
      );
      return unsub;
    } catch {
      return;
    }
  }, [organizerId, isOnline]);

  // Auto-flush offline queue when connectivity returns
  const pendingCount = appState?.pendingQueue.length ?? 0;
  useEffect(() => {
    if (!isOnline || pendingCount === 0) return;
    const { auth } = getFirebaseServices();
    const useFirestore = Boolean(auth.currentUser);
    if (!useFirestore) return;
    void (async () => {
      await Promise.resolve();
      setIsSyncing(true);
      const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;
      await flushOfflineQueue({ useFirestore, idToken });
      setAppState(getStateSnapshot());
      setIsSyncing(false);
    })();
  }, [isOnline, pendingCount]);

  const activeEvent = useMemo(() => {
    if (!appState) return null;
    if (organizer) {
      return (
        appState.events.find((e) => e.id === organizer.eventId) ??
        appState.events.find((e) => e.isActive) ??
        appState.events[0] ??
        null
      );
    }
    return appState.events.find((e) => e.isActive) ?? appState.events[0] ?? null;
  }, [appState, organizer]);

  const participants: Participant[] = useMemo(() => {
    if (!appState || !activeEvent) return [];
    return appState.participantsByEvent[activeEvent.id] ?? [];
  }, [appState, activeEvent]);

  const selectedParticipant = useMemo(() => {
    if (!selectedBarcode) return null;
    return participants.find((p) => p.barcode === selectedBarcode) ?? null;
  }, [participants, selectedBarcode]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [];
    return participants.filter((p) => matchesSearchQuery(p, q)).slice(0, 8);
  }, [participants, searchQuery]);

  const assignedDeliverables: DeliverableItem[] = useMemo(() => {
    if (!activeEvent || !organizer) return [];
    return activeEvent.deliverableItems.filter((item) =>
      organizer.assignedItems.includes(item.id)
    );
  }, [activeEvent, organizer]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, String(next));
    document.documentElement.classList.toggle('dark', next);
  };

  const handleSelectParticipant = useCallback(
    (participant: Participant) => {
      setSelectedBarcode(participant.barcode);
      setSearchQuery('');
      setFeedbackBanner(null);

      // Play duplicate buzz immediately if ANY assigned item was already delivered
      const hasAnyAlreadyDelivered = assignedDeliverables.some(
        (item) => participant.deliveries?.[item.id]?.status === 'delivered'
      );
      if (hasAnyAlreadyDelivered) {
        playDuplicateAlertSound();
      } else {
        playSuccessSound();
      }
    },
    [assignedDeliverables, playDuplicateAlertSound, playSuccessSound]
  );

  const handleBarcodeScanned = useCallback(
    (rawCode: string) => {
      const normalized = normalizeBarcode(rawCode);
      const match =
        participants.find((p) => p.barcode.toUpperCase() === normalized.toUpperCase()) ??
        participants.find((p) => matchesSearchQuery(p, rawCode));

      if (!match) {
        playNotFoundSound();
        setSelectedBarcode(null);
        setFeedbackBanner({
          type: 'error',
          text: `لم يتم العثور على مشترك بالباركود: ${rawCode}`,
        });
        return;
      }

      handleSelectParticipant(match);
    },
    [handleSelectParticipant, participants, playNotFoundSound]
  );

  const handleConfirmDelivery = async (item: DeliverableItem) => {
    if (!activeEvent || !organizer || !selectedParticipant) return;
    const { auth } = getFirebaseServices();
    const useFirestore = Boolean(auth.currentUser);
    const idToken = auth.currentUser ? await auth.currentUser.getIdToken() : null;

    const result = await executeAtomicDelivery({
      eventId: activeEvent.id,
      barcode: selectedParticipant.barcode,
      organizer,
      item,
      displayFields: activeEvent.displayFields,
      isOnline,
      useFirestore,
      idToken,
    });

    setAppState(getStateSnapshot());

    if (result.ok) {
      playSuccessSound();
      setFeedbackBanner({
        type: 'success',
        text: `تم تسليم "${item.name}" للمتسابق بنجاح`,
      });
    } else if (result.reason === 'already_delivered') {
      playDuplicateAlertSound();
      setFeedbackBanner({
        type: 'warning',
        text: `تنبيه: تم تسليم "${item.name}" مسبقاً!`,
      });
    } else if (result.reason === 'organizer_frozen') {
      playNotFoundSound();
    }
  };

  const handleClearSavedSession = () => {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    setActiveToken('');
    setSelectedBarcode(null);
    setFeedbackBanner(null);
    if (window.location.search) {
      window.history.replaceState({}, '', '/');
    }
  };

  // Loading state
  if (!appState) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black">
        <div className="text-sm font-semibold text-slate-600 dark:text-neutral-300">
          جاري تجهيز ماسح التوزيع...
        </div>
      </div>
    );
  }

  // Emergency Kill-Switch or Invalid Token Screen
  if (activeToken && (!organizer || !organizer.isActive)) {
    const isFrozen = organizer && !organizer.isActive;
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-950 text-white p-6">
        <div className="max-w-md w-full rounded-3xl border border-red-700 bg-black/70 p-8 text-center shadow-2xl">
          <ShieldAlert className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold leading-snug">
            {isFrozen
              ? '⛔ تم إيقاف هذا الرابط من قِبل الإدارة'
              : '⛔ رابط الدخول غير صالح أو منتهي الصلاحية'}
          </h1>
          <p className="mt-3 text-sm text-red-200 leading-relaxed">
            {isFrozen
              ? 'تم تجميد صلاحيات هذا البوث مؤقتاً من لوحة تحكم مدير السباق. يرجى مراجعة المشرف لإعادة التفعيل.'
              : 'لا يمكن الدخول للموقع إلا عبر رابط صحيح يرسله مدير السباق عبر واتساب. يرجى طلب رابط جديد من الإدارة.'}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={handleClearSavedSession}
              className="w-full rounded-xl bg-white text-slate-900 font-bold py-3 px-4 min-h-[48px] hover:bg-slate-100"
            >
              مسح الجلسة المحفوظة من الهاتف
            </button>
            <Link
              href="/admin"
              className="text-xs text-red-200 underline underline-offset-4 py-2"
            >
              دخول مدير السباق
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Strict Link-Only Access Gate (when no saved local session and no magic link in URL)
  if (!activeToken || !organizer) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-black flex flex-col justify-between p-4 sm:p-6">
        <header className="max-w-lg w-full mx-auto flex items-center justify-between gap-4 py-2">
          <span className="text-base font-bold text-slate-900 dark:text-white">
            موزع مستلزمات الماراثون
          </span>
          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label="تبديل تباين الشمس"
            className="p-2.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-slate-800 dark:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
          </button>
        </header>

        <main className="max-w-lg w-full mx-auto my-auto py-8">
          <div className="rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 sm:p-8 shadow-sm text-center">
            <div className="w-14 h-14 rounded-2xl bg-slate-900 dark:bg-emerald-950 flex items-center justify-center mx-auto mb-4">
              <Lock className="w-7 h-7 text-emerald-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              الدخول عبر رابط المنظم فقط
            </h1>
            <p className="mt-3 text-sm text-slate-600 dark:text-neutral-300 leading-relaxed">
              هذا الموقع مخصص لمنظمي الماراثون ولا يعمل إلا من خلال رابط الدعوة الخاص الذي يرسله لك مدير السباق عبر واتساب.
            </p>

            <div className="mt-6 rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/40 p-4 text-right flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm text-emerald-950 dark:text-emerald-200 leading-relaxed">
                <strong>حفظ تلقائي على الهاتف:</strong> بمجرد فتح الرابط المرسل من الإدارة مرة واحدة، يتم حفظ تسجيل دخولك محلياً على هذا الهاتف للعمل فوراً طوال اليوم حتى عند انقطاع الإنترنت.
              </div>
            </div>
          </div>
        </main>

        <footer className="max-w-lg w-full mx-auto flex items-center justify-between text-xs text-slate-500 dark:text-neutral-500 py-2">
          <span>مقيد بروابط الدعوة المعتمدة</span>
          <Link
            href="/admin"
            className="font-semibold text-slate-600 dark:text-neutral-400 hover:text-emerald-700 dark:hover:text-emerald-400 underline underline-offset-4 py-1"
          >
            دخول مدير السباق
          </Link>
        </footer>
      </div>
    );
  }

  const totalTarget = activeEvent?.totalParticipants ?? participants.length;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white pb-16">
      {/* Compact Sticky Top Header Bar */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-neutral-800 bg-white/95 dark:bg-black/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white truncate">
              <span className="truncate">{organizer.name}</span>
              <span aria-hidden="true" className="text-slate-400">·</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-mono-num tabular-nums whitespace-nowrap">
                إنجازك اليوم: {organizer.deliveredCount} / {totalTarget}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-neutral-400 truncate mt-0.5">
              <span className="truncate">{activeEvent?.name ?? 'الحدث النشط'}</span>
              <span aria-hidden="true">·</span>
              {isOnline ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
                  <Wifi className="w-3.5 h-3.5" />
                  <span>متصل</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold whitespace-nowrap">
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>أوفلاين (حفظ محلي)</span>
                </span>
              )}
              {appState.pendingQueue.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono-num text-amber-600 dark:text-amber-400 font-semibold whitespace-nowrap">
                    {isSyncing ? (
                      <RefreshCw className="w-3 h-3 inline animate-spin ml-1" />
                    ) : null}
                    بانتظار المزامنة: {appState.pendingQueue.length}
                  </span>
                </>
              )}
              <span className="hidden sm:inline text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
                · محفوظ على الهاتف
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label="الوضع الليلي / تباين الشمس"
              title="الوضع الليلي / تباين الشمس"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-100 dark:bg-neutral-900 px-2.5 py-2 text-xs font-bold text-slate-800 dark:text-white min-h-[44px] min-w-[44px]"
            >
              {darkMode ? (
                <Sun className="w-5 h-5 text-amber-400" />
              ) : (
                <Moon className="w-5 h-5 text-slate-700" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-3 sm:px-4 pt-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Scanner & Search Column */}
          <div className="lg:col-span-5 space-y-3">
            <BarcodeCamera
              onScan={handleBarcodeScanned}
              compactIdle={Boolean(selectedParticipant)}
            />

            {/* Smart Instant Fallback Search Bar */}
            <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3 sm:p-4">
              <label
                htmlFor="fallback-search-input"
                className="block text-sm font-bold text-slate-900 dark:text-white mb-2"
              >
                البحث الذكي الفوري (بديل الكاميرا)
              </label>
              <div className="relative">
                <Search className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="fallback-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالباركود، أول 3 حروف من الاسم، رقم الصدر، أو آخر 4 أرقام من الموبايل..."
                  className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-11 pl-10 py-3 text-sm sm:text-base text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 min-h-[50px]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="مسح البحث"
                    onClick={() => setSearchQuery('')}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {searchQuery.trim().length > 0 && (
                <div className="mt-3 divide-y divide-slate-100 dark:divide-neutral-800 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black overflow-hidden">
                  {searchResults.length === 0 ? (
                    <div className="p-4 text-center text-sm text-slate-500 dark:text-neutral-400">
                      لا توجد نتائج مطابقة لـ &quot;{searchQuery}&quot;
                    </div>
                  ) : (
                    searchResults.map((p) => {
                      const displayName = extractParticipantDisplayName(
                        p,
                        activeEvent?.displayFields ?? []
                      );
                      const sizeVal =
                        p.dynamicData['مقاس التيشيرت'] || p.dynamicData['Size'] || '';
                      const bibVal =
                        p.dynamicData['رقم الصدر'] || p.dynamicData['Bib'] || '';
                      return (
                        <button
                          key={p.barcode}
                          type="button"
                          onClick={() => handleSelectParticipant(p)}
                          className="w-full text-right px-4 py-3 hover:bg-emerald-50 dark:hover:bg-neutral-900 transition-colors flex items-center justify-between gap-3 min-h-[56px]"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-bold text-slate-900 dark:text-white truncate">
                              {displayName}
                            </div>
                            <div className="text-xs text-slate-500 dark:text-neutral-400 font-mono-num mt-0.5">
                              <span dir="ltr" className="font-ascii-mono">
                                {p.barcode}
                              </span>
                              {bibVal ? ` · رقم الصدر ${bibVal}` : ''}
                            </div>
                          </div>
                          {sizeVal && (
                            <span className="text-base font-bold font-ascii-mono text-emerald-700 dark:text-emerald-400 shrink-0">
                              {sizeVal}
                            </span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Participant Card & Delivery Action Column */}
          <div className="lg:col-span-7 space-y-4">
            {feedbackBanner && (
              <div
                role="status"
                className={`rounded-2xl p-3.5 text-sm font-bold flex items-center gap-2.5 border ${
                  feedbackBanner.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                    : feedbackBanner.type === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                    : 'bg-red-50 dark:bg-red-950/60 text-red-900 dark:text-red-200 border-red-300 dark:border-red-700'
                }`}
              >
                {feedbackBanner.type === 'success' ? (
                  <CheckCircle2 className="w-5 h-5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-5 h-5 shrink-0" />
                )}
                <span>{feedbackBanner.text}</span>
              </div>
            )}

            <AnimatePresence mode="wait">
              {selectedParticipant ? (() => {
                const participantDisplayName = extractParticipantDisplayName(
                  selectedParticipant,
                  activeEvent?.displayFields ?? []
                );
                const visibleFields = (
                  activeEvent?.displayFields ?? Object.keys(selectedParticipant.dynamicData)
                ).filter((field) => {
                  const val = selectedParticipant.dynamicData[field];
                  return Boolean(val) && val !== participantDisplayName;
                });

                return (
                  <motion.div
                    key={selectedParticipant.barcode}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.16 }}
                    className="rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3.5 sm:p-5 shadow-sm space-y-3.5"
                  >
                    <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-neutral-800">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                          باركود:{' '}
                          <span dir="ltr" className="font-ascii-mono">
                            {selectedParticipant.barcode}
                          </span>
                        </div>
                        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white mt-0.5 leading-tight">
                          {participantDisplayName}
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedBarcode(null);
                          setFeedbackBanner(null);
                        }}
                        aria-label="إغلاق بطاقة المتسابق"
                        className="p-2 rounded-xl bg-slate-100 dark:bg-neutral-900 text-slate-600 dark:text-neutral-300 hover:bg-slate-200 dark:hover:bg-neutral-800 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Assigned Deliverable Items Action Buttons First for One-Handed Thumb Reach */}
                    <div className="space-y-2.5">
                      <h3 className="text-xs sm:text-sm font-bold text-slate-700 dark:text-neutral-300">
                        المستلزمات المخصصة لبوثك ({organizer.boothName || organizer.name})
                      </h3>

                      {assignedDeliverables.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 p-4 text-sm text-slate-500 dark:text-neutral-400">
                          لم يتم تعيين أي مستلزمات لهذا المنظم.
                        </div>
                      ) : (
                        assignedDeliverables.map((item) => {
                          const delivered = selectedParticipant.deliveries?.[item.id];
                          if (delivered && delivered.status === 'delivered') {
                            return (
                              <div
                                key={item.id}
                                data-testid={`locked-item-${item.id}`}
                                className="rounded-2xl border-2 border-red-500 dark:border-red-600 bg-red-50 dark:bg-red-950/70 p-3.5 text-red-950 dark:text-red-100"
                              >
                                <div className="flex items-center gap-2 text-base font-bold">
                                  <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 shrink-0" />
                                  <span>⚠️ تم تسليم {item.name} مسبقاً!</span>
                                </div>
                                <div className="mt-1 text-sm font-semibold text-red-800 dark:text-red-200 font-mono-num">
                                  بواسطة: {delivered.deliveredByOrganizerName} — الساعة{' '}
                                  {formatArabicTime(delivered.deliveredAt)}
                                </div>
                              </div>
                            );
                          }

                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-testid={`deliver-btn-${item.id}`}
                              onClick={() => void handleConfirmDelivery(item)}
                              className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-lg py-3.5 px-5 min-h-[56px] flex items-center justify-center gap-2.5 shadow-sm transition-all"
                            >
                              <ShieldCheck className="w-6 h-6 shrink-0" />
                              <span>✅ تأكيد تسليم {item.name}</span>
                            </button>
                          );
                        })
                      )}
                    </div>

                    {/* Mapped Display Fields (compact, non-redundant) */}
                    {visibleFields.length > 0 && (
                      <div className="grid grid-cols-2 gap-2.5 pt-1">
                        {visibleFields.map((field) => {
                          const value = selectedParticipant.dynamicData[field];
                          const label = activeEvent?.displayLabels?.[field] || field;
                          const isHighlight = /مقاس|size|تيشيرت|صدر|bib/i.test(field);
                          return (
                            <div
                              key={field}
                              className={`rounded-2xl p-2.5 sm:p-3 border ${
                                isHighlight
                                  ? 'bg-slate-900 dark:bg-neutral-900 text-white border-slate-800 dark:border-neutral-700'
                                  : 'bg-slate-50 dark:bg-black text-slate-900 dark:text-white border-slate-200 dark:border-neutral-800'
                              }`}
                            >
                              <div
                                className={`text-xs font-semibold ${
                                  isHighlight
                                    ? 'text-slate-300 dark:text-neutral-400'
                                    : 'text-slate-500 dark:text-neutral-400'
                                }`}
                              >
                                {label}
                              </div>
                              <div
                                className={`mt-0.5 font-bold break-words ${
                                  isHighlight
                                    ? 'text-xl sm:text-2xl font-mono-num text-emerald-400'
                                    : 'text-sm sm:text-base font-mono-num'
                                }`}
                              >
                                {value}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                );
              })() : (
                <div className="rounded-3xl border border-dashed border-slate-300 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-8 text-center">
                  <UserCheck className="w-12 h-12 text-emerald-600 dark:text-emerald-400 mx-auto mb-3" />
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    في انتظار مسح باركود المتسابق
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-neutral-400 max-w-md mx-auto leading-relaxed">
                    امسح الباركود بالكاميرا أو ابحث بالاسم أو رقم الصدر أو آخر 4 أرقام من الموبايل لعرض بيانات المتسابق وتأكيد التسليم بضغطة واحدة.
                  </p>
                  <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                    {participants.slice(0, 3).map((sample) => (
                      <button
                        key={sample.barcode}
                        type="button"
                        onClick={() => handleSelectParticipant(sample)}
                        className="rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black px-3 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-200 hover:border-emerald-500 min-h-[44px]"
                      >
                        معاينة: {extractParticipantDisplayName(sample, activeEvent?.displayFields ?? [])} ({sample.barcode})
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-500 px-1 pt-2">
              <span>{organizer.boothName || 'نقطة التوزيع النشطة'} · مسجل محلياً على الهاتف</span>
              <button
                type="button"
                onClick={handleClearSavedSession}
                className="underline underline-offset-4 hover:text-slate-800 dark:hover:text-neutral-200 py-1"
              >
                تسجيل خروج من الهاتف
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};
