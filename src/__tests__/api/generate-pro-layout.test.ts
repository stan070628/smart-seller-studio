import { describe, it, expect, vi, beforeEach } from 'vitest';

const callClaudeMock = vi.fn();
const callClaudeVisionMock = vi.fn();
const repairMock = vi.fn(async (s: unknown[]) => s);

/**
 * 필수 스펙(사이즈 실측·소재 혼용률) 입력값. 픽스처 상품명이 "민소매 티셔츠"라
 * 의류 규칙에 걸리므로, 스펙 경고가 관심사가 아닌 테스트는 이걸 넣어 배제한다.
 */
const SPEC_POINTS = ['어깨단면 42cm', '총장 68cm', '면 100%'];

vi.mock('@/lib/ai/claude-cli', () => ({
  callClaude: (...args: unknown[]) => callClaudeMock(...args),
  callClaudeVision: (...args: unknown[]) => callClaudeVisionMock(...args),
}));
vi.mock('@/lib/supabase/auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ id: 'user-1' }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockReturnValue({ allowed: true, resetAt: 0 }),
  getRateLimitKey: vi.fn().mockReturnValue('k'),
}));
vi.mock('@/lib/ai/repair-pro-layout', () => ({
  repairProLayout: (...args: unknown[]) => repairMock(...(args as [unknown[]])),
}));

import { POST } from '@/app/api/ai/generate-pro-layout/route';

/**
 * 옵션 균형이 맞는 유효 레이아웃 (비교 1 + 화이트 2 / 블랙 2).
 * narrative:true가 켜진 뒤로 beat도 서사 검증(narrative.ts의 checkNarrative)을
 * 통과해야 repair 분기를 타지 않는다 — hook 시작 / compare 1개(columns 2단 포함)
 * / assure 마지막 3개 안.
 */
function validLayout(): unknown[] {
  const img = (title: string, ref: number, beat: string) => ({
    type: 'claude_layout',
    title,
    beat,
    blocks: [{ type: 'heading', text: title, size: 'xl' }, { type: 'image', attachedIndex: 0 }],
    imageSlots: [{ slotType: 'flux_lifestyle', promptHint: 'h', imageRef: ref }],
  });
  return [
    img('히어로', 0, 'hook'),
    img('소재', 1, 'detail'),
    {
      type: 'claude_layout',
      title: '컬러',
      beat: 'compare',
      blocks: [
        { type: 'option_grid', items: [{ label: '화이트' }, { label: '블랙' }] },
        { type: 'image', attachedIndex: 0 },
        { type: 'image', attachedIndex: 1 },
        // narrative의 compare_structure 요구(columns 2단)를 만족시키기 위한 블록.
        // option_grid 기반 옵션 커버리지 판정(product-options.ts)과는 별개 요구라 추가한다.
        { type: 'columns', cols: [[{ type: 'subtext', text: '화이트' }], [{ type: 'subtext', text: '블랙' }]] },
      ],
      imageSlots: [
        { slotType: 'product_nukki', imageRef: 0 },
        { slotType: 'product_nukki', imageRef: 1 },
      ],
    },
    img('디테일', 0, 'detail'),
    img('활용', 1, 'usecase'),
    { type: 'claude_layout', title: '안내', beat: 'assure', blocks: [{ type: 'heading', text: '안내', size: 'xl' }] },
  ];
}

