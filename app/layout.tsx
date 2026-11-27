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
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: 'EM QR — Egyptian Marathon QR',
  description:
    'نظام توزيع مستلزمات الماراثون وفحص الباركود EM QR مع دعم العمل بدون إنترنت ومزامنة Firebase',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'EM QR',
  },
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
  openGraph: {
    title: 'EM QR — Egyptian Marathon QR',
    description:
      'نظام توزيع مستلزمات الماراثون وفحص الباركود EM QR مع دعم العمل بدون إنترنت ومزامنة Firebase',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'EM QR — Egyptian Marathon QR',
    description:
      'نظام توزيع مستلزمات الماراثون وفحص الباركود EM QR مع دعم العمل بدون إنترنت ومزامنة Firebase',
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
