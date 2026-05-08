// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@google-cloud/vision', () => {
  const documentTextDetection = vi.fn();
  function ImageAnnotatorClient() {
    return { documentTextDetection };
  }
  return {
    ImageAnnotatorClient,
    __mockDetect: documentTextDetection,
  };
});

const visionMock = (await import('@google-cloud/vision')) as unknown as {
  __mockDetect: ReturnType<typeof vi.fn>;
};
const { extractTextBlocks } = await import('@/lib/listing/google-vision-client');

describe('extractTextBlocks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON = Buffer.from(
      JSON.stringify({ type: 'service_account', project_id: 'test' })
    ).toString('base64');
  });

  it('GCV 응답을 { text, bbox } 배열로 정규화한다', async () => {
    visionMock.__mockDetect.mockResolvedValueOnce([
      {
        fullTextAnnotation: {
          pages: [
            {
              blocks: [
                {
                  paragraphs: [
                    {
                      words: [
                        {
                          symbols: [{ text: '产' }, { text: '品' }],
                          boundingBox: {
                            vertices: [
                              { x: 10, y: 20 },
                              { x: 50, y: 20 },
                              { x: 50, y: 60 },
                              { x: 10, y: 60 },
                            ],
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      },
    ]);

    const blocks = await extractTextBlocks(Buffer.from([0, 1, 2]));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('产品');
    expect(blocks[0].bbox).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });

  it('텍스트가 없으면 빈 배열을 반환한다', async () => {
    visionMock.__mockDetect.mockResolvedValueOnce([{ fullTextAnnotation: null }]);
    const blocks = await extractTextBlocks(Buffer.from([0]));
    expect(blocks).toEqual([]);
  });
});