function request(body: unknown): Request {
  return new Request('http://localhost/api/ai/generate-pro-layout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai/generate-pro-layout', () => {
  beforeEach(() => {
    callClaudeMock.mockReset();
    callClaudeVisionMock.mockReset();
    // mockReset은 구현까지 지워 repair가 undefined를 반환하게 되므로 identity를 다시 넣는다.
    repairMock.mockReset();
    repairMock.mockImplementation(async (s: unknown[]) => s);
    callClaudeMock.mockResolvedValue(JSON.stringify(validLayout()));
  });

  it('productOptions를 주면 유저 프롬프트에 옵션 매핑이 들어간다', async () => {
    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
      productOptions: [
        { name: '화이트', imageIndex: 0 },
        { name: '블랙', imageIndex: 1 },
      ],
    }) as never);

    expect(res.status).toBe(200);
    const userPrompt = callClaudeMock.mock.calls[0]![1] as string;
    expect(userPrompt).toContain('옵션(색상/모델)');
    expect(userPrompt).toContain('이미지 0 = "화이트"');
    expect(userPrompt).toContain('이미지 1 = "블랙"');
  });

  it('productOptions가 없으면 옵션 줄이 없다', async () => {
    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const userPrompt = callClaudeMock.mock.calls[0]![1] as string;
    expect(userPrompt).not.toContain('옵션(색상/모델)');
  });

  it('옵션이 1개면 옵션 줄을 넣지 않는다', async () => {
    await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
      productOptions: [{ name: '화이트', imageIndex: 0 }],
    }) as never);

    const userPrompt = callClaudeMock.mock.calls[0]![1] as string;
    expect(userPrompt).not.toContain('옵션(색상/모델)');
  });

  it('stat_row의 0값 치수 항목이 응답에서 제거된다', async () => {
    const layout = validLayout();
    (layout[0] as { blocks: unknown[] }).blocks.push({
      type: 'stat_row',
      items: [
        { label: '소매 길이', value: '0', unit: 'cm' },
        { label: '가슴둘레', value: '95~110', unit: 'cm' },
        { label: '무게', value: '180', unit: 'g' },
      ],
    });
    callClaudeMock.mockResolvedValue(JSON.stringify(layout));

    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
    }) as never);

    const json = await res.json() as { sections: Array<{ blocks: Array<{ type: string; items?: Array<{ label: string }> }> }> };
    const stat = json.sections[0]!.blocks.find((b) => b.type === 'stat_row');
    expect(stat!.items!.map((i) => i.label)).toEqual(['가슴둘레', '무게']);
  });

  it('서사를 갖춘 정상 경로는 repair를 타지 않고 warnings 키가 없다', async () => {
    // beforeEach가 이미 validLayout()을 mock하지만, 이 테스트의 의도(정상 경로에는
    // warnings가 아예 없어야 한다)를 명시적으로 드러내기 위해 다시 지정한다.
    callClaudeMock.mockResolvedValue(JSON.stringify(validLayout()));

    const res = await POST(request({
      // 상품명이 "티셔츠"라 필수 스펙(실측·혼용률) 규칙에 걸린다. 이 테스트의 관심사는
      // 서사 경로이므로 스펙을 채워 그쪽 경고를 배제한다 — 스펙 경고 자체는 아래
      // 전용 테스트에서 검증한다.
      productInfo: { name: '민소매 티셔츠', points: SPEC_POINTS, category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as Record<string, unknown>;
    expect(Array.isArray(json.sections)).toBe(true);
    expect('warnings' in json).toBe(false);
  });

  it('서사 없는 레이아웃(beat 누락)은 repair 후에도 남은 위반을 사용자 문구 warnings로 응답에 싣는다', async () => {
    // beat를 전부 제거하면 checkNarrative가 각 섹션에 beat_missing(error)을 낸다.
    // repairProLayout mock은 identity라 재정화 후에도 위반이 그대로 남는다.
    // 진단용 code:message(개발자용, 예: "narrative: sections[1]에 beat 필드가
    // 없습니다")는 화면에 노출하지 않고 friendlyViolationWarnings가 매핑한
    // 사용자 문구만 나가야 한다 — code당 한 줄로 중복도 제거된다(9섹션 모두
    // beat_missing이어도 warnings는 narrative 문구 1개).
    const noBeatLayout = validLayout().map((sec) => {
      const { beat, ...rest } = sec as Record<string, unknown>;
      return rest;
    });
    callClaudeMock.mockResolvedValue(JSON.stringify(noBeatLayout));

    const res = await POST(request({
      // 스펙을 채워 필수 스펙 경고를 배제한다 — 이 테스트는 narrative 문구 1개만 나오는지를 본다.
      productInfo: { name: '민소매 티셔츠', points: SPEC_POINTS, category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { warnings?: string[] };
    expect(Array.isArray(json.warnings)).toBe(true);
    expect(json.warnings!.length).toBe(1); // narrative 코드 하나로 중복 제거
    expect(json.warnings!.every((w) => typeof w === 'string' && !/^[a-z_]+: /.test(w))).toBe(true);
    expect(json.warnings!.some((w) => w.includes('권장 흐름'))).toBe(true);
  });

  it('points가 비어 있으면 progress_bar 수치가 전부 위생 삭제되고 사용자 문구 warnings에 실린다', async () => {
    // provenanceSource = points.join(' ')가 빈 문자열이면 isGroundedProgressItem이
    // 모든 숫자 대조에 실패해 progress_bar 항목이 전부 제거된다(progress-hygiene.ts).
    // 블록째 사라지면 재검증에 걸릴 위반이 없어 narrative처럼 error warnings로는
    // 안 잡힌다 — route.ts의 countUngroundedProgressItems가 원인(provenance) 기준으로
    // 직접 세어 이걸 잡아야 한다.
    const layout = validLayout();
    (layout[0] as { blocks: unknown[] }).blocks.push({
      type: 'progress_bar',
      items: [
        { label: '통기성', value: 80, displayValue: '92%' },
        { label: '신축성', value: 70, displayValue: '88%' },
      ],
    });
    callClaudeMock.mockResolvedValue(JSON.stringify(layout));

    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { sections: Array<{ blocks: Array<{ type: string }> }>; warnings?: string[] };
    expect(json.sections[0]!.blocks.some((b) => b.type === 'progress_bar')).toBe(false);
    expect(Array.isArray(json.warnings)).toBe(true);
    expect(json.warnings!.some((w) => w.includes('근거 없는 수치 2개가 발견되어'))).toBe(true);
    // 형식까지 일치해야 통과한다는 걸 사용자가 알 수 있도록 예시를 포함한다
    expect(json.warnings!.some((w) => w.includes('통기성 92%'))).toBe(true);
  });

  it('상품 정보에 실제 등장하는 수치는 위생 삭제되지 않고 warnings도 없다', async () => {
    // points에 "92%"가 실제로 등장하면 isGroundedProgressItem이 통과시킨다 —
    // 원인 기준 카운트가 0이어야 오탐 경고가 뜨지 않는다.
    const layout = validLayout();
    (layout[0] as { blocks: unknown[] }).blocks.push({
      type: 'progress_bar',
      items: [
        { label: '통기성', value: 80, displayValue: '92%' },
        { label: '신축성', value: 70, displayValue: '88%' },
      ],
    });
    callClaudeMock.mockResolvedValue(JSON.stringify(layout));

    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: ['통기성 92%', '신축성 88%', ...SPEC_POINTS], category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { sections: Array<{ blocks: Array<{ type: string }> }>; warnings?: string[] };
    expect(json.sections[0]!.blocks.some((b) => b.type === 'progress_bar')).toBe(true);
    expect('warnings' in json).toBe(false);
  });

  it('의류인데 실측·혼용률이 없으면 셀러에게 입력을 안내한다', async () => {
    // 필수 스펙 누락은 "생성이 잘못됐다"가 아니라 "셀러 입력이 비었다"라서 Violation이
    // 아니다(error로 올리면 repair가 없는 수치를 지어내도록 압박한다). 검증 파이프라인
    // 밖에서 계산해 warnings에만 실리는 경로를 고정한다.
    callClaudeMock.mockResolvedValue(JSON.stringify(validLayout()));

    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: ['시원한 착용감'], category: '의류' },
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { warnings?: string[] };
    expect(json.warnings!.some((w) => w.includes('사이즈 실측'))).toBe(true);
    expect(json.warnings!.some((w) => w.includes('혼용률'))).toBe(true);
    // repair를 타지 않아야 한다 — 없는 값을 만들어내게 하면 안 된다.
    expect(repairMock).not.toHaveBeenCalled();
  });

  it('repair 경로에서도 위생 삭제 경고와 잔존 위반 경고가 함께, 사용자 문구로 실린다', async () => {
    // "양쪽 반환 경로 모두"의 repair 분기 쪽을 고정한다: beat 하나를 제거해 narrative
    // 위반(repair identity mock이라 재정화 후에도 잔존)을 만들고, points를 비워
    // progress_bar도 함께 위생 삭제되게 한다. 두 경고가 섞여도 형식(code:message 아님)이
    // 일관되어야 하고, hygiene count는 repair 이전 원본 기준이라 repair가 아무것도
    // 안 하는 이 mock에서도 정확해야 한다.
    const layout = validLayout();
    const { beat: _beat, ...rest } = layout[1] as Record<string, unknown>;
    layout[1] = rest;
    (layout[0] as { blocks: unknown[] }).blocks.push({
      type: 'progress_bar',
      items: [
        { label: '통기성', value: 80, displayValue: '92%' },
        { label: '신축성', value: 70, displayValue: '88%' },
      ],
    });
    callClaudeMock.mockResolvedValue(JSON.stringify(layout));

    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { warnings?: string[] };
    expect(Array.isArray(json.warnings)).toBe(true);
    expect(json.warnings!.some((w) => w.includes('근거 없는 수치 2개가 발견되어'))).toBe(true);
    expect(json.warnings!.some((w) => w.includes('권장 흐름'))).toBe(true);
    expect(json.warnings!.every((w) => !/^[a-z_]+: /.test(w))).toBe(true);
  });

  it('금지어(예: "선착순") 위반은 재생성이 아니라 에디터에서 직접 수정하라고 안내한다', async () => {
    // prohibited는 autoFixable:false라 재생성해도 같은 표현이 또 나올 수 있다 —
    // narrative/option 계열과 달리 "다시 생성하면 개선될 수 있습니다"는 거짓 안심이라
    // generic 문구로 뭉개면 안 되고, "에디터에서 직접 수정"을 안내해야 한다.
    const layout = validLayout();
    (layout[0] as { blocks: unknown[] }).blocks.push({ type: 'subtext', text: '선착순 한정 특가' });
    callClaudeMock.mockResolvedValue(JSON.stringify(layout));

    const res = await POST(request({
      productInfo: { name: '민소매 티셔츠', points: [], category: '' },
    }) as never);

    expect(res.status).toBe(200);
    const json = await res.json() as { warnings?: string[] };
    expect(Array.isArray(json.warnings)).toBe(true);
    expect(json.warnings!.some((w) => w.includes('에디터에서 해당 문구를 직접 수정'))).toBe(true);
    expect(json.warnings!.every((w) => !/^[a-z_]+: /.test(w))).toBe(true);
  });
});
