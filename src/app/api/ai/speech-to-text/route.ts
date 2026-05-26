import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/supabase/auth';
import { checkRateLimit, getRateLimitKey, RATE_LIMITS } from '@/lib/rate-limit';
import { transcribeAudio } from '@/lib/ai/clova-speech';

const MAX_AUDIO_BYTES = 5 * 1024 * 1024; // 5MB

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
  const authResult = await requireAuth(request);
  if (authResult instanceof Response) {
    return authResult as unknown as NextResponse<ApiErrorResponse>;
  }

  const ip = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'unknown';
  const rateLimitResult = checkRateLimit(getRateLimitKey(ip, 'speech-to-text'), RATE_LIMITS.AI_API);
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      { success: false, error: '요청이 너무 많습니다. 잠시 후 다시 시도해주세요.' },
      { status: 429 }
    );
  }

  try {
    const arrayBuffer = await request.arrayBuffer();

    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json(
        { success: false, error: '오디오 데이터가 비어있습니다.' },
        { status: 400 }
      );
    }

    if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
      return NextResponse.json(
        { success: false, error: '오디오 파일이 너무 큽니다. 5MB 이하만 허용됩니다.' },
        { status: 413 }
      );
    }

    const text = await transcribeAudio(arrayBuffer);

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
