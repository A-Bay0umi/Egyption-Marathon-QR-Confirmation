import { NextRequest, NextResponse } from 'next/server';

function extractSpreadsheetId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : trimmed;
}

export async function GET(req: NextRequest) {
  const token = req.headers.get('Authorization');
  if (!token || !token.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'يرجى تسجيل الدخول بحساب Google لمنح صلاحية Google Sheets' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const rawId = searchParams.get('spreadsheetId') ?? '';
  const requestedSheet = searchParams.get('sheetName');
  const spreadsheetId = extractSpreadsheetId(rawId);

  if (!spreadsheetId) {
    return NextResponse.json({ error: 'يرجى إدخال رابط أو معرف جدول Google Sheets' }, { status: 400 });
  }

  try {
    // 1. Fetch spreadsheet metadata first (never hardcode "Sheet1")
    const metaRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
      { headers: { Authorization: token } }
    );

    if (!metaRes.ok) {
      const errData = await metaRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error?.message || 'تعذر الوصول إلى جدول Google Sheets' },
        { status: metaRes.status }
      );
    }

    const meta = (await metaRes.json()) as {
      properties?: { title?: string };
      sheets?: Array<{ properties?: { title?: string } }>;
    };

    const sheetTitles = (meta.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t));

    if (sheetTitles.length === 0) {
      return NextResponse.json({ error: 'الجدول لا يحتوي على أي صفحات (Tabs)' }, { status: 400 });
    }

    const targetSheet =
      requestedSheet && sheetTitles.includes(requestedSheet) ? requestedSheet : sheetTitles[0];

    const valuesRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(`'${targetSheet}'!A1:Z5000`)}`,
      { headers: { Authorization: token } }
    );

    if (!valuesRes.ok) {
      const errData = await valuesRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error?.message || 'تعذر قراءة بيانات الجدول' },
        { status: valuesRes.status }
      );
    }

    const valuesJson = (await valuesRes.json()) as { values?: string[][] };
    const grid = valuesJson.values ?? [];
    if (grid.length < 2) {
      return NextResponse.json({ error: 'الجدول فارغ أو لا يحتوي على صفوف بيانات' }, { status: 400 });
    }

    const headers = grid[0].map((h) => String(h ?? '').trim()).filter(Boolean);
    const rows = grid.slice(1).map((row) => {
      const record: Record<string, string> = {};
      headers.forEach((h, idx) => {
        record[h] = String(row[idx] ?? '').trim();
      });
      return record;
    });

    return NextResponse.json({
      title: meta.properties?.title ?? 'Google Sheet',
      sheetTitles,
      activeSheet: targetSheet,
      headers,
      rows,
    });
  } catch (error) {
    console.error('Google Sheets GET error:', error);
    return NextResponse.json({ error: 'فشل الاتصال بخدمة Google Sheets' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = req.headers.get('Authorization');
  if (!token || !token.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'يرجى تسجيل الدخول بحساب Google لمنح صلاحية Google Sheets' }, { status: 401 });
  }

  try {
    const body = (await req.json()) as {
      title: string;
      rows: string[][];
    };

    if (!body.rows || body.rows.length === 0) {
      return NextResponse.json({ error: 'لا توجد بيانات للتصدير' }, { status: 400 });
    }

    const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        properties: { title: body.title || 'تقرير تسليم مستلزمات الماراثون' },
      }),
    });

    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error?.message || 'تعذر إنشاء جدول Google Sheets جديد' },
        { status: createRes.status }
      );
    }

    const created = (await createRes.json()) as {
      spreadsheetId: string;
      spreadsheetUrl: string;
      sheets?: Array<{ properties?: { title?: string } }>;
    };

    const firstSheetTitle = created.sheets?.[0]?.properties?.title || 'Sheet1';

    const updateRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${created.spreadsheetId}/values/${encodeURIComponent(`'${firstSheetTitle}'!A1`)}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        headers: {
          Authorization: token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          values: body.rows,
        }),
      }
    );

    if (!updateRes.ok) {
      const errData = await updateRes.json().catch(() => ({}));
      return NextResponse.json(
        { error: errData.error?.message || 'تم إنشاء الملف لكن تعذر كتابة الصفوف' },
        { status: updateRes.status }
      );
    }

    return NextResponse.json({
      spreadsheetId: created.spreadsheetId,
      spreadsheetUrl: created.spreadsheetUrl,
    });
  } catch (error) {
    console.error('Google Sheets POST error:', error);
    return NextResponse.json({ error: 'فشل تصدير البيانات إلى Google Sheets' }, { status: 500 });
  }
}
