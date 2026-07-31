/**
 * sourcing-agent-run.test.ts
 * 발굴 웹 실행 라우트(POST /api/sourcing/agent/run) 테스트.
 *
 * 레시피: shortlist-verify-routes.test.ts — vi.mock 팩토리는 파일 최상단으로
 * 호이스팅되므로 그 안에서 참조할 mock은 vi.hoisted로 선언해야 한다.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRun, afterTasks, mockCreateRequest } = vi.hoisted(() => {
  let nextId = 100;
  return {
    mockRun: vi.fn(),
    afterTasks: [] as Promise<unknown>[],
    mockCreateRequest: vi.fn(async () => nextId++),
  };
});

vi.mock('@/lib/sourcing-agent/keyword-pipeline', () => ({
  runKeywordPipeline: mockRun,
}));

vi.mock('@/lib/sourcing-agent/keyword-db', () => ({
  createRequest: mockCreateRequest,
}));

// 이 팩토리는 바깥 변수를 참조하지 않으므로 hoisted가 필요 없다
vi.mock('@/lib/sourcing/db', () => ({
  getSourcingPool: () => ({ query: vi.fn() }),
}));

// 이 라우트는 유료 외부 API 호출을 촉발하므로 인증이 필수다.
// 기본은 인증된 사용자로 두고, 401 케이스만 개별 테스트에서 덮어쓴다.
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ userId: 'user-1' }),
}));

// next/server의 after()는 요청 스코프 밖에서 호출하면 던진다. 단위 테스트에는
// 요청 스코프가 없으므로 after만 가로채 백그라운드 작업을 붙잡아 두고,
// 테스트에서 직접 await해 실제 실행 여부를 검증한다.
vi.mock('next/server', async () => {
  const actual = await vi.importActual<typeof import('next/server')>('next/server');
  return {
    ...actual,
    after: (task: Promise<unknown>) => {
      afterTasks.push(task);
    },
  };
});

import { POST } from '@/app/api/sourcing/agent/run/route';

function req(body: unknown): Request {
  return new Request('http://localhost/api/sourcing/agent/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/sourcing/agent/run', () => {
  beforeEach(() => {
    mockRun.mockReset();
    mockCreateRequest.mockClear();
    afterTasks.length = 0;
  });

  it('키워드 배열을 받아 각각 파이프라인을 돌린다', async () => {
    mockRun.mockResolvedValue(undefined);
    const res = await POST(req({ keywords: ['등산 모자', '방한 장갑'] }));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.data.accepted).toBe(2);

    // 응답은 즉시 돌아가고 파이프라인은 after()에 실린다. 웹 실행에는
    // 텔레그램 chat_id가 없으므로 빈 문자열이 넘어가야 한다. 라우트가 미리
    // 만든 requestId도 그대로 이어 받아야 한다.
    await Promise.all(afterTasks);
    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun).toHaveBeenNthCalledWith(1, '등산 모자', '', body.data.runs[0].requestId);
    expect(mockRun).toHaveBeenNthCalledWith(2, '방한 장갑', '', body.data.runs[1].requestId);
  });

  it('키워드마다 requestId를 만들어 응답에 담는다', async () => {
    mockRun.mockResolvedValue(undefined);
    const res = await POST(req({ keywords: ['등산 스틱', '방한 장갑'] }));
    const body = await res.json();

    expect(body.data.runs).toHaveLength(2);
    expect(body.data.runs[0].keyword).toBe('등산 스틱');
    expect(typeof body.data.runs[0].requestId).toBe('number');

    // 폴링이 이 ID로 조회하므로 파이프라인이 같은 행을 써야 한다
    await Promise.all(afterTasks);
    expect(mockRun).toHaveBeenCalledWith('등산 스틱', '', body.data.runs[0].requestId);
  });

  it('키워드가 비어 있으면 400이다', async () => {
    const res = await POST(req({ keywords: [] }));
    expect(res.status).toBe(400);
  });

  it('한 번에 처리할 키워드 수를 제한한다', async () => {
    const many = Array.from({ length: 11 }, (_, i) => `키워드${i}`);
    const res = await POST(req({ keywords: many }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('10');
  });

  it('미인증 요청은 401이고 파이프라인을 태우지 않는다', async () => {
    const { requireAuth } = await import('@/lib/supabase/auth');
    vi.mocked(requireAuth).mockResolvedValueOnce(
      Response.json({ error: '인증이 필요합니다.' }, { status: 401 }) as never,
    );

    const res = await POST(req({ keywords: ['등산 모자'] }));
    expect(res.status).toBe(401);

    // 유료 API를 태우는 라우트이므로 미인증 호출은 after()에도 실리면 안 된다
    expect(afterTasks).toHaveLength(0);
    await Promise.all(afterTasks);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('본문이 JSON이 아니면 400이다', async () => {
    const bad = new Request('http://localhost/api/sourcing/agent/run', {
      method: 'POST',
      body: 'not json',
    });
    const res = await POST(bad);
    expect(res.status).toBe(400);
  });
});
