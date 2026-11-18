import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { NextRequest, NextResponse } from 'next/server';

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: 'مفتاح GEMINI_API_KEY غير مهيأ على الخادم. يرجى إضافته من إعدادات Secrets.' },
        { status: 500 }
      );
    }

    const body = await req.json();
    const { mode, headers, sampleRows, question, eventSummary } = body as {
      mode: 'map_columns' | 'ops_query';
      headers?: string[];
      sampleRows?: Record<string, string>[];
      question?: string;
      eventSummary?: Record<string, unknown>;
    };

    if (mode === 'map_columns') {
      if (!headers || headers.length === 0) {
        return NextResponse.json({ error: 'لا توجد أعمدة لتحليلها' }, { status: 400 });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: JSON.stringify({
          task: 'Suggest optimal column mapping for an Arabic marathon race kit check-in system.',
          headers,
          sampleRows: (sampleRows ?? []).slice(0, 3),
        }),
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          systemInstruction:
            'أنت خبير هندسة بيانات لسباقات الماراثون. حلل أعمدة ملف المتسابقين واختر عمود الباركود الفريد، وأعمدة البحث السريع (الاسم، رقم الصدر، الموبايل)، والأعمدة التي تظهر للمنظم مع تسميات عربية واضحة ومختصرة.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              barcodeField: { type: Type.STRING, description: 'Exact header name for unique barcode/ID' },
              searchFields: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Header names for fallback search (name, phone, bib)',
              },
              displayFields: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Header names shown on organizer card (name, size, bib, distance)',
              },
              reasoningArabic: {
                type: Type.STRING,
                description: 'Brief Arabic explanation of why these columns were selected',
              },
            },
            required: ['barcodeField', 'searchFields', 'displayFields', 'reasoningArabic'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      return NextResponse.json({ mapping: parsed });
    }

    if (mode === 'ops_query') {
      if (!question || !question.trim()) {
        return NextResponse.json({ error: 'يرجى كتابة السؤال أولاً' }, { status: 400 });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `بيانات الإيفنت الحالية:\n${JSON.stringify(eventSummary ?? {}, null, 2)}\n\nسؤال مدير السباق:\n${question}`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH },
          systemInstruction:
            'أنت مستشار عمليات ميدانية لسباقات الماراثون. أجب باللغة العربية الفصحى الواضحة وبنقاط عملية مختصرة ومباشرة مبنية على الأرقام المرفقة فقط دون أي اختلاق.',
        },
      });

      return NextResponse.json({ answer: response.text ?? '' });
    }

    return NextResponse.json({ error: 'Unsupported mode' }, { status: 400 });
  } catch (error) {
    console.error('Gemini API route error:', error);
    const message = error instanceof Error ? error.message : 'حدث خطأ أثناء استشارة الذكاء الاصطناعي';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
