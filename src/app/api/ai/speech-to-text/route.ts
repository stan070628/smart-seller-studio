// src/app/api/ai/speech-to-text/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { transcribeAudio } from '@/lib/ai/clova-speech';

interface ApiSuccessResponse {
  success: true;
  text: string;
}

interface ApiErrorResponse {
  success: false;
  error: string;
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ApiSuccessResponse | ApiErrorResponse>> {
  try {
    const arrayBuffer = await request.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json(
        { success: false, error: '오디오 데이터가 비어있습니다.' },
        { status: 400 }
      );
    }

    const blob = new Blob([arrayBuffer]);
    const text = await transcribeAudio(blob);

    return NextResponse.json({ success: true, text }, { status: 200 });
  } catch (error) {
    console.error('[/api/ai/speech-to-text] 오류:', error);

    if (error instanceof Error && error.message.includes('환경변수')) {
      return NextResponse.json(
        { success: false, error: '서버 설정 오류: STT API 키가 구성되지 않았습니다.' },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { success: false, error: '음성 인식 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
