export interface SceneProductInfo {
  headline?: string;
  subheadline?: string;
  sellingPoints?: Array<{ title: string; description: string }>;
  features?: Array<{ title: string }>;
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
    if (productInfo.sellingPoints?.length) {
      lines.push(`Key selling points: ${productInfo.sellingPoints.map((sp) => sp.title).join(', ')}`);
    }
    if (productInfo.features?.length) {
      lines.push(`Product features: ${productInfo.features.map((f) => f.title).join(', ')}`);
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
  lines.push(
    editOpts?.isCompositeBackground
      ? 'Generate a detailed Gemini prompt for the EMPTY BACKGROUND PLATE ONLY for this section. Return only JSON.'
      : 'Generate a detailed Gemini image generation prompt for this section. Return only JSON.',
  );

  return lines.join('\n');
}
