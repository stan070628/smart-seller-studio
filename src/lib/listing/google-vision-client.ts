import { ImageAnnotatorClient } from '@google-cloud/vision';

export interface TextBlock {
  text: string;
  bbox: { x: number; y: number; w: number; h: number };
}

let _client: ImageAnnotatorClient | null = null;

function getClient(): ImageAnnotatorClient {
  if (_client) return _client;
  const credsB64 = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  if (!credsB64) {
    throw new Error('[GCV] GOOGLE_APPLICATION_CREDENTIALS_JSON 환경변수가 없습니다.');
  }
  const credentials = JSON.parse(Buffer.from(credsB64, 'base64').toString('utf-8'));
  _client = new ImageAnnotatorClient({ credentials });
  return _client;
}

/**
 * 이미지 버퍼에서 텍스트 블록을 추출합니다.
 * 단어 단위(word)로 묶고, 빈 텍스트나 공백만 있는 것은 제외합니다.
 */
export async function extractTextBlocks(imageBuffer: Buffer): Promise<TextBlock[]> {
  const client = getClient();
  const [result] = await client.documentTextDetection({
    image: { content: imageBuffer },
  });

  const annotation = result.fullTextAnnotation;
  if (!annotation || !annotation.pages) return [];

  const blocks: TextBlock[] = [];
  for (const page of annotation.pages) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const word of paragraph.words ?? []) {
          const text = (word.symbols ?? []).map((s) => s.text ?? '').join('');
          if (!text.trim()) continue;
          const verts = word.boundingBox?.vertices ?? [];
          if (verts.length < 4) continue;
          const xs = verts.map((v) => v.x ?? 0);
          const ys = verts.map((v) => v.y ?? 0);
          const x = Math.min(...xs);
          const y = Math.min(...ys);
          const w = Math.max(...xs) - x;
          const h = Math.max(...ys) - y;
          blocks.push({ text, bbox: { x, y, w, h } });
        }
      }
    }
  }
  return blocks;
}
