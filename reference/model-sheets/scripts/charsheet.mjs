/**
 * 캐릭터 시트 생성 — 한 인물의 정면·반측면·옆모습을 한 장에 담는다.
 *
 * imagen.ts의 generateFrameImage는 쓸 수 없다. 그 함수는
 * singleFrameConstraint로 multi-view/collage를 절대 금지하는데,
 * 캐릭터 시트는 정의상 multi-view다. 그래서 Gemini를 직접 부른다.
 *
 * 설계 의도:
 *  · 상반신 3뷰 — 착용컷에 쓸 것이므로 얼굴과 어깨선이 기준이 된다
 *  · 무지 기본 의상 — 나중에 제품을 입혀야 하므로 옷이 단순해야 한다
 *  · 균일 조명·중성 배경 — 참조로 쓸 때 조명이 씬을 오염시키지 않는다
 *  · 실존 인물을 닮게 하지 않는다 — 초상권 문제를 만들지 않기 위해서다
 *
 * 사용: node charsheet.mjs [female|male] [안번호]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '/Users/seungminlee/dev/smart_seller_studio/node_modules/@google/genai/dist/node/index.mjs';
import sharp from '/Users/seungminlee/dev/smart_seller_studio/node_modules/sharp/lib/index.js';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const OUT = `${DIR}/charsheet`;
mkdirSync(OUT, { recursive: true });

const apiKey = readFileSync('/Users/seungminlee/dev/smart_seller_studio/.env.local', 'utf8')
  .split('\n').find((l) => l.startsWith('GOOGLE_AI_API_KEY='))
  ?.slice('GOOGLE_AI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');

/** 모든 시트가 공유하는 규격. 이 문단이 흔들리면 참조로서 쓸모가 없다. */
const SHEET_SPEC = `
COMPOSITION — this is a CHARACTER REFERENCE SHEET, not a lifestyle photo:
- One single image containing exactly THREE views of the SAME person, side by side, evenly spaced, all at the same scale and eye level.
- Left: front view, facing the camera directly. Center: three-quarter view, turned about 45 degrees. Right: full profile, turned 90 degrees.
- Waist-up framing in all three views. Hands relaxed and out of frame or at the sides.
- The three views MUST be the same individual — identical face structure, identical hairstyle and hair length, identical clothing, identical body proportions.

LIGHTING AND BACKGROUND:
- Flat, even, neutral studio lighting with soft shadows. No dramatic rim light, no colored gels.
- Plain seamless light grey background (#EDEDED). Nothing else in the frame.

RENDERING:
- Photorealistic. Natural skin texture with visible pores; not airbrushed, not plastic, not 3D-rendered, not illustrated.
- Sharp focus on the face in all three views.
- No text, no labels, no watermarks, no borders, no grid lines between the views.

IDENTITY:
- An ordinary, natural-looking person. Do NOT resemble any real celebrity, public figure, or existing person.
`.trim();

const CHARACTERS = {
  female: [
    {
      id: 'f1',
      label: '여성 A — 대학생 인플루언서',
      body: `A South Korean woman in her early twenties. Warm oval face, soft natural double eyelids, small straight nose, gentle rounded jawline. Light everyday makeup: sheer skin, softly defined brows, subtle coral lip. Hair is dark brown, straight, falling just past the collarbone, parted slightly off-center, tucked behind one ear. Expression is relaxed and approachable with a faint closed-lip smile in every view. Wearing a plain cream crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
    {
      id: 'f2',
      label: '여성 B — 단발·또렷한 인상',
      body: `A South Korean woman in her mid twenties. Slim face with a defined but soft jawline, clear almond eyes, straight brows. Clean minimal makeup with a natural rose lip. Hair is black, blunt shoulder-length bob with a middle part, smooth and glossy. Expression is calm and confident, lips closed, in every view. Wearing a plain white crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
  ],
  male: [
    {
      id: 'm1',
      label: '남성 A — 세련된 도시적 인상',
      body: `A South Korean man in his mid to late twenties. Clean angular face with a defined jawline, straight dark brows, calm monolid-leaning eyes, clear skin. Hair is black, short and neatly styled with a natural side flow, lightly swept up from the forehead, not slicked. Clean-shaven. Expression is composed and quietly confident, lips closed, in every view. Wearing a plain charcoal grey crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
    {
      id: 'm2',
      label: '남성 B — 부드러운 인상',
      body: `A South Korean man in his mid twenties. Softer oval face with gentle features, warm double-eyelid eyes, straight nose, light natural brows. Hair is dark brown, medium-short with a soft natural fringe resting on the forehead. Clean-shaven. Expression is friendly and relaxed with a faint closed-lip smile in every view. Wearing a plain white crew-neck cotton t-shirt with no print, no logo, no pattern.`,
    },
  ],
};

const sex = process.argv[2] ?? 'female';
const only = process.argv[3];
const list = (CHARACTERS[sex] ?? []).filter((c) => !only || c.id === only);
if (!list.length) throw new Error(`대상 없음: ${sex} ${only ?? ''}`);

const ai = new GoogleGenAI({ apiKey });

for (const c of list) {
  const prompt = `Create a character reference sheet.\n\nSUBJECT:\n${c.body}\n\n${SHEET_SPEC}`;
  process.stdout.write(`[${c.id}] ${c.label} 생성 중... `);
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      config: { responseModalities: ['Text', 'Image'], imageConfig: { imageSize: '2K' } },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    const p = (res.candidates?.[0]?.content?.parts ?? []).find((x) => x.inlineData?.data);
    if (!p) {
      console.log(`실패 (finishReason=${res.candidates?.[0]?.finishReason})`);
      continue;
    }
    const buf = Buffer.from(p.inlineData.data, 'base64');
    const m = await sharp(buf).metadata();
    await sharp(buf).jpeg({ quality: 95 }).toFile(`${OUT}/${c.id}.jpg`);
    console.log(`${m.width}x${m.height} ${m.format} → ${c.id}.jpg`);
  } catch (e) {
    console.log('오류:', e.message?.slice(0, 120));
  }
}
console.log(`\n출력: ${OUT}`);
