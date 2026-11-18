import React, { Suspense } from 'react';
import { AdminDashboardApp } from '@/components/admin/AdminDashboardApp';

export default function AdminPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-black text-sm font-semibold text-slate-600 dark:text-neutral-300">
          جاري تحميل لوحة الإدارة...
        </div>
      }
    >
      <AdminDashboardApp />
    </Suspense>
  );
}
