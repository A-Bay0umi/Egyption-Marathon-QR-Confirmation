import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PWARegister } from '@/components/PWARegister';
import { OfflineIndicator } from '@/components/OfflineIndicator';

const ibmArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

const ibmMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const viewport: Viewport = {
  themeColor: '#059669',
  width: 'device-width',
  initialScale: 1,
};

export const metadata: Metadata = {
  title: 'موزع مستلزمات الماراثون - Marathon Check-in',
  description:
    'نظام توزيع مستلزمات سباقات الماراثون وفحص الباركود مع دعم العمل بدون إنترنت ومزامنة Google Sheets',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ماراثون كيت',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'موزع مستلزمات الماراثون - Marathon Check-in',
    description:
      'نظام توزيع مستلزمات سباقات الماراثون وفحص الباركود مع دعم العمل بدون إنترنت ومزامنة Google Sheets',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'موزع مستلزمات الماراثون - Marathon Check-in',
    description:
      'نظام توزيع مستلزمات سباقات الماراثون وفحص الباركود مع دعم العمل بدون إنترنت ومزامنة Google Sheets',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${ibmArabic.variable} ${ibmMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-screen bg-slate-50 text-slate-900 dark:bg-black dark:text-white antialiased selection:bg-emerald-500/20"
      >
        <ErrorBoundary>
          <PWARegister />
          {children}
          <OfflineIndicator />
        </ErrorBoundary>
      </body>
    </html>
  );
}
