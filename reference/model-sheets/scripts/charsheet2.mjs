/**
 * 캐릭터 시트 v2 — 매력도를 올린다.
 *
 * v1의 실패 원인: SHEET_SPEC에 "An ordinary, natural-looking person"이라고
 * 못박아 둔 한 줄. 초상권 회피가 목적이었으나 그것이 곧 평범한 얼굴을 만들었다.
 * 회피는 "실존 인물을 닮지 말라"로만 걸고, 외모는 커머스 모델 수준으로 올린다.
 *
 * 조명도 손봤다. v1의 완전 평면광은 참조로는 안전하지만 얼굴을 납작하게 만든다.
 * 부드러운 키라이트 + 필을 줘서 입체감만 살리고 색은 중립으로 유지한다.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '/Users/seungminlee/dev/smart_seller_studio/node_modules/@google/genai/dist/node/index.mjs';
import sharp from '/Users/seungminlee/dev/smart_seller_studio/node_modules/sharp/lib/index.js';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = `${DIR}/charsheet2`;
mkdirSync(OUT, { recursive: true });

const apiKey = readFileSync('/Users/seungminlee/dev/smart_seller_studio/.env.local', 'utf8')
  .split('\n').find((l) => l.startsWith('GOOGLE_AI_API_KEY='))
  ?.slice('GOOGLE_AI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');

const SHEET_SPEC = `
COMPOSITION — this is a CHARACTER REFERENCE SHEET, not a lifestyle photo:
- One single image containing exactly THREE views of the SAME person, side by side, evenly spaced, all at the same scale and eye level.
- Left: front view, facing the camera directly. Center: three-quarter view, turned about 45 degrees. Right: full profile, turned 90 degrees.
- Waist-up framing in all three views.
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

const CHARACTERS = {
  female: [
    {
      id: 'f1',
      label: '여성 A — 화사한 인플루언서',
      body: `A stunning South Korean woman in her early twenties with the polished look of a top beauty influencer. Radiant fair skin with a soft dewy glow. Large expressive double-eyelid eyes with a gentle upward tilt, long lashes, delicately arched brows. Small refined nose, full softly-shaped lips, slim V-line jaw with a graceful neck. Elegant Korean beauty makeup: luminous base, soft peach blush across the cheeks, gradient coral lip, subtle inner-corner highlight. Hair is glossy dark chestnut, long with soft loose waves falling past the collarbone, side-parted with face-framing strands. Expression is bright and warm with a soft closed-lip smile, eyes engaged with the camera, in every view. Wearing a plain cream crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
    {
      id: 'f2',
      label: '여성 B — 시크한 도회적 미인',
      body: `A striking South Korean woman in her mid twenties with a chic editorial presence. Porcelain-clear skin with a matte-satin finish. Sharp almond cat-like eyes with a subtle upward flick, straight defined brows, high nose bridge, sculpted cheekbones, sharp slim jawline. Sophisticated makeup: flawless base, softly contoured cheeks, deep rose lip. Hair is jet black, sleek shoulder-length with a middle part, mirror-smooth with a blunt clean edge. Expression is cool, poised and quietly self-assured, lips closed, direct confident gaze, in every view. Wearing a plain white crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
  ],
  male: [
    {
      id: 'm1',
      label: '남성 A — 조각형 세련',
      body: `A handsome South Korean man in his mid twenties with the presence of a fashion campaign model. Tall and lean with broad straight shoulders and a long neck. Clean sculpted face: sharp defined jawline, high cheekbones, straight elegant nose, deep-set well-shaped eyes with defined double eyelids, thick straight dark brows. Clear healthy skin with a natural matte finish. Hair is jet black, short and precisely styled, swept up and back from the forehead with natural volume and clean tapered sides. Clean-shaven. Expression is composed and quietly charismatic, lips closed, steady direct gaze, in every view. Wearing a plain charcoal grey crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
    {
      id: 'm2',
      label: '남성 B — 부드러운 미남',
      body: `A very attractive South Korean man in his mid twenties with a warm approachable charm. Lean athletic build with good shoulder line. Softly handsome face: smooth oval shape with a clean jawline, bright large double-eyelid eyes with a gentle gaze, straight nose, well-defined but soft lips. Luminous clear skin. Hair is dark brown, medium-short with a soft natural fringe styled with light texture, glossy and healthy. Clean-shaven. Expression is friendly and easy with a light closed-lip smile that reaches the eyes, in every view. Wearing a plain white crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
  ],
};

const sex = process.argv[2] ?? 'female';
const list = CHARACTERS[sex] ?? [];
const ai = new GoogleGenAI({ apiKey });

for (const c of list) {
  const prompt = `Create a character reference sheet.\n\nSUBJECT:\n${c.body}\n\n${SHEET_SPEC}`;
  process.stdout.write(`[${c.id}] ${c.label} ... `);
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['Text', 'Image'], imageConfig: { imageSize: '2K' } },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
