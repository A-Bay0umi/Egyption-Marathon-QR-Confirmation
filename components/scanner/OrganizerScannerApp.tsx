'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ClipboardList,
  Link2,
  Moon,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sun,
  UserCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { BarcodeCamera, type BarcodeCameraHandle } from './BarcodeCamera';
import { BrandLogo } from '@/components/BrandLogo';
import { PWAInstallButton } from '@/components/PWAInstallButton';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useWebAudio } from '@/hooks/useWebAudio';
import {
  clearOrganizerSessionLocally,
  isAdminSavedLocally,
  parseOrganizerMagicInput,
  readOrganizerSessionLocally,
  saveOrganizerSessionLocally,
  type SavedOrganizerSession,
} from '@/lib/admin-auth';
import { testFirestoreConnection } from '@/lib/firebase';
import {
  commitAtomicDelivery,
  subscribeEventOrganizers,
  subscribeEventParticipants,
  subscribeOrganizerByToken,
  subscribeSingleEvent,
} from '@/lib/firestore-store';
import {
  countEligibleForItem,
  extractParticipantDisplayName,
  formatArabicTime,
  getPrerequisiteItem,
  isPrerequisiteMet,
  matchesSearchQuery,
  normalizeBarcode,
} from '@/lib/marathon-logic';
import type { DeliverableItem, MarathonEvent, Organizer, Participant } from '@/lib/types';

const THEME_STORAGE_KEY = 'marathon_high_contrast_dark';

