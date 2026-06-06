import type { ProductImageAnalysis, DetailPageContent } from '@/lib/ai/prompts/detail-page';

// ─────────────────────────────────────────
// 타입 정의
// ─────────────────────────────────────────

export interface VisualIdentity {
  colorPalette: string;
  mood: string;
  lighting: string;
  background: string;
}

export interface SectionImagePrompt {
  role: 'hero' | 'lifestyle' | 'detail' | 'feature';
  scene: string;
  referenceImageIndex: number;
}

export interface ImagePromptsResponse {
  visualIdentity: VisualIdentity;
  imagePrompts: SectionImagePrompt[];
}

// ─────────────────────────────────────────
// 제품 보존 규칙 (Gemini 이미지 생성 시 제품 원형 유지 강제)
// ─────────────────────────────────────────

const PRODUCT_PRESERVATION_RULES = `
CRITICAL RULES — follow exactly:
- Do NOT alter the product's shape, size, proportions, or colors.
- Do NOT change any text, logos, labels, or printed graphics on the product. Preserve them exactly as in the reference image.
- Do NOT change the material or texture of the product itself.
- Only change the background, lighting, and surrounding environment.
- The product must look IDENTICAL to the reference image provided.
- Do NOT render any text, letters, words, captions, or typography anywhere in the generated image. The image must be completely text-free. (Exception: the product's own printed labels/logos must remain as-is from the reference.)
- Do NOT add promotional badges, price tags, discount labels, or marketing text overlays.
`.trim();

// ─────────────────────────────────────────
// 시스템 프롬프트
// ─────────────────────────────────────────

export const IMAGE_PROMPTS_SYSTEM_PROMPT = `You are an expert Korean e-commerce visual art director and product photographer.
Given a product analysis and its detail page copy, you define a visual identity and generate image prompts for Gemini AI.
Output JSON only. No markdown, no explanation.`;

// ─────────────────────────────────────────
// 유저 프롬프트 빌더
// ─────────────────────────────────────────

/**
 * Claude에게 비주얼 아이덴티티 + 4개 섹션 이미지 프롬프트 생성을 요청하는 유저 프롬프트를 만든다.
 * @param analysis - Gemini 이미지 분석 결과
 * @param content - 상세페이지 카피 (headline, subheadline, sellingPoints, features)
 * @param productName - 상품명 (선택)
 */
export function buildImagePromptsUserPrompt(
  analysis: ProductImageAnalysis,
  content: Pick<DetailPageContent, 'headline' | 'subheadline' | 'sellingPoints' | 'features'>,
  productName?: string,
): string {
  const lines: string[] = [];

  if (productName) lines.push(`Product name: ${productName}`);
  lines.push(`Headline: ${content.headline}`);
  lines.push(`Subheadline: ${content.subheadline}`);
  lines.push(`Material: ${analysis.material}`);
  lines.push(`Shape: ${analysis.shape}`);
  lines.push(`Colors: ${analysis.colors.join(', ')}`);
  lines.push(`Key components: ${analysis.keyComponents.join(', ')}`);
  lines.push(`Selling points: ${content.sellingPoints.map(sp => sp.title).join(', ')}`);

  lines.push(`
Define a visual identity and 4 section image prompts for this product.
Output this exact JSON:
{
  "visualIdentity": {
    "colorPalette": "2-3 colors that complement the product, e.g. warm ivory, soft beige",
    "mood": "1-2 adjectives, e.g. premium minimal",
    "lighting": "lighting description, e.g. soft diffused natural light",
    "background": "background description, e.g. off-white linen texture"
  },
  "imagePrompts": [
    { "role": "hero", "scene": "clean front-facing studio product shot description", "referenceImageIndex": 0 },
    { "role": "lifestyle", "scene": "realistic lifestyle usage scene description", "referenceImageIndex": 0 },
    { "role": "detail", "scene": "macro close-up of material or craftsmanship description", "referenceImageIndex": 0 },
    { "role": "feature", "scene": "key functional feature highlight description", "referenceImageIndex": 0 }
  ]
}
Rules: scene descriptions must be in English, concise (1-2 sentences), specific to this product.`);

  return lines.join('\n');
}

// ─────────────────────────────────────────
// 응답 파싱
// ─────────────────────────────────────────

const VALID_ROLES = ['hero', 'lifestyle', 'detail', 'feature'] as const;

/**
 * Claude의 이미지 프롬프트 응답 텍스트를 파싱하여 ImagePromptsResponse로 변환한다.
 * JSON 블록이 없거나 imagePrompts가 배열이 아니면 에러를 던진다.
 */
export function parseImagePromptsResponse(rawText: string): ImagePromptsResponse {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('이미지 프롬프트 응답에서 JSON을 찾을 수 없습니다.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('이미지 프롬프트 응답 JSON 파싱 실패');
  }

  const data = parsed as Record<string, unknown>;
  if (!Array.isArray(data.imagePrompts)) {
    throw new Error('imagePrompts가 배열이 아닙니다');
  }

  const vi = (data.visualIdentity ?? {}) as Record<string, unknown>;

  return {
    visualIdentity: {
      colorPalette: String(vi.colorPalette ?? 'neutral tones'),
      mood: String(vi.mood ?? 'clean minimal'),
      lighting: String(vi.lighting ?? 'soft natural light'),
      background: String(vi.background ?? 'clean white'),
    },
    imagePrompts: (data.imagePrompts as Array<Record<string, unknown>>).map((p) => ({
      role: VALID_ROLES.includes(p.role as never)
        ? (p.role as SectionImagePrompt['role'])
        : 'feature',
      scene: String(p.scene ?? ''),
      referenceImageIndex: typeof p.referenceImageIndex === 'number' ? p.referenceImageIndex : 0,
    })),
  };
}

// ─────────────────────────────────────────
// Gemini 최종 프롬프트 빌더
// ─────────────────────────────────────────

/**
 * 비주얼 아이덴티티 + 장면 설명 + 제품 보존 규칙을 결합하여
 * Gemini 이미지 생성용 최종 프롬프트를 만든다.
 * @param visualIdentity - Claude가 생성한 비주얼 아이덴티티
 * @param scene - 해당 섹션의 장면 설명 (영어)
 */
export function buildFinalGeminiPrompt(
  visualIdentity: VisualIdentity,
  scene: string,
): string {
  return [
    `Visual style: ${visualIdentity.colorPalette}. Mood: ${visualIdentity.mood}. Lighting: ${visualIdentity.lighting}. Background: ${visualIdentity.background}.`,
    '',
    scene,
    '',
    PRODUCT_PRESERVATION_RULES,
  ].join('\n');
}
