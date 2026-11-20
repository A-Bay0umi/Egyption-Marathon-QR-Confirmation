import { NextRequest, NextResponse } from 'next/server';
import { isValidAppsScriptUrl } from '@/lib/sheets-sync';

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      webhookUrl?: string;
      payload?: unknown;
    };

    const webhookUrl = typeof body.webhookUrl === 'string' ? body.webhookUrl.trim() : '';
    if (!isValidAppsScriptUrl(webhookUrl)) {
      return NextResponse.json(
        { ok: false, error: 'رابط Google Apps Script غير صالح (يجب أن يبدأ بـ https://script.google.com/)' },
        { status: 400 }
      );
    }

    const upstreamRes = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body.payload ?? {}),
      redirect: 'follow',
    });

    const rawText = await upstreamRes.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      if (!upstreamRes.ok) {
        return NextResponse.json(
          { ok: false, error: `رفض Google Apps Script الطلب (رمز ${upstreamRes.status})` },
          { status: 502 }
        );
      }
      return NextResponse.json(
        {
          ok: false,
          error:
            'تأكد من نشر Google Apps Script بصلاحية "Anyone / أي شخص" وأن رابط /exec صحيح.',
        },
        { status: 502 }
      );
    }

    if (parsed.ok !== true) {
      return NextResponse.json(
        {
          ok: false,
          error:
            typeof parsed.error === 'string'
              ? parsed.error
              : 'تعذر إتمام المزامنة داخل Google Apps Script',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      ok: true,
      updatedRows: typeof parsed.updatedRows === 'number' ? parsed.updatedRows : 0,
      insertedRows: typeof parsed.insertedRows === 'number' ? parsed.insertedRows : 0,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? `فشل الاتصال بـ Google Apps Script: ${err.message}` : 'فشل الاتصال بـ Google Apps Script',
      },
      { status: 500 }
    );
  }
}
