'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Eye, EyeOff, Lock, Shield } from 'lucide-react';
import { ADMIN_SESSION_STORAGE_KEY, verifyAdminPasscode } from '@/lib/admin-auth';
import { signInWithGoogleSheets } from '@/lib/firebase';

interface AdminAuthGateProps {
  onPasscodeSuccess: () => void;
  onGoogleSuccess: (email: string, sheetsToken: string | null) => void;
}

export const AdminAuthGate: React.FC<AdminAuthGateProps> = ({
  onPasscodeSuccess,
  onGoogleSuccess,
}) => {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePasscodeLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setError('يرجى إدخال كلمة مرور الإدارة');
      return;
    }
    if (!verifyAdminPasscode(password)) {
      setError('كلمة المرور غير صحيحة. يرجى التأكد والمحاولة مرة أخرى.');
      return;
    }
    setError(null);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(ADMIN_SESSION_STORAGE_KEY, 'authenticated');
    }
    onPasscodeSuccess();
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await signInWithGoogleSheets();
      onGoogleSuccess(res.user.email || 'مدير السباق', res.accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(`تعذر تسجيل الدخول بحساب Google: ${msg || 'يرجى المحاولة مرة أخرى'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-black flex flex-col justify-between p-4 sm:p-6">
      <header className="max-w-md w-full mx-auto flex items-center justify-between py-2">
        <span className="text-base font-bold text-slate-900 dark:text-white">
          لوحة إدارة الماراثون
        </span>
        <Link
          href="/"
          className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline py-2"
        >
          العودة للرئيسية
        </Link>
      </header>

      <main className="max-w-md w-full mx-auto my-auto py-6">
        <div className="rounded-3xl border border-slate-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-6 sm:p-8 shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-slate-900 dark:bg-emerald-950 flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            تسجيل دخول مدير السباق
          </h1>
          <p className="mt-1.5 text-sm text-slate-600 dark:text-neutral-300 leading-relaxed">
            أدخل كلمة مرور الإدارة لإدارة الإيفنتات، إرسال روابط المنظمين عبر واتساب، ومتابعة التسليم اللحظي.
          </p>

          {error && (
            <div
              role="alert"
              className="mt-4 rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/60 p-3 text-xs font-semibold text-red-800 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <form onSubmit={handlePasscodeLogin} className="mt-5 space-y-3.5">
            <div>
              <label
                htmlFor="admin-passcode"
                className="block text-xs font-bold text-slate-700 dark:text-neutral-300 mb-1.5"
              >
                كلمة مرور الإدارة
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
              disabled={loading}
              className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 text-sm transition-colors min-h-[48px]"
            >
              دخول لوحة الإدارة
            </button>
          </form>

          <div className="my-5 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200 dark:bg-neutral-800" />
            <span className="text-xs text-slate-400">أو لمزامنة Google Sheets</span>
            <div className="h-px flex-1 bg-slate-200 dark:bg-neutral-800" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGoogleLogin()}
            className="w-full flex items-center justify-center gap-3 rounded-xl border border-slate-300 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3 text-sm font-bold text-slate-800 dark:text-white hover:bg-slate-50 dark:hover:bg-neutral-800 transition-colors min-h-[48px]"
          >
            <svg
              version="1.1"
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 48 48"
              className="w-5 h-5 shrink-0"
            >
              <path
                fill="#EA4335"
                d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
              />
              <path
                fill="#4285F4"
                d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
              />
              <path
                fill="#FBBC05"
                d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
              />
              <path
                fill="#34A853"
                d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
              />
            </svg>
            <span>تسجيل الدخول بحساب Google</span>
          </button>
        </div>
      </main>

      <footer className="max-w-md w-full mx-auto text-center text-xs text-slate-500 dark:text-neutral-500 py-2">
        نظام مؤمّن · يتم حفظ جلسة الإدارة محلياً على الجهاز
      </footer>
    </div>
  );
};
