export interface SceneProductInfo {
  headline?: string;
  subheadline?: string;
  sellingPoints?: Array<{ title: string; description: string }>;
  features?: Array<{ title: string }>;
}

/**
 * Claude에 줄 유저 프롬프트를 만든다.
 * sceneHint(브리프 art direction)가 있으면 한 줄로 합류시킨다.
 * 제품 픽셀 보존 등 핵심 규칙은 SYSTEM 프롬프트(route.ts)에 그대로 있다.
 */
export function buildSceneUserPrompt(
  sectionType: string,
  productInfo: SceneProductInfo | undefined,
  sceneHint: string | undefined,
): string {
  const lines: string[] = ['Product reference image(s) are attached above.'];

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

  if (sceneHint && sceneHint.trim()) {
    lines.push('');
    lines.push(`Art direction (apply this mood/style to the scene): ${sceneHint.trim()}`);
  }

  lines.push('');
  lines.push(`Section type: ${sectionType}`);
  lines.push('Generate a detailed Gemini image generation prompt for this section. Return only JSON.');

  return lines.join('\n');
}
