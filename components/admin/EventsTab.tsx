'use client';

import React, { useState } from 'react';
import { Calendar, CheckCircle2, Edit3, Plus, Power, Trash2 } from 'lucide-react';
import { saveEventRemote, updateLocalState } from '@/lib/demo-store';
import type { DeliverableItem, MarathonEvent } from '@/lib/types';

interface EventsTabProps {
  events: MarathonEvent[];
  useFirestore: boolean;
  idToken: string | null;
  ownerUid: string;
}

export const EventsTab: React.FC<EventsTabProps> = ({
  events,
  useFirestore,
  idToken,
  ownerUid,
}) => {
  const [name, setName] = useState('');
  const [date, setDate] = useState('2026-12-01');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newItemNames, setNewItemNames] = useState<Record<string, string>>({});
  const [editingItem, setEditingItem] = useState<{
    eventId: string;
    itemId: string;
    name: string;
  } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSaveEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !date.trim()) {
      setFormError('يرجى إدخال اسم الإيفنت وتاريخه');
      return;
    }
    setFormError(null);

    if (editingId) {
      let updatedEvent: MarathonEvent | null = null;
      updateLocalState((prev) => ({
        ...prev,
        events: prev.events.map((ev) => {
          if (ev.id !== editingId) return ev;
          updatedEvent = { ...ev, name: name.trim(), date: date.trim() };
          return updatedEvent;
        }),
      }));
      if (updatedEvent) {
        void saveEventRemote(updatedEvent, useFirestore, idToken);
      }
      setEditingId(null);
      setName('');
      return;
    }

    const id = `evt_${Date.now()}`;
    const newEvent: MarathonEvent = {
      id,
      name: name.trim(),
      date: date.trim(),
      isActive: events.length === 0,
      deliverableItems: [
        { id: 'bib', name: 'رقم الصدر (Bib)' },
        { id: 'tshirt', name: 'التيشيرت' },
      ],
      displayFields: ['الاسم', 'رقم الصدر', 'مقاس التيشيرت'],
      displayLabels: {
        الاسم: 'الاسم',
        'رقم الصدر': 'رقم الصدر',
        'مقاس التيشيرت': 'مقاس التيشيرت',
      },
      searchFields: ['الاسم', 'رقم الصدر'],
      totalParticipants: 0,
      ownerUid,
      createdAt: new Date().toISOString(),
    };

    updateLocalState((prev) => ({
      ...prev,
      events: [newEvent, ...prev.events],
      participantsByEvent: { ...prev.participantsByEvent, [id]: [] },
      logsByEvent: { ...prev.logsByEvent, [id]: [] },
    }));
    void saveEventRemote(newEvent, useFirestore, idToken);
    setName('');
  };

  const handleActivateEvent = (eventId: string) => {
    const nextEvents: MarathonEvent[] = [];
    updateLocalState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        const updated = { ...ev, isActive: ev.id === eventId };
        nextEvents.push(updated);
        return updated;
      }),
    }));
    for (const ev of nextEvents) {
      void saveEventRemote(ev, useFirestore, idToken);
    }
  };

  const handleAddDeliverable = (eventId: string) => {
    const raw = (newItemNames[eventId] ?? '').trim();
    if (!raw) return;
    const item: DeliverableItem = {
      id: `item_${Date.now().toString(36)}`,
      name: raw,
    };
    let updatedEv: MarathonEvent | null = null;
    updateLocalState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== eventId) return ev;
        updatedEv = {
          ...ev,
          deliverableItems: [...ev.deliverableItems, item],
        };
        return updatedEv;
      }),
    }));
    if (updatedEv) void saveEventRemote(updatedEv, useFirestore, idToken);
    setNewItemNames((prev) => ({ ...prev, [eventId]: '' }));
  };

  const handleDeleteDeliverable = (eventId: string, itemId: string) => {
    let updatedEv: MarathonEvent | null = null;
    updateLocalState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== eventId) return ev;
        updatedEv = {
          ...ev,
          deliverableItems: ev.deliverableItems.filter((i) => i.id !== itemId),
        };
        return updatedEv;
      }),
    }));
    if (updatedEv) void saveEventRemote(updatedEv, useFirestore, idToken);
  };

  const handleSaveItemRename = () => {
    if (!editingItem || !editingItem.name.trim()) return;
    let updatedEv: MarathonEvent | null = null;
    updateLocalState((prev) => ({
      ...prev,
      events: prev.events.map((ev) => {
        if (ev.id !== editingItem.eventId) return ev;
        updatedEv = {
          ...ev,
          deliverableItems: ev.deliverableItems.map((i) =>
            i.id === editingItem.itemId ? { ...i, name: editingItem.name.trim() } : i
          ),
        };
        return updatedEv;
      }),
    }));
    if (updatedEv) void saveEventRemote(updatedEv, useFirestore, idToken);
    setEditingItem(null);
  };

  return (
    <div className="space-y-6">
      {/* Create / Edit Event Form */}
      <form
        onSubmit={handleSaveEvent}
        className="rounded-2xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5"
      >
        <h2 className="text-base font-bold text-slate-900 dark:text-white mb-4">
          {editingId ? 'تعديل بيانات الإيفنت' : 'إنشاء إيفنت ماراثون جديد'}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div className="sm:col-span-2">
            <label
              htmlFor="event-name-input"
              className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
            >
              اسم الإيفنت
            </label>
            <input
              id="event-name-input"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="مثال: ماراثون القاهرة الدولي 2026"
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>
          <div>
            <label
              htmlFor="event-date-input"
              className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1"
            >
              تاريخ الإيفنت
            </label>
            <input
              id="event-date-input"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3.5 py-2.5 text-sm font-mono-num text-slate-900 dark:text-white min-h-[44px]"
            />
          </div>
        </div>
        {formError && <p className="mt-2 text-xs font-semibold text-red-600">{formError}</p>}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="submit"
            className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-2.5 text-sm font-bold min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            <span>{editingId ? 'حفظ التعديل' : 'إنشاء الإيفنت'}</span>
          </button>
          {editingId && (
            <button
              type="button"
              onClick={() => {
                setEditingId(null);
                setName('');
              }}
              className="rounded-xl border border-slate-300 dark:border-neutral-700 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-neutral-200 min-h-[44px]"
            >
              إلغاء
            </button>
          )}
        </div>
      </form>

      {/* Events List & Deliverable Items Builder */}
      <div className="space-y-4">
        {events.map((ev) => (
          <div
            key={ev.id}
            className={`rounded-2xl border p-5 transition-colors ${
              ev.isActive
                ? 'border-emerald-500 bg-white dark:bg-neutral-950'
                : 'border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-neutral-800">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white">{ev.name}</h3>
                  {ev.isActive && (
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>الإيفنت النشط حالياً</span>
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-neutral-400 font-mono-num">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{ev.date}</span>
                  <span aria-hidden="true">·</span>
                  <span>المتسابقون: {ev.totalParticipants}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(ev.id);
                    setName(ev.name);
                    setDate(ev.date);
                  }}
                  aria-label={`تعديل ${ev.name}`}
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-neutral-700 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-neutral-200 hover:bg-slate-100 dark:hover:bg-neutral-900 min-h-[44px]"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>تعديل</span>
                </button>
                {!ev.isActive && (
                  <button
                    type="button"
                    onClick={() => handleActivateEvent(ev.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 text-xs font-bold min-h-[44px]"
                  >
                    <Power className="w-3.5 h-3.5" />
                    <span>تفعيل هذا الإيفنت</span>
                  </button>
                )}
              </div>
            </div>

            {/* Dynamic Deliverable Items Builder */}
            <div className="mt-4">
              <h4 className="text-xs font-bold text-slate-700 dark:text-neutral-300 mb-2.5">
                المستلزمات القابلة للتسليم في هذا الإيفنت (Deliverable Items)
              </h4>

              <div className="flex flex-wrap gap-2 mb-3">
                {ev.deliverableItems.map((item) => (
                  <div
                    key={item.id}
                    className="inline-flex items-center gap-2 rounded-xl border border-slate-200 dark:border-neutral-800 bg-slate-50 dark:bg-black px-3 py-2 text-xs font-semibold text-slate-800 dark:text-neutral-200"
                  >
                    {editingItem?.eventId === ev.id && editingItem.itemId === item.id ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingItem.name}
                          onChange={(e) =>
                            setEditingItem({ ...editingItem, name: e.target.value })
                          }
                          className="rounded border border-slate-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 text-xs"
                        />
                        <button
                          type="button"
                          onClick={handleSaveItemRename}
                          className="text-emerald-600 font-bold"
                        >
                          حفظ
                        </button>
                      </div>
                    ) : (
                      <>
                        <span>{item.name}</span>
                        <button
                          type="button"
                          aria-label={`تعديل ${item.name}`}
                          onClick={() =>
                            setEditingItem({ eventId: ev.id, itemId: item.id, name: item.name })
                          }
                          className="text-slate-400 hover:text-slate-700 dark:hover:text-white"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label={`حذف ${item.name}`}
                          onClick={() => handleDeleteDeliverable(ev.id, item.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2 max-w-md">
                <input
                  type="text"
                  value={newItemNames[ev.id] ?? ''}
                  onChange={(e) =>
                    setNewItemNames((prev) => ({ ...prev, [ev.id]: e.target.value }))
                  }
                  placeholder="أضف عنصراً جديداً (مثال: ميدالية النهاية)"
                  className="flex-1 rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black px-3 py-2 text-xs text-slate-900 dark:text-white min-h-[44px]"
                />
                <button
                  type="button"
                  onClick={() => handleAddDeliverable(ev.id)}
                  className="inline-flex items-center gap-1 rounded-xl bg-slate-900 dark:bg-neutral-800 text-white px-4 py-2 text-xs font-bold hover:opacity-90 min-h-[44px]"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>إضافة عنصر</span>
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
