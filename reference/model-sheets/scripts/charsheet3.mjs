/**
 * 캐릭터 시트 v3 — 여성 B 재시도 2안.
 *
 * v2의 여성 B는 반려됐다. 추정 원인: cat-like eyes + deep rose lip + cool poised
 * 조합이 인상을 강하게 만들었다. 채택된 여성 A(화사한 웨이브 롱헤어)와 대비는
 * 유지하되 부담스럽지 않은 쪽으로 두 방향을 시험한다.
 *
 *   b1 — 청순·단정: 부드러운 눈매, 누드톤 립, 정돈된 단발
 *   b2 — 건강·발랄: 포니테일, 환한 미소, 생기 있는 피부
 *
 * SHEET_SPEC은 charsheet2.mjs와 동일하다. 규격이 바뀌면 참조끼리 어긋난다.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '/Users/seungminlee/dev/smart_seller_studio/node_modules/@google/genai/dist/node/index.mjs';
import sharp from '/Users/seungminlee/dev/smart_seller_studio/node_modules/sharp/lib/index.js';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = `${DIR}/charsheet3`;
mkdirSync(OUT, { recursive: true });

const apiKey = readFileSync('/Users/seungminlee/dev/smart_seller_studio/.env.local', 'utf8')
  .split('\n').find((l) => l.startsWith('GOOGLE_AI_API_KEY='))
  ?.slice('GOOGLE_AI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');

const SHEET_SPEC = `
COMPOSITION — this is a CHARACTER REFERENCE SHEET, not a lifestyle photo:
- One single image containing exactly THREE views of the SAME person, side by side, evenly spaced, all at the same scale and eye level.
- Left: front view, facing the camera directly. Center: three-quarter view, turned about 45 degrees. Right: full profile, turned 90 degrees.
- Waist-up framing in all three views. The three views must fill the frame edge to edge with no empty letterbox bands above or below.
- The three views MUST be the same individual — identical face structure, identical hairstyle and hair length, identical clothing, identical body proportions.

CASTING STANDARD:
- Cast at the level of a professional fashion and commerce campaign model: strikingly photogenic, refined bone structure, excellent proportions, camera-confident presence.
- Flawless well-groomed styling. Hair is professionally styled with clean shape and healthy shine.
- Skin is clear and luminous with real texture — visible pores, natural sheen. Not airbrushed into plastic, not 3D-rendered, not illustrated.

LIGHTING AND BACKGROUND:
- Soft large key light slightly off-axis plus gentle fill — enough modelling to give the face dimension, but no harsh shadows and no colored gels. Neutral white balance.
- Plain seamless light grey background (#EDEDED). Nothing else in the frame.

RENDERING:
- Photorealistic editorial portrait quality, shot on a medium telephoto lens. Sharp focus on the face in all three views.
- No text, no labels, no watermarks, no borders, no grid lines between the views.

IDENTITY:
- Do NOT resemble any real celebrity, public figure, or existing person. This is an original fictional individual.
`.trim();

const CANDIDATES = [
  {
    id: 'b1',
    label: '여성 B1 — 청순·단정',
    body: `A beautiful South Korean woman in her early twenties with a clean, gentle, refined presence. Luminous fair skin with a soft natural glow. Round-almond double-eyelid eyes with a soft downward-tilting outer corner giving a kind gaze, long natural lashes, softly arched brows. Slim straight nose, small well-shaped lips, delicate oval face with a soft jawline. Understated makeup: sheer glowing base, barely-there peach blush, natural nude-pink lip tint. Hair is soft dark brown, neat shoulder-length with a gentle inward curl at the ends, side-parted, smooth and glossy. Expression is calm, warm and gentle with a faint soft smile, in every view. Wearing a plain white crew-neck cotton t-shirt with no print, no logo, no pattern.`,
  },
  {
    id: 'b2',
    label: '여성 B2 — 건강·발랄',
    body: `A lovely South Korean woman in her early twenties with a bright, healthy, energetic charm. Fresh glowing skin with a natural flush across the cheeks. Large round sparkling double-eyelid eyes with a lively gaze, full natural brows, small upturned nose, softly full lips. Youthful heart-shaped face. Fresh minimal makeup: dewy base, coral cheek flush, glossy peach lip. Hair is dark brown, pulled back into a neat high ponytail with a few soft strands framing the face, healthy and shiny. Expression is bright and cheerful with a warm open closed-lip smile that reaches the eyes, in every view. Wearing a plain light grey crew-neck cotton t-shirt with no print, no logo, no pattern.`,
  },
];

const ai = new GoogleGenAI({ apiKey });
for (const c of CANDIDATES) {
  process.stdout.write(`[${c.id}] ${c.label} ... `);
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['Text', 'Image'], imageConfig: { imageSize: '2K' } },
      contents: [{ role: 'user', parts: [{ text: `Create a character reference sheet.\n\nSUBJECT:\n${c.body}\n\n${SHEET_SPEC}` }] }],
    });
    const p = (res.candidates?.[0]?.content?.parts ?? []).find((x) => x.inlineData?.data);
    if (!p) { console.log(`실패 (${res.candidates?.[0]?.finishReason})`); continue; }
    const buf = Buffer.from(p.inlineData.data, 'base64');
    const m = await sharp(buf).metadata();
    await sharp(buf).jpeg({ quality: 95 }).toFile(`${OUT}/${c.id}.jpg`);
    console.log(`${m.width}x${m.height} → ${c.id}.jpg`);
  } catch (e) {
    console.log('오류:', e.message?.slice(0, 120));
  }
}
