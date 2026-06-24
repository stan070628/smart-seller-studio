import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scrape1688 } from '@/lib/scraping/1688-scraper';

export const runtime = 'nodejs'; // puppeteer-core는 edge 런타임 불가

const BodySchema = z.object({
  url: z.string().url(),
});

// hostname만 검사해 쿼리스트링 우회 시도 차단
function is1688Url(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return hostname === '1688.com' || hostname.endsWith('.1688.com');
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  // 기능 플래그 미설정 시 501 반환 (로컬 전용 기능)
  if (process.env.ENABLE_1688_SCRAPE !== '1') {
    return NextResponse.json(
      { success: false, error: '이 기능은 로컬 환경에서만 사용할 수 있습니다 (ENABLE_1688_SCRAPE=1 필요).' },
      { status: 501 },
    );
  }

  // 요청 바디 파싱 및 Zod 검증
  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: '올바른 URL을 입력해주세요.' },
      { status: 400 },
    );
  }

  const { url } = parsed.data;

  // hostname 기반 도메인 화이트리스트 검사 (쿼리스트링 우회 차단)
  if (!is1688Url(url)) {
    return NextResponse.json(
      { success: false, error: '1688.com URL만 지원합니다.' },
      { status: 400 },
    );
  }

  try {
    const result = await scrape1688(url);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : '알 수 없는 오류가 발생했습니다.';
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
