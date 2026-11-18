'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, Lock, Shield } from 'lucide-react';
import { ADMIN_SESSION_STORAGE_KEY, verifyAdminPasscode } from '@/lib/admin-auth';

interface AdminAuthGateProps {
  onPasscodeSuccess: () => void;
}

export const AdminAuthGate: React.FC<AdminAuthGateProps> = ({ onPasscodeSuccess }) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasscodeLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('يرجى إدخال كلمة المرور');
      return;
    }
    if (!verifyAdminPasscode(password)) {
      setError('كلمة المرور غير صحيحة');
      return;
    }
    setError(null);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'authenticated');
    }
    onPasscodeSuccess();
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black flex items-center justify-center p-4 sm:p-6">
      <main className="max-w-md w-full">
        <div className="rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 sm:p-8 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-emerald-950 flex items-center justify-center mb-5">
            <Shield className="w-6 h-6 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            دخول الإدارة
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-neutral-400">
            أدخل كلمة المرور للوصول إلى إدارة الماراثونات والمنظمين.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 p-3 text-xs font-semibold text-red-800 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <form onSubmit={handlePasscodeLogin} className="mt-6 space-y-4">
            <div>
              <label
                htmlFor="admin-passcode"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
              >
                كلمة المرور
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  id="admin-passcode"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-xl border border-slate-300 dark:border-neutral-700 bg-slate-50 dark:bg-black pr-10 pl-11 py-3 text-base font-ascii-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-600 min-h-[48px]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                  className="absolute left-2 top-1/2 -translate-y-1/2 p-2 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 text-sm transition-colors min-h-[48px]"
            >
              دخول
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
