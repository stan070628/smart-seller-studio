// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

vi.mock('@/lib/ai/gemini', () => ({
  getGeminiGenAI: vi.fn(),
}));

const { getGeminiGenAI } = await import('@/lib/ai/gemini');
const mockGetGenAI = getGeminiGenAI as ReturnType<typeof vi.fn>;

const { extractTextBlocks } = await import('@/lib/listing/gemini-vision-client');

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .jpeg()
    .toBuffer();
}

function mockGeminiResponse(jsonText: string) {
  const generateContent = vi.fn().mockResolvedValue({
    candidates: [{ content: { parts: [{ text: jsonText }] } }],
  });
  mockGetGenAI.mockReturnValue({ models: { generateContent } });
  return generateContent;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractTextBlocks (Gemini)', () => {
  it('Gemini 응답의 normalized 좌표를 픽셀로 환산한다 (1000×500 이미지)', async () => {
    mockGeminiResponse(
      '{"blocks":[{"text":"产品","box_2d":[100,50,200,250]}]}'
    );
    const buf = await makeJpeg(1000, 500);
    const blocks = await extractTextBlocks(buf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('产品');
    // ymin=100, xmin=50, ymax=200, xmax=250 (0~1000 scale)
    // 1000×500 이미지 → x=50, y=50, w=200, h=50
    expect(blocks[0].bbox).toEqual({ x: 50, y: 50, w: 200, h: 50 });
  });

  it('블록이 없으면 빈 배열을 반환', async () => {
    mockGeminiResponse('{"blocks":[]}');
    const buf = await makeJpeg(100, 100);
    const blocks = await extractTextBlocks(buf);
    expect(blocks).toEqual([]);
  });

  it('코드펜스로 감싼 응답도 파싱', async () => {
    mockGeminiResponse('```json\n{"blocks":[{"text":"a","box_2d":[0,0,100,100]}]}\n```');
    const buf = await makeJpeg(100, 100);
    const blocks = await extractTextBlocks(buf);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('a');
  });

  it('빈 텍스트나 폭/높이 0인 블록은 제외', async () => {
    mockGeminiResponse(
      '{"blocks":[{"text":"   ","box_2d":[0,0,100,100]},{"text":"x","box_2d":[10,10,10,10]}]}'
    );
    const buf = await makeJpeg(100, 100);
    const blocks = await extractTextBlocks(buf);
    expect(blocks).toEqual([]);
  });

  it('JSON 파싱 실패 시 빈 배열 반환 (zod safeParse 통과 못한 케이스)', async () => {
    mockGeminiResponse('{"unexpected":"shape"}');
    const buf = await makeJpeg(100, 100);
    const blocks = await extractTextBlocks(buf);
    expect(blocks).toEqual([]);
  });
});
