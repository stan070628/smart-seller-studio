import { PALETTES } from '@/lib/detail-page/palette-config';
import type { PaletteName } from '@/types/detail-page';

export interface SceneProductInfo {
  headline?: string;
  subheadline?: string;
  sellingPoints?: Array<{ title: string; description: string }>;
  features?: Array<{ title: string }>;

  // ── 씬 컨텍스트 확장 ────────────────────────────────────────────────
  // Claude가 상품명만 보고 씬을 지어내던 것을 막는다. 여기 없는 정보는
  // Claude가 카테고리 평균으로 추측하며, 그 추측이 씬을 일반적으로 만든다.
  // 전부 optional이고 비면 라인 자체가 나오지 않는다(하위호환).

  /** 소재·혼용률. 질감·드레이프·조명 선택을 좌우한다 (예: "면 55% 폴리에스터 45%") */
  material?: string;
  /** 색상 옵션명. 씬 배색과 배경 대비를 정할 때 쓴다 */
  colors?: string[];
  /** 판매 카테고리 (예: "남성 후드티") */
  category?: string;
  /** 타깃 고객 (예: "20~30대 남녀") */
  targetCustomer?: string;
  /** 사용 계절·시즌 (예: "봄가을 간절기") */
  season?: string;
  /** 가격대. 씬의 격을 정한다 (예: "5만원대 캐주얼") */
  priceTier?: string;
  /**
   * 씬에 나타나면 안 되는 것. 상품 사실과 어긋나는 연출을 막는다
   * (예: 기모가 아닌 옷의 한겨울 눈밭 씬, 풀오버인데 지퍼를 그리는 것)
   */
  avoid?: string[];
}

export interface SceneEditOpts {
  /** true: 첫 번째 reference 이미지가 수정할 기존 씬 이미지 */
  isEditMode?: boolean;
  /** 편집 지시어 (편집 모드) 또는 art direction (새 생성 모드) */
  instruction?: string;
  /**
   * true: 합성 모드 배경 브리프 — 제품은 나중에 합성되므로
   * 참조 이미지는 세팅/조명 추론용으로만 쓰고 배경 플레이트 프롬프트만 요청한다.
   */
  isCompositeBackground?: boolean;
  /**
   * 페이지 팔레트. 지정하면 씬의 배경·강조색 톤을 페이지 팔레트에 맞추도록
   * 프롬프트 끝에 힌트를 덧붙인다(paletteToneHint 참조). 생략하면 기존 동작과
   * 동일하다 — 섹션마다 씬을 개별 생성해온 기존 호출부를 깨지 않기 위함이다.
   */
  palette?: PaletteName;
}

/** 섹션 이미지들의 색감을 페이지 팔레트에 맞춰 통일한다. 섹션마다 톤이 제각각이면
 *  같은 페이지의 사진이 아니라 짜깁기로 읽힌다.
 *  🔴 반환값은 출력 형식 지시("Return only JSON") **앞에** 넣는다 — 형식 지시가
 *  마지막에 있어야 준수율이 높다. */
export function paletteToneHint(palette?: PaletteName): string {
  if (!palette) return '';
  const c = PALETTES[palette];
  return `Color tone of the scene you describe: match the page palette — background tones near ${c.bg}, accents near ${c.accent}. Keep the overall color temperature consistent with these hex values, with muted natural saturation.`;
}

export function buildSceneUserPrompt(
  sectionType: string,
  productInfo: SceneProductInfo | undefined,
  sceneHint: string | undefined,
  editOpts?: SceneEditOpts,
): string {
  if (editOpts?.isEditMode) {
    const lines: string[] = [
      'The FIRST image is the existing scene image to be modified (previously AI-generated).',
      'The remaining image(s) are the original product reference photos — use them to ensure product accuracy.',
    ];
    if (editOpts.instruction?.trim()) {
      lines.push(`Edit instruction: ${editOpts.instruction.trim()}`);
    }
    lines.push('');
    lines.push(`Section type: ${sectionType}`);
    const editTone = paletteToneHint(editOpts.palette);
    if (editTone) lines.push(editTone);
    lines.push(
      'Generate a Gemini image editing prompt that modifies the existing scene per the edit instruction while keeping the product appearance unchanged. Return only JSON: {"prompt": "..."}',
    );
    return lines.join('\n');
  }

  // 새 생성 모드
  const lines: string[] = [
    editOpts?.isCompositeBackground
      ? 'Product reference image(s) are attached above — use them ONLY to infer an appropriate setting, camera height, and lighting direction. The product itself will be composited onto your background later and must NOT appear in it.'
      : 'Product reference image(s) are attached above.',
  ];

  if (productInfo) {
    if (productInfo.headline) lines.push(`Product headline: ${productInfo.headline}`);
    if (productInfo.subheadline) lines.push(`Subheadline: ${productInfo.subheadline}`);
    if (productInfo.category) lines.push(`Category: ${productInfo.category}`);
    if (productInfo.material) lines.push(`Material: ${productInfo.material}`);
    if (productInfo.colors?.length) {
      lines.push(`Available colors: ${productInfo.colors.join(', ')}`);
    }
    if (productInfo.targetCustomer) lines.push(`Target customer: ${productInfo.targetCustomer}`);
    if (productInfo.season) lines.push(`Season / usage period: ${productInfo.season}`);
    if (productInfo.priceTier) lines.push(`Price tier: ${productInfo.priceTier}`);
    if (productInfo.sellingPoints?.length) {
      // description까지 넘긴다. title만 넘기던 시절에는 "가벼움" 같은 한 단어가
      // 씬에 아무 제약도 걸지 못했다 — 이유를 알아야 조명·환경이 정해진다.
      lines.push(
        `Key selling points:\n${productInfo.sellingPoints
          .map((sp) => (sp.description?.trim() ? `- ${sp.title}: ${sp.description}` : `- ${sp.title}`))
          .join('\n')}`,
      );
    }
    if (productInfo.features?.length) {
      lines.push(`Product features: ${productInfo.features.map((f) => f.title).join(', ')}`);
    }
    if (productInfo.avoid?.length) {
      // 부정 지시는 prompts.ts의 NOT ~ 문형과 같은 역할을 한다 — AI가 카테고리
      // 기본값으로 수렴하는 것을 배제한다. 긍정 지시로 바꾸면 효과가 사라진다.
      lines.push(
        `MUST NOT appear or be implied in the scene: ${productInfo.avoid.join('; ')}. ` +
          'These contradict the actual product — do not depict them even if typical for this category.',
      );
    }
  }

  // instruction + sceneHint 합산 (둘 다 있으면 '. '으로 이음)
  const hints = [sceneHint?.trim(), editOpts?.instruction?.trim()].filter(Boolean).join('. ');
  if (hints) {
    lines.push('');
    lines.push(`Art direction (apply this mood/style to the scene): ${hints}`);
  }

  lines.push('');
  lines.push(`Section type: ${sectionType}`);
  const tone = paletteToneHint(editOpts?.palette);
  if (tone) lines.push(tone);
  lines.push(
    editOpts?.isCompositeBackground
      ? 'Generate a detailed Gemini prompt for the EMPTY BACKGROUND PLATE ONLY for this section. Return only JSON.'
      : 'Generate a detailed Gemini image generation prompt for this section. Return only JSON.',
  );

  return lines.join('\n');
}
