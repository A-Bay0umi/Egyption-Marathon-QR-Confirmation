import fs from 'fs';
import path from 'path';
import type { MetadataRoute } from 'next';

export const dynamic = 'force-dynamic';

function readPublicLogoSize(): string {
  try {
    const logoPath = path.join(process.cwd(), 'public', 'logo.png');
    const buf = fs.readFileSync(logoPath);
    if (buf.length >= 24 && buf.toString('ascii', 1, 4) === 'PNG') {
      const w = buf.readUInt32BE(16);
      const h = buf.readUInt32BE(20);
      if (w > 0 && h > 0) {
        return `${w}x${h}`;
      }
    }
  } catch {
    // Fallback below
  }
  return '512x512';
}

export default function manifest(): MetadataRoute.Manifest {
  const logoSizes = readPublicLogoSize();

  return {
    id: '/',
    name: 'EM QR — Egyptian Marathon QR',
    short_name: 'EM QR',
    description: 'نظام توزيع مستلزمات الماراثون وفحص الباركود EM QR مع دعم العمل بدون إنترنت',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    dir: 'rtl',
    lang: 'ar',
    background_color: '#000000',
    theme_color: '#059669',
    icons: [
      {
        src: '/logo.png',
        sizes: logoSizes,
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/logo.png',
        sizes: logoSizes,
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