export const OrganizerScannerApp: React.FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnline = useOnlineStatus();
  const {
    unlockAudio,
    vibrateLight,
    playSuccessSound,
    playDuplicateAlertSound,
    playNotFoundSound,
  } = useWebAudio();
  const cameraRef = useRef<BarcodeCameraHandle | null>(null);

  const [sessionReady, setSessionReady] = useState(false);
  const [session, setSession] = useState<SavedOrganizerSession | null>(null);
  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  // Manual link/code activation inside standalone installed PWA
  const [invitePasteInput, setInvitePasteInput] = useState('');
  const [invitePasteError, setInvitePasteError] = useState<string | null>(null);

  // Hidden Admin shortcut gesture state (5 rapid taps OR 1.5s long-press — zero visible UI/hints)
  const tapCountRef = useRef(0);
  const lastTapAtRef = useRef(0);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Live Firestore data for the organizer's assigned event
  const [eventData, setEventData] = useState<MarathonEvent | null>(null);
  const [eventLoaded, setEventLoaded] = useState(false);
  const [organizer, setOrganizer] = useState<Organizer | null>(null);
  const [organizerLoaded, setOrganizerLoaded] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);

  // Selected task state (null prompts task picker when organizer has multiple tasks)
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);

  // Scanner & Search UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBarcode, setSelectedBarcode] = useState<string | null>(null);
  const [deliveringId, setDeliveringId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  // Hydrate theme, admin local flag, and last opened event/token session
  useEffect(() => {
    void testFirestoreConnection();

    const urlEventId = searchParams.get('event')?.trim() ?? '';
    const urlToken = searchParams.get('token')?.trim() ?? '';

    queueMicrotask(() => {
      const savedDark = window.localStorage.getItem(THEME_STORAGE_KEY) === 'true';
      setDarkMode(savedDark);
      document.documentElement.classList.toggle('dark', savedDark);
      setAdminLoggedIn(isAdminSavedLocally());

      if (urlEventId && urlToken) {
        const nextSession: SavedOrganizerSession = { eventId: urlEventId, token: urlToken };
        saveOrganizerSessionLocally(nextSession);
        setSession(nextSession);
      } else {
        const saved = readOrganizerSessionLocally();
        setSession(saved);
      }
      setSessionReady(true);
    });
  }, [searchParams]);

  // Subscribe to Firebase Firestore for this specific event & organizer token
  useEffect(() => {
    if (!session) return;

    const unsubEvent = subscribeSingleEvent(session.eventId, (ev) => {
      setEventData(ev);
      setEventLoaded(true);
    });

    const unsubOrg = subscribeOrganizerByToken(session.eventId, session.token, (org) => {
      setOrganizer(org);
      setOrganizerLoaded(true);
    });

    const unsubOrgFallback = subscribeEventOrganizers(session.eventId, (list) => {
      const found = list.find((o) => o.magicToken === session.token) ?? null;
      if (found) {
        setOrganizer(found);
        setOrganizerLoaded(true);
      }
    });

    const unsubParticipants = subscribeEventParticipants(session.eventId, setParticipants);

    return () => {
      unsubEvent();
      unsubOrg();
      unsubOrgFallback();
      unsubParticipants();
    };
  }, [session]);

  const handleSecretAdminTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTapAtRef.current > 2000) {
      tapCountRef.current = 0;
    }
    lastTapAtRef.current = now;
    tapCountRef.current += 1;
    if (tapCountRef.current >= 5) {
      tapCountRef.current = 0;
      router.push('/admin');
    }
  }, [router]);

  const handleSecretLongPressStart = useCallback(() => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      router.push('/admin');
    }, 1500);
  }, [router]);

  const handleSecretLongPressEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleActivatePastedInvite = (e: React.FormEvent) => {
    e.preventDefault();
    unlockAudio();
    const parsed = parseOrganizerMagicInput(invitePasteInput);
    if (!parsed) {
      setInvitePasteError(
        'لم يتم التعرف على رابط أو كود التفعيل. الصق رابط الدعوة أو رسالة الواتساب كاملة.'
      );
      return;
    }
    setInvitePasteError(null);
    saveOrganizerSessionLocally(parsed);
    setEventLoaded(false);
    setOrganizerLoaded(false);
    setSession(parsed);
    setInvitePasteInput('');
  };

  const assignedDeliverables: DeliverableItem[] = useMemo(() => {
    if (!eventData || !organizer) return [];
    return eventData.deliverableItems.filter((item) =>
      organizer.assignedItems.includes(item.id)
    );
  }, [eventData, organizer]);

  // Active single deliverable based on organizer's chosen task
  const activeRoleItems: DeliverableItem[] = useMemo(() => {
    if (assignedDeliverables.length === 0) return [];
    if (assignedDeliverables.length === 1) return assignedDeliverables;
    if (!selectedRoleId) return [];
    const match = assignedDeliverables.find((i) => i.id === selectedRoleId);
    return match ? [match] : [];
  }, [assignedDeliverables, selectedRoleId]);

  const needsRolePicker = assignedDeliverables.length > 1 && activeRoleItems.length === 0;

  // Chained counters per assigned role (based on prerequisite completions)
  const roleStatsMap = useMemo(() => {
    const map = new Map<
      string,
      {
        deliveredByMe: number;
        totalDelivered: number;
        eligible: number;
        prerequisiteName: string | null;
      }
    >();
    if (!eventData || !organizer) return map;

    for (const item of assignedDeliverables) {
      let deliveredByMe = 0;
      let totalDelivered = 0;
      for (const p of participants) {
        const rec = p.deliveries?.[item.id];
        if (rec?.status === 'delivered') {
          totalDelivered += 1;
          if (rec.deliveredByOrganizerId === organizer.id) {
            deliveredByMe += 1;
          }
        }
      }
      const { eligible, prerequisiteItem } = countEligibleForItem(
        participants,
        item,
        eventData.deliverableItems
      );
      map.set(item.id, {
        deliveredByMe,
        totalDelivered,
        eligible,
        prerequisiteName: prerequisiteItem?.name ?? null,
      });
    }
    return map;
  }, [assignedDeliverables, eventData, organizer, participants]);

  // Header counter: counts strictly against active task's prerequisite
  const headerProgress = useMemo(() => {
    if (!eventData || !organizer) {
      return { count: 0, target: 0, prereqName: null as string | null };
    }
    if (activeRoleItems.length === 1) {
      const stat = roleStatsMap.get(activeRoleItems[0].id);
      if (stat) {
        return {
          count: stat.deliveredByMe,
          target: stat.eligible,
          prereqName: stat.prerequisiteName,
        };
      }
    }
    return {
      count: organizer.deliveredCount,
      target: eventData.totalParticipants || participants.length,
      prereqName: null as string | null,
    };
  }, [activeRoleItems, eventData, organizer, participants.length, roleStatsMap]);

  const selectedParticipant = useMemo(() => {
    if (!selectedBarcode) return null;
    return participants.find((p) => p.barcode === selectedBarcode) ?? null;
  }, [participants, selectedBarcode]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim();
    if (!q) return [];
    return participants.filter((p) => matchesSearchQuery(p, q)).slice(0, 8);
  }, [participants, searchQuery]);

  const toggleDarkMode = () => {
    const next = !darkMode;
    setDarkMode(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, String(next));
    document.documentElement.classList.toggle('dark', next);
  };

  const handleSelectParticipant = useCallback(
    (participant: Participant) => {
      void cameraRef.current?.stopCamera();
      setSelectedBarcode(participant.barcode);
      setSearchQuery('');
      setFeedbackBanner(null);

      const allItems = eventData?.deliverableItems ?? [];
      const hasBlockOrDuplicate = activeRoleItems.some((item) => {
        const already = participant.deliveries?.[item.id]?.status === 'delivered';
        const missingPrereq = !isPrerequisiteMet(participant, item, allItems);
        return already || missingPrereq;
      });
      if (hasBlockOrDuplicate) {
        playDuplicateAlertSound();
      } else {
        playSuccessSound();
      }
    },
    [activeRoleItems, eventData?.deliverableItems, playDuplicateAlertSound, playSuccessSound]
  );

  const handleBarcodeScanned = useCallback(
    (rawCode: string) => {
      vibrateLight();
      const normalized = normalizeBarcode(rawCode);
      const match =
        participants.find((p) => p.barcode.toUpperCase() === normalized.toUpperCase()) ??
        participants.find((p) => matchesSearchQuery(p, rawCode));

      if (!match) {
        playNotFoundSound();
        setSelectedBarcode(null);
        setFeedbackBanner({
          type: 'error',
          text: `لم يتم العثور على متسابق بالباركود: ${rawCode}`,
        });
        return;
      }

      handleSelectParticipant(match);
    },
    [handleSelectParticipant, participants, playNotFoundSound, vibrateLight]
  );

  const handleReopenCamera = useCallback(() => {
    unlockAudio();
    vibrateLight();
    setSelectedBarcode(null);
    setFeedbackBanner(null);
    void cameraRef.current?.startCamera();
  }, [unlockAudio, vibrateLight]);

  const handleBackToSearch = useCallback(() => {
    setSelectedBarcode(null);
    setFeedbackBanner(null);
  }, []);

  const handleConfirmDelivery = async (item: DeliverableItem) => {
    if (!eventData || !organizer || !selectedParticipant) return;
    unlockAudio();
    setDeliveringId(item.id);
    try {
      const result = await commitAtomicDelivery({
        eventId: eventData.id,
        participant: selectedParticipant,
        organizer,
        item,
        displayFields: eventData.displayFields,
        allItems: eventData.deliverableItems,
        isOnline,
      });

      if (result.ok) {
        playSuccessSound();
        setFeedbackBanner({
          type: 'success',
          text: `تم تسليم "${item.name}" بنجاح`,
        });
      } else if (result.reason === 'prerequisite_not_met') {
        playDuplicateAlertSound();
        setFeedbackBanner({
          type: 'warning',
          text: `⛔ لا يمكن تسليم "${item.name}" قبل إتمام "${result.missingItemName ?? 'الخطوة السابقة'}" أولاً!`,
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
    } finally {
      setDeliveringId(null);
    }
  };

  const handleSelectRole = useCallback(
    (roleId: string) => {
      unlockAudio();
      vibrateLight();
      setSelectedRoleId(roleId);
      setSelectedBarcode(null);
      setFeedbackBanner(null);
      setSearchQuery('');
    },
    [unlockAudio, vibrateLight]
  );

  const handleReturnToRolePicker = useCallback(() => {
    void cameraRef.current?.stopCamera();
    setSelectedRoleId(null);
    setSelectedBarcode(null);
    setFeedbackBanner(null);
    setSearchQuery('');
  }, []);

  const handleClearSession = () => {
    clearOrganizerSessionLocally();
    setSession(null);
    setEventData(null);
    setOrganizer(null);
    setEventLoaded(false);
    setOrganizerLoaded(false);
    setParticipants([]);
    setSelectedRoleId(null);
    setSelectedBarcode(null);
    setFeedbackBanner(null);
    if (window.location.search) {
      window.history.replaceState({}, '', '/');
    }
  };

  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black">
        <span className="text-sm font-semibold text-slate-600 dark:text-neutral-300">
          جاري التحميل...
        </span>
      </div>
    );
  }

  // Strictly Locked Gate when no magic link has been opened / pasted in this app container
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-black flex flex-col justify-between p-4 sm:p-6">
        <header className="max-w-lg w-full mx-auto flex items-center justify-between gap-3 py-2">
          <button
            type="button"
            aria-label="EM QR"
            onClick={handleSecretAdminTap}
            onTouchStart={handleSecretLongPressStart}
            onTouchEnd={handleSecretLongPressEnd}
            onMouseDown={handleSecretLongPressStart}
            onMouseUp={handleSecretLongPressEnd}
            onMouseLeave={handleSecretLongPressEnd}
            className="select-none text-right cursor-default"
          >
            <BrandLogo size={40} showSubtitle />
          </button>
          <div className="flex items-center gap-2">
            <PWAInstallButton compact />
            {adminLoggedIn && (
              <Link
                href="/admin"
                className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-3.5 py-2 text-xs font-bold min-h-[42px]"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>لوحة الإدارة</span>
              </Link>
            )}
            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label="تبديل تباين الشمس"
              className="p-2.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-slate-800 dark:text-white min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              {darkMode ? <Sun className="w-5 h-5 text-amber-400" /> : <Moon className="w-5 h-5" />}
            </button>
          </div>
        </header>

        <main className="max-w-lg w-full mx-auto my-auto py-6">
          <div className="rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 sm:p-8 shadow-sm text-center space-y-5">
            <div>
              <div className="flex justify-center mb-4">
                <BrandLogo size={64} showText={false} />
              </div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
                EM QR — دخول المنظمين
              </h1>
              <p className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400" dir="ltr">
                Egyptian Marathon QR
              </p>
              <p className="mt-2.5 text-sm text-slate-600 dark:text-neutral-300 leading-relaxed">
                افتح الرابط المرسل لك على واتساب، أو الصق الرابط / كود التفعيل هنا إذا قمت بتثبيت التطبيق على هاتفك.
              </p>
            </div>

            {/* Paste WhatsApp link or activation code inside standalone installed PWA */}
            <form onSubmit={handleActivatePastedInvite} className="space-y-2.5 text-right">
              <label
                htmlFor="paste-invite-input"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300"
              >
                تفعيل سريع داخل التطبيق (الصق الرابط أو رسالة الواتساب):
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  id="paste-invite-input"
                  type="text"
                  dir="ltr"
                  value={invitePasteInput}
                  onChange={(e) => {
                    setInvitePasteInput(e.target.value);
                    setInvitePasteError(null);
                  }}
                  placeholder="https://.../?event=...&token=..."
                  className="flex-1 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-xs sm:text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[46px]"
                />
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 text-sm min-h-[46px] whitespace-nowrap"
                >
                  تفعيل الدخول
                </button>
              </div>
              {invitePasteError && (
                <p className="text-xs font-semibold text-red-600">{invitePasteError}</p>
              )}
            </form>

            <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/40 p-4 text-right flex items-start gap-3">
              <Smartphone className="w-5 h-5 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div className="text-xs sm:text-sm text-emerald-950 dark:text-emerald-200 leading-relaxed">
                <strong>حفظ تلقائي لآخر إيفنت:</strong> بمجرد تفعيل الرابط، يُحفظ الإيفنت وتفاصيل بوثك تلقائياً على هاتفك للعمل فوراً حتى عند انقطاع الإنترنت.
              </div>
            </div>
          </div>
        </main>

        <footer
          onClick={handleSecretAdminTap}
          className="max-w-lg w-full mx-auto text-center text-xs text-slate-500 dark:text-neutral-500 py-2 select-none"
        >
          مقيد بروابط الدعوة المعتمدة
        </footer>
      </div>
    );
  }

  // Loading Firebase state for this saved session
  if (!eventLoaded || !organizerLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black">
        <div className="text-sm font-semibold text-slate-600 dark:text-neutral-300">
          جاري تحميل بيانات الإيفنت من Firebase...
        </div>
      </div>
    );
  }

  // Kill-Switch, Deleted Event, or Invalid Token Lock Screen
  if (!eventData || !organizer || !organizer.isActive) {
    const isFrozen = Boolean(organizer && !organizer.isActive);
    return (
      <div className="min-h-screen flex items-center justify-center bg-red-950 text-white p-6">
        <div className="max-w-md w-full rounded-3xl border border-red-700 bg-black/70 p-8 text-center shadow-2xl">
          <ShieldAlert className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold leading-snug">
            {isFrozen
              ? '⛔ تم إيقاف هذا الرابط من قِبل الإدارة'
              : '⛔ رابط الدخول غير صالح أو تم حذف الإيفنت'}
          </h1>
          <p className="mt-3 text-sm text-red-200 leading-relaxed">
            {isFrozen
              ? 'تم تجميد صلاحيات هذا المنظم مؤقتاً من لوحة تحكم الإدارة. يرجى مراجعة المشرف لإعادة التفعيل.'
              : 'يرجى طلب رابط محدث للإيفنت الحالي من مدير السباق عبر واتساب.'}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={handleClearSession}
              className="w-full rounded-xl bg-white text-slate-900 font-bold py-3 px-4 min-h-[48px] hover:bg-slate-100"
            >
              مسح الجلسة المحفوظة من الهاتف
            </button>
            {adminLoggedIn && (
              <Link
                href="/admin"
                className="text-xs text-red-200 underline underline-offset-4 py-2"
              >
                لوحة الإدارة
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black text-slate-900 dark:text-white pb-16">
      {/* Compact Sticky Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-neutral-800 bg-white/95 dark:bg-black/95 backdrop-blur-md">
        <div className="max-w-4xl mx-auto px-3 sm:px-4 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <BrandLogo size={36} showText={false} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white truncate">
                <button
                  type="button"
                  onClick={handleSecretAdminTap}
                  onTouchStart={handleSecretLongPressStart}
                  onTouchEnd={handleSecretLongPressEnd}
                  onMouseDown={handleSecretLongPressStart}
                  onMouseUp={handleSecretLongPressEnd}
                  onMouseLeave={handleSecretLongPressEnd}
                  className="truncate text-right select-none cursor-default"
                >
                  {organizer.name}
                </button>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span
                  data-testid="organizer-chained-counter"
                  className="text-emerald-700 dark:text-emerald-400 font-mono-num whitespace-nowrap"
                >
                  إنجازك: {headerProgress.count} / {headerProgress.target}
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-neutral-400 truncate mt-0.5">
                <span className="truncate">
                  {headerProgress.prereqName
                    ? `${eventData.name} · محسوب على "${headerProgress.prereqName}"`
                    : eventData.name}
                </span>
                <span aria-hidden="true">·</span>
                {isOnline ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold whitespace-nowrap">
                    <Wifi className="w-3.5 h-3.5" />
                    <span>متصل</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-semibold whitespace-nowrap">
                    <WifiOff className="w-3.5 h-3.5" />
                    <span>أوفلاين</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <PWAInstallButton compact />
            {adminLoggedIn && (
              <Link
                href="/admin"
                className="inline-flex items-center justify-center gap-1 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-black px-3 py-2 text-xs font-bold min-h-[42px] whitespace-nowrap"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>الإدارة</span>
              </Link>
            )}
            <button
              type="button"
              onClick={toggleDarkMode}
              aria-label="الوضع الليلي / تباين الشمس"
              className="inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-neutral-700 bg-slate-100 dark:bg-neutral-900 px-2.5 py-2 text-xs font-bold text-slate-800 dark:text-white min-h-[42px] min-w-[42px]"
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
        {needsRolePicker ? (
          <section
            data-testid="role-picker-screen"
            aria-label="اختيار المهمة"
            className="space-y-4 pt-2"
          >
            <div className="rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 sm:p-6 shadow-sm space-y-2 text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <ClipboardList className="w-6 h-6" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                اختر المهمة التي ستعمل عليها
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-neutral-400 max-w-md mx-auto leading-relaxed">
                لديك {assignedDeliverables.length} مهام مخصصة في {eventData.name}. اضغط على أي مهمة لبدء المسح والتسليم، ويمكنك الرجوع لتغييرها في أي وقت.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {assignedDeliverables.map((role, idx) => {
                const stat = roleStatsMap.get(role.id);
                const total = stat?.eligible ?? 0;
                const done = stat?.totalDelivered ?? 0;
                const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

                return (
                  <button
                    key={role.id}
                    type="button"
                    data-testid={`pick-role-${role.id}`}
                    onClick={() => handleSelectRole(role.id)}
                    className="group rounded-3xl border-2 border-slate-200 dark:border-neutral-800 hover:border-emerald-500 dark:hover:border-emerald-500 bg-white dark:bg-neutral-950 p-5 text-right shadow-sm transition-all active:scale-[0.99] space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <span className="inline-block text-[11px] font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-0.5 rounded-lg">
                          مهمة #{idx + 1}
                        </span>
                        <h2 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white truncate">
                          {role.name}
                        </h2>
                        {stat?.prerequisiteName && (
                          <div className="text-xs text-amber-700 dark:text-amber-400 font-semibold">
                            تُسلَّم بعد: {stat.prerequisiteName}
                          </div>
                        )}
                      </div>
                      <span className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 group-hover:bg-emerald-700 transition-colors">
                        <ChevronLeft className="w-5 h-5" />
                      </span>
                    </div>

                    <div className="space-y-1.5 pt-1">
                      <div className="flex items-center justify-between text-xs font-bold font-mono-num text-slate-600 dark:text-neutral-300">
                        <span>
                          الإنجاز: {done} / {total}
                        </span>
                        <span className="text-emerald-700 dark:text-emerald-400">{pct}%</span>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-neutral-900 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-emerald-600 transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-500 px-1 pt-2">
              <span>{organizer.boothName || eventData.name} · محفوظ محلياً على الهاتف</span>
              <button
                type="button"
                onClick={handleClearSession}
                className="underline underline-offset-4 hover:text-slate-800 dark:hover:text-neutral-200 py-1"
              >
                مسح الجلسة
              </button>
            </div>
          </section>
        ) : (
          <>
            {/* Top Back Bar to change active task when organizer has multiple tasks */}
            {assignedDeliverables.length > 1 && activeRoleItems[0] && (
              <div
                data-testid="active-role-top-bar"
                className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-2.5 shadow-sm"
              >
                <button
                  type="button"
                  data-testid="switch-role-back-btn"
                  onClick={handleReturnToRolePicker}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 dark:bg-neutral-900 hover:bg-slate-200 dark:hover:bg-neutral-800 px-3.5 py-2 text-xs sm:text-sm font-bold text-slate-800 dark:text-white min-h-[42px] whitespace-nowrap transition-colors"
                >
                  <ArrowRight className="w-4 h-4 shrink-0" />
                  <span>رجوع للمهام</span>
                </button>
                <div className="min-w-0 text-left px-1">
                  <div className="text-[11px] font-semibold text-slate-500 dark:text-neutral-400">
                    المهمة الحالية
                  </div>
                  <div className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400 truncate">
                    {activeRoleItems[0].name}
                  </div>
                </div>
              </div>
            )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Scanner & Search Column — hidden automatically after barcode scan so participant view takes the full screen */}
          <div className={selectedParticipant ? 'hidden' : 'lg:col-span-5 space-y-3'}>
            <BarcodeCamera
              ref={cameraRef}
              onScan={handleBarcodeScanned}
              autoStopOnScan
              onUserGesture={unlockAudio}
            />

            <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3 sm:p-4">
              <label
                htmlFor="fallback-search-input"
                className="block text-sm font-bold text-slate-900 dark:text-white mb-2"
              >
                البحث الذكي الفوري
              </label>
              <div className="relative">
                <Search className="w-5 h-5 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="fallback-search-input"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="ابحث بالاسم، الباركود، رقم الصدر، أو آخر 4 أرقام..."
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
                      const displayName = extractParticipantDisplayName(p, eventData.displayFields);
                      const sizeVal =
                        p.dynamicData['مقاس التيشيرت'] || p.dynamicData['Size'] || '';
                      const bibVal = p.dynamicData['رقم الصدر'] || p.dynamicData['Bib'] || '';
                      return (
                        <button
                          key={p.barcode}
                          type="button"
                          onClick={() => {
                            unlockAudio();
                            handleSelectParticipant(p);
                          }}
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

          {/* Participant Card & Action Column — expands full-width when a participant is scanned/selected */}
          <div className={selectedParticipant ? 'lg:col-span-12 space-y-4' : 'lg:col-span-7 space-y-4'}>
            {selectedParticipant && (
              <div
                data-testid="post-scan-top-bar"
                className="flex items-center gap-2 rounded-2xl border border-emerald-200 dark:border-emerald-900/70 bg-white dark:bg-neutral-950 p-2.5 shadow-sm"
              >
                <button
                  type="button"
                  data-testid="reopen-camera-btn"
                  onClick={handleReopenCamera}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-sm sm:text-base py-3 px-4 min-h-[50px] shadow-sm transition-all"
                >
                  <Camera className="w-5 h-5 shrink-0" />
                  <span>فتح الكاميرا</span>
                </button>
                <button
                  type="button"
                  data-testid="back-to-search-btn"
                  onClick={handleBackToSearch}
                  className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-100 dark:bg-neutral-900 hover:bg-slate-200 dark:hover:bg-neutral-800 text-slate-800 dark:text-neutral-100 font-bold text-xs sm:text-sm py-3 px-3.5 min-h-[50px] whitespace-nowrap"
                >
                  <Search className="w-4 h-4 shrink-0" />
                  <span>بحث يدوي</span>
                </button>
              </div>
            )}

            {feedbackBanner && (
              <div
                role="status"
                className={`rounded-2xl p-3.5 text-sm font-bold flex flex-wrap items-center justify-between gap-2.5 border ${
                  feedbackBanner.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700'
                    : feedbackBanner.type === 'warning'
                    ? 'bg-amber-50 dark:bg-amber-950/60 text-amber-900 dark:text-amber-200 border-amber-300 dark:border-amber-700'
                    : 'bg-red-50 dark:bg-red-950/60 text-red-900 dark:text-red-200 border-red-300 dark:border-red-700'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {feedbackBanner.type === 'success' ? (
                    <CheckCircle2 className="w-5 h-5 shrink-0" />
                  ) : (
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                  )}
                  <span>{feedbackBanner.text}</span>
                </div>
                {!selectedParticipant && feedbackBanner.type === 'error' && (
                  <button
                    type="button"
                    onClick={handleReopenCamera}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-red-700 hover:bg-red-800 text-white text-xs font-bold px-3 py-2 min-h-[38px] shrink-0"
                  >
                    <Camera className="w-4 h-4" />
                    <span>فتح الكاميرا</span>
                  </button>
                )}
              </div>
            )}

            <AnimatePresence mode="wait">
              {selectedParticipant ? (() => {
                const participantDisplayName = extractParticipantDisplayName(
                  selectedParticipant,
                  eventData.displayFields
                );
                const visibleFields = (
                  eventData.displayFields.length > 0
                    ? eventData.displayFields
                    : Object.keys(selectedParticipant.dynamicData)
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
                    data-testid="participant-full-card"
                    className="rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-4 sm:p-5 shadow-sm space-y-4"
                  >
                    <div className="space-y-3.5">
                    <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-neutral-800">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-500 dark:text-neutral-400">
                          باركود:{' '}
                          <span dir="ltr" className="font-ascii-mono">
                            {selectedParticipant.barcode}
                          </span>
                        </div>
                        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white mt-0.5 leading-tight">
                          {participantDisplayName}
                        </h2>
                      </div>
                      <button
                        type="button"
                        onClick={handleBackToSearch}
                        aria-label="إغلاق بطاقة المتسابق"
                        className="p-2 rounded-xl bg-slate-100 dark:bg-neutral-900 text-slate-600 dark:text-neutral-300 hover:bg-slate-200 dark:hover:bg-neutral-800 min-h-[44px] min-w-[44px] flex items-center justify-center shrink-0"
                      >
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Active Role(s) Action Buttons with Sequential Prerequisite Guards */}
                    <div className="space-y-2.5">
                      <h3 className="text-xs sm:text-sm font-bold text-slate-700 dark:text-neutral-300">
                        {activeRoleItems.length === 1
                          ? `الوظيفة الحالية: ${activeRoleItems[0].name}`
                          : `المهام المخصصة (${organizer.boothName || organizer.name})`}
                      </h3>

                      {activeRoleItems.length === 0 ? (
                        <div className="rounded-2xl border border-slate-200 dark:border-neutral-800 p-4 text-sm text-slate-500 dark:text-neutral-400">
                          لم يتم تعيين مهام لهذا المنظم في هذا الإيفنت.
                        </div>
                      ) : (
                        activeRoleItems.map((item) => {
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

                          const prereqItem = getPrerequisiteItem(item, eventData.deliverableItems);
                          const prereqOk = isPrerequisiteMet(
                            selectedParticipant,
                            item,
                            eventData.deliverableItems
                          );

                          if (prereqItem && !prereqOk) {
                            return (
                              <div
                                key={item.id}
                                data-testid={`prereq-blocked-${item.id}`}
                                className="rounded-2xl border-2 border-amber-500 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/60 p-3.5 text-amber-950 dark:text-amber-100"
                              >
                                <div className="flex items-center gap-2 text-base font-bold">
                                  <Link2 className="w-5 h-5 text-amber-700 dark:text-amber-400 shrink-0" />
                                  <span>⛔ لا يمكن تسليم {item.name} الآن</span>
                                </div>
                                <div className="mt-1 text-sm font-semibold text-amber-900 dark:text-amber-200">
                                  يجب إتمام &quot;{prereqItem.name}&quot; لهذا المتسابق أولاً.
                                </div>
                              </div>
                            );
                          }

                          return (
                            <button
                              key={item.id}
                              type="button"
                              disabled={deliveringId === item.id}
                              data-testid={`deliver-btn-${item.id}`}
                              onClick={() => void handleConfirmDelivery(item)}
                              className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-lg py-3.5 px-5 min-h-[56px] flex items-center justify-center gap-2.5 shadow-sm transition-all disabled:opacity-60"
                            >
                              <ShieldCheck className="w-6 h-6 shrink-0" />
                              <span>
                                {deliveringId === item.id
                                  ? 'جاري التسليم...'
                                  : `✅ تأكيد تسليم ${item.name}`}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>

                    </div>

                    {/* Mapped Display Fields */}
                    {visibleFields.length > 0 && (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                        {visibleFields.map((field) => {
                          const value = selectedParticipant.dynamicData[field];
                          const label = eventData.displayLabels?.[field] || field;
                          const isHighlight = /مقاس|size|تيشيرت|صدر|bib/i.test(field);
                          return (
                            <div
                              key={field}
                              className={`rounded-2xl p-3 sm:p-4 border ${
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
                                className={`mt-1 font-bold break-words ${
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
                    {participants.length === 0
                      ? 'لا يوجد متسابقون في هذا الإيفنت بعد'
                      : 'في انتظار مسح باركود المتسابق'}
                  </h2>
                  <p className="mt-1.5 text-sm text-slate-500 dark:text-neutral-400 max-w-md mx-auto leading-relaxed">
                    {participants.length === 0
                      ? 'سيظهر المتسابقون هنا فور إضافتهم من لوحة الإدارة.'
                      : 'امسح الباركود بالكاميرا أو ابحث بالاسم أو رقم الصدر أو آخر 4 أرقام من الموبايل لعرض البطاقة وتأكيد التسليم.'}
                  </p>
                </div>
              )}
            </AnimatePresence>

            <div className="flex items-center justify-between text-xs text-slate-500 dark:text-neutral-500 px-1 pt-2">
              <span>{organizer.boothName || eventData.name} · محفوظ محلياً على الهاتف</span>
              <button
                type="button"
                onClick={handleClearSession}
                className="underline underline-offset-4 hover:text-slate-800 dark:hover:text-neutral-200 py-1"
              >
                مسح الجلسة
              </button>
            </div>
          </div>
        </div>
          </>
        )}
      </main>
    </div>
  );
};
