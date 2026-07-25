import { describe, it, expect, vi, beforeEach } from 'vitest';

const callClaudeMock = vi.fn();
const callClaudeVisionMock = vi.fn();

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
  repairProLayout: vi.fn(async (s: unknown[]) => s),
}));

import { POST } from '@/app/api/ai/generate-pro-layout/route';

/** 옵션 균형이 맞는 유효 레이아웃 (비교 1 + 화이트 2 / 블랙 2) */
function validLayout(): unknown[] {
  const img = (title: string, ref: number) => ({
    type: 'claude_layout',
    title,
    blocks: [{ type: 'heading', text: title, size: 'xl' }, { type: 'image', attachedIndex: 0 }],
    imageSlots: [{ slotType: 'flux_lifestyle', promptHint: 'h', imageRef: ref }],
  });
  return [
    img('히어로', 0),
    img('소재', 1),
    {
      type: 'claude_layout',
      title: '컬러',
      blocks: [
        { type: 'option_grid', items: [{ label: '화이트' }, { label: '블랙' }] },
        { type: 'image', attachedIndex: 0 },
        { type: 'image', attachedIndex: 1 },
      ],
      imageSlots: [
        { slotType: 'product_nukki', imageRef: 0 },
        { slotType: 'product_nukki', imageRef: 1 },
      ],
    },
    img('디테일', 0),
    img('활용', 1),
    { type: 'claude_layout', title: '안내', blocks: [{ type: 'heading', text: '안내', size: 'xl' }] },
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
});
