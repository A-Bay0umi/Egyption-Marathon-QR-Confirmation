'use client';

import React, { useState } from 'react';
import {
  Check,
  Copy,
  MessageCircle,
  MessageSquareText,
  Phone,
  Plus,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import {
  buildOrganizerMagicUrl,
  buildOrganizerWhatsAppHref,
  buildOrganizerWhatsAppMessage,
  normalizeWhatsAppPhone,
} from '@/lib/admin-auth';
import {
  saveOrganizerRemote,
  toggleOrganizerFreezeRemote,
  updateLocalState,
} from '@/lib/demo-store';
import type { MarathonEvent, Organizer } from '@/lib/types';

interface OrganizersTabProps {
  activeEvent: MarathonEvent | null;
  organizers: Organizer[];
  useFirestore: boolean;
  idToken: string | null;
}

export const OrganizersTab: React.FC<OrganizersTabProps> = ({
  activeEvent,
  organizers,
  useFirestore,
  idToken,
}) => {
  const [name, setName] = useState('');
  const [boothName, setBoothName] = useState('');
  const [whatsappPhone, setWhatsappPhone] = useState('');
  const [assignedItems, setAssignedItems] = useState<string[]>(
    activeEvent?.deliverableItems.map((i) => i.id) ?? []
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const eventOrganizers = activeEvent
    ? organizers.filter((o) => o.eventId === activeEvent.id)
    : organizers;

  const toggleItem = (id: string) => {
    setAssignedItems((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleCreateOrganizer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeEvent) {
      setFormError('يرجى تفعيل إيفنت أولاً');
      return;
    }
    if (!name.trim()) {
      setFormError('يرجى إدخال اسم المنظم');
      return;
    }
    if (assignedItems.length === 0) {
      setFormError('اختر عنصراً واحداً على الأقل من مستلزمات التسليم');
      return;
    }
    setFormError(null);

    const token = `ORG-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const cleanPhone = normalizeWhatsAppPhone(whatsappPhone);
    const newOrg: Organizer = {
      id: `org_${Date.now().toString(36)}`,
      eventId: activeEvent.id,
      name: name.trim(),
      boothName: boothName.trim(),
      whatsappPhone: cleanPhone || undefined,
      assignedItems,
      magicToken: token,
      isActive: true,
      deliveredCount: 0,
      createdAt: new Date().toISOString(),
    };

    updateLocalState((prev) => ({
      ...prev,
      organizers: [newOrg, ...prev.organizers],
    }));
    void saveOrganizerRemote(newOrg, useFirestore, idToken);

    setName('');
    setBoothName('');
    setWhatsappPhone('');
  };

  const getMagicLink = (org: Organizer) => {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'https://marathon.app';
    return buildOrganizerMagicUrl(origin, org, activeEvent);
  };

  const handleCopyLink = async (org: Organizer) => {
    const url = getMagicLink(org);
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(org.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const handleCopyMessage = async (org: Organizer) => {
    const url = getMagicLink(org);
    const msg = buildOrganizerWhatsAppMessage(url, org, activeEvent);
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedMsgId(org.id);
      setTimeout(() => setCopiedMsgId(null), 2000);
    } catch {
      // Fallback ignored
    }
  };

  const buildWhatsAppUrl = (org: Organizer) => {
    const url = getMagicLink(org);
    return buildOrganizerWhatsAppHref(url, org, activeEvent);
  };

  const handleToggleKillSwitch = (org: Organizer) => {
    const nextActive = !org.isActive;
    updateLocalState((prev) => ({
      ...prev,
      organizers: prev.organizers.map((o) =>
        o.id === org.id ? { ...o, isActive: nextActive } : o
      ),
    }));
    void toggleOrganizerFreezeRemote(org.id, nextActive, useFirestore, idToken);
  };

  return (
    <div className="space-y-6">
      {/* Info Banner: Link-Only Organizer Access */}
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/70 dark:bg-emerald-950/30 p-4 text-xs sm:text-sm text-emerald-950 dark:text-emerald-200 leading-relaxed">
        <strong>تنويه مهم:</strong> لا يمكن لأي منظم فتح شاشة التوزيع إلا عبر رابط الدخول الخاص المرسل له هنا. بمجرد فتح الرابط على هاتف المنظم، يتم <strong>حفظ تسجيل دخوله محلياً على الهاتف</strong> تلقائياً للعمل حتى بدون إنترنت.
      </div>

      {/* Create Organizer Form */}
      <form
        onSubmit={handleCreateOrganizer}
        className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <UserPlus className="w-5 h-5 text-emerald-600" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            إضافة منظم جديد وإصدار رابط دخول واتساب
          </h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="org-name-input"
              className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
            >
              اسم المنظم
            </label>
            <input
              id="org-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: خالد محمود"
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>
          <div>
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
              placeholder="مثال: بوث C - شرائح التوقيت"
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>
          <div>
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
                className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-9 pl-3 py-2.5 text-sm font-ascii-mono text-slate-900 dark:text-white min-h-[44px]"
              />
            </div>
          </div>
        </div>

        <div>
          <div className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-2">
            المستلزمات المصرح له بتسليمها:
          </div>
          <div className="flex flex-wrap gap-2">
            {(activeEvent?.deliverableItems ?? []).map((item) => (
              <label
                key={item.id}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black px-3.5 py-2 text-xs font-semibold cursor-pointer min-h-[44px]"
              >
                <input
                  type="checkbox"
                  checked={assignedItems.includes(item.id)}
                  onChange={() => toggleItem(item.id)}
                  className="w-4 h-4 accent-emerald-600 rounded"
                />
                <span>{item.name}</span>
              </label>
            ))}
          </div>
        </div>

        {formError && <p className="text-xs font-semibold text-red-600">{formError}</p>}

        <button
          type="submit"
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-5 py-2.5 text-sm min-h-[44px]"
        >
          <Plus className="w-4 h-4" />
          <span>إنشاء المنظم وتوليد رابط واتساب</span>
        </button>
      </form>

      {/* Organizers List with Magic Link + WhatsApp + Kill-Switch */}
      <div className="space-y-3">
        {eventOrganizers.map((org) => {
          const assignedNames = (activeEvent?.deliverableItems ?? [])
            .filter((i) => org.assignedItems.includes(i.id))
            .map((i) => i.name)
            .join(' · ');

          return (
            <div
              key={org.id}
              data-testid={`organizer-row-${org.magicToken}`}
              className={`rounded-2xl border p-4 sm:p-5 transition-colors ${
                org.isActive
                  ? 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950'
                  : 'border-red-300 dark:border-red-900 bg-red-50/40 dark:bg-red-950/20'
              }`}
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900 dark:text-white">
                      {org.name}
                    </h3>
                    {org.boothName && (
                      <span className="text-xs text-slate-500 dark:text-neutral-400">
                        · {org.boothName}
                      </span>
                    )}
                    <span className="text-xs font-mono-num font-bold text-emerald-700 dark:text-emerald-400">
                      · تم تسليم {org.deliveredCount} عنصر
                    </span>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-neutral-400">
                    الصلاحيات: {assignedNames || 'لا يوجد'} · الرمز:{' '}
                    <span dir="ltr" className="font-ascii-mono font-semibold">
                      {org.magicToken}
                    </span>
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
                    href={buildWhatsAppUrl(org)}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`whatsapp-btn-${org.magicToken}`}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 text-xs font-bold min-h-[44px]"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>
                      {org.whatsappPhone ? 'إرسال مباشر على واتساب' : 'إرسال عبر واتساب'}
                    </span>
                  </a>

                  <button
                    type="button"
                    onClick={() => void handleCopyMessage(org)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40 px-3.5 py-2 text-xs font-bold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 min-h-[44px]"
                  >
                    {copiedMsgId === org.id ? (
                      <>
                        <Check className="w-4 h-4" />
                        <span>تم نسخ الرسالة</span>
                      </>
                    ) : (
                      <>
                        <MessageSquareText className="w-4 h-4" />
                        <span>نسخ رسالة واتساب</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleCopyLink(org)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-black px-3.5 py-2 text-xs font-bold text-slate-800 dark:text-white hover:bg-slate-50 dark:hover:bg-neutral-900 min-h-[44px]"
                  >
                    {copiedId === org.id ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-600" />
                        <span>تم نسخ الرابط</span>
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
                    data-testid={`killswitch-${org.magicToken}`}
                    onClick={() => handleToggleKillSwitch(org)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold min-h-[44px] transition-colors ${
                      org.isActive
                        ? 'bg-red-600 hover:bg-red-700 text-white'
                        : 'bg-slate-900 dark:bg-white text-white dark:text-black'
                    }`}
                  >
                    {org.isActive ? (
                      <>
                        <ShieldAlert className="w-4 h-4" />
                        <span>تجميد فوري</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        <span>إعادة تفعيل الرابط</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
