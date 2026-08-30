/**
 * 캐릭터 시트 일관성 검증 — 위키 Open Question에 답한다.
 *
 *   "캐릭터 시트가 실제로 인물을 고정하는가. 영상 안에서는 고정된 것으로
 *    보이나 이 계정에서 재현한 적이 없다."
 *      — 20-wiki/sources/클로드로 쇼핑 쇼츠 자동화 2026-08-25.md
 *
 * 같은 시트를 참조로 붙여 서로 다른 씬 3개를 만든다. 세 컷의 인물이
 * 같은 사람으로 보이면 시트가 작동하는 것이고, 매번 다른 얼굴이 나오면
 * 앱에 배선해봐야 소용이 없다.
 *
 * 대조군도 함께 만든다 — 시트 없이 텍스트 설명만으로 같은 씬 3개.
 * 이래야 "시트 덕분인가 우연인가"가 갈린다.
 *
 * 사용: node consistency_test.mjs [모델ID]
 */
import { readFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { GoogleGenAI } from '/Users/seungminlee/dev/smart_seller_studio/node_modules/@google/genai/dist/node/index.mjs';
import sharp from '/Users/seungminlee/dev/smart_seller_studio/node_modules/sharp/lib/index.js';

const DIR = path.dirname(new URL(import.meta.url).pathname);
const MODEL_ID = process.argv[2] ?? 'model_f_a';
const OUT = `${DIR}/consistency/${MODEL_ID}`;
mkdirSync(OUT, { recursive: true });

const apiKey = readFileSync('/Users/seungminlee/dev/smart_seller_studio/.env.local', 'utf8')
  .split('\n').find((l) => l.startsWith('GOOGLE_AI_API_KEY='))
  ?.slice('GOOGLE_AI_API_KEY='.length).trim().replace(/^["']|["']$/g, '');

const sheet = readFileSync(`${DIR}/models/${MODEL_ID}.jpg`).toString('base64');

/** 매 요청에 붙는 두 줄 — 영상이 "이거 하나만 가져가도 영상값은 한다"고 한 부분. */
const IDENTITY_LOCK =
  'IDENTITY LOCK: The person in this scene MUST be the exact same individual shown in the attached ' +
  'character reference sheet — same face structure, same eyes, same nose, same lips, same jawline, ' +
  'same hairstyle, same hair length and color, same skin tone, same apparent age. Treat the reference ' +
  'sheet as a casting photo of the model who is being photographed here. Do not substitute a different person.';

/** 씬 3종 — 각도·거리·조명·배경을 일부러 크게 벌린다. 쉬운 조건에서만 되면 의미가 없다. */
const SCENES = [
  { id: 's1', text: 'A lifestyle photograph of the model standing in a bright minimal Korean apartment living room by a window, soft morning daylight, holding a folded cotton garment, waist-up, looking at the camera with a light smile.' },
  { id: 's2', text: 'A lifestyle photograph of the model sitting on a light oak chair in a warm cafe interior, afternoon light from the side, three-quarter angle, full upper body, looking slightly off-camera.' },
  { id: 's3', text: 'A close-up beauty-style portrait of the model outdoors in soft overcast daylight against a blurred green park background, head and shoulders, calm expression.' },
];

const SHARED_RULES =
  '\n\nCRITICAL COMPOSITION RULE: Generate exactly ONE single-frame photograph. No split-panel, diptych, ' +
  'multi-view, collage, or composite layouts.\nPhotorealistic, natural skin texture, no text or watermark.';

const ai = new GoogleGenAI({ apiKey });

async function gen(label, parts) {
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    config: { responseModalities: ['Text', 'Image'], imageConfig: { imageSize: '1K' } },
    contents: [{ role: 'user', parts }],
  });
  const p = (res.candidates?.[0]?.content?.parts ?? []).find((x) => x.inlineData?.data);
  if (!p) { console.log(`  ${label}: 실패 (${res.candidates?.[0]?.finishReason})`); return; }
  await sharp(Buffer.from(p.inlineData.data, 'base64')).jpeg({ quality: 94 }).toFile(`${OUT}/${label}.jpg`);
  console.log(`  ${label}.jpg`);
}

console.log(`[실험군] 캐릭터 시트를 참조로 붙인다 — ${MODEL_ID}`);
for (const s of SCENES) {
  await gen(`ref_${s.id}`, [
    { inlineData: { data: sheet, mimeType: 'image/jpeg' } },
    { text: `${s.text}\n\n${IDENTITY_LOCK}${SHARED_RULES}` },
  ]);
}

console.log('[대조군] 시트 없이 텍스트 설명만');
const TEXT_ONLY = 'The model is a South Korean woman in her early twenties with long wavy dark chestnut hair, ' +
  'large bright double-eyelid eyes, fair glowing skin, and a warm friendly expression.';
for (const s of SCENES) {
  await gen(`txt_${s.id}`, [{ text: `${s.text}\n\n${TEXT_ONLY}${SHARED_RULES}` }]);
}
console.log(`\n출력: ${OUT}`);
