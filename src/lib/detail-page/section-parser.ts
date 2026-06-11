// src/lib/detail-page/section-parser.ts
import { v4 as uuidv4 } from 'uuid';
import type { AttachedImage, DetailSection, SectionType } from '@/types/detail-page';
import type { DetailPageContent, MobileDetailPageContent } from '@/lib/ai/prompts/detail-page';

/**
 * DetailPageContent(AI 생성 결과)를 DetailSection[] 으로 변환한다.
 * 빈 배열에 해당하는 선택적 섹션은 생략하며, order는 0부터 시작하는 연속 인덱스를 사용한다.
 */
export function contentToSections(content: DetailPageContent): DetailSection[] {
  if (!content.headline?.trim()) {
    throw new Error('contentToSections: headline must not be empty');
  }
  if (!content.ctaText?.trim()) {
    throw new Error('contentToSections: ctaText must not be empty');
  }

  const sections: DetailSection[] = [];
  let order = 0;

  // hero — headline/subheadline 는 항상 존재하므로 생략 조건 없음
  sections.push({
    id: uuidv4(),
    type: 'hero',
    order: order++,
    content: {
      type: 'hero',
      headline: content.headline,
      subheadline: content.subheadline,
    },
    attachedImages: [],
    aiInstruction: undefined,
    eyebrow: undefined,
  });

  // selling_points — 빈 배열이면 섹션 생략
  if (content.sellingPoints.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'selling_points',
      order: order++,
      content: {
        type: 'selling_points',
        points: content.sellingPoints,
      },
      attachedImages: [],
      aiInstruction: undefined,
      eyebrow: undefined,
    });
  }

  // features — 빈 배열이면 섹션 생략
  if (content.features.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'features',
      order: order++,
      content: {
        type: 'features',
        items: content.features,
      },
      attachedImages: [],
      aiInstruction: undefined,
      eyebrow: undefined,
    });
  }

  // spec_table — 빈 배열이면 섹션 생략
  if (content.specs.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'spec_table',
      order: order++,
      content: {
        type: 'spec_table',
        specs: content.specs,
      },
      attachedImages: [],
      aiInstruction: undefined,
      eyebrow: undefined,
    });
  }

  // usage_steps — 빈 배열이면 섹션 생략
  if (content.usageSteps.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'usage_steps',
      order: order++,
      content: {
        type: 'usage_steps',
        steps: content.usageSteps,
      },
      attachedImages: [],
      aiInstruction: undefined,
      eyebrow: undefined,
    });
  }

  // warning — 빈 배열이면 섹션 생략
  if (content.warnings.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'warning',
      order: order++,
      content: {
        type: 'warning',
        warnings: content.warnings,
      },
      attachedImages: [],
      aiInstruction: undefined,
      eyebrow: undefined,
    });
  }

  // cta — ctaText 는 항상 존재하므로 생략 조건 없음
  sections.push({
    id: uuidv4(),
    type: 'cta',
    order: order++,
    content: {
      type: 'cta',
      text: content.ctaText,
    },
    attachedImages: [],
    aiInstruction: undefined,
    eyebrow: undefined,
  });

  // 'stats' 섹션은 DetailPageContent에 해당 데이터가 없으므로 생성하지 않음.
  // 사용자가 수동으로 '섹션 추가' 버튼을 통해서만 추가 가능.

  return sections;
}

/**
 * MobileDetailPageContent(모바일 AI 생성 결과)를 DetailSection[]으로 변환한다.
 * 이미지 배치 규칙 (스펙 §6):
 *  - img[0] → hero, img[1..] → 각 point에 1장씩
 *  - 남는 이미지: colorOptions 있으면 전부 image_grid로 (items가 부족하면 빈 라벨로 패딩),
 *    없으면 2장 이상일 때만 라벨 없는 image_grid, 정확히 1장이면 마지막 point에 추가
 */
export function mobileContentToSections(
  content: MobileDetailPageContent,
  imageUrls: string[],
): DetailSection[] {
  if (!content.hook?.headline?.trim()) {
    throw new Error('mobileContentToSections: hook.headline must not be empty');
  }
  if (!content.ctaText?.trim()) {
    throw new Error('mobileContentToSections: ctaText must not be empty');
  }

  const toAttached = (url: string, order: number): AttachedImage => ({
    url,
    order,
    processingMode: 'original',
  });

  const sections: DetailSection[] = [];
  let order = 0;
  const base = { aiInstruction: undefined, eyebrow: undefined };

  // brand_header — brandName 없으면 생략
  if (content.brandName.trim()) {
    sections.push({
      id: uuidv4(),
      type: 'brand_header',
      order: order++,
      content: { type: 'brand_header', brandName: content.brandName, rightLabel: content.categoryLabelEn },
      attachedImages: [],
      ...base,
    });
  }

  // hero(hook) — img[0], 해시태그는 이중 공백으로 결합해 subheadline에 저장
  sections.push({
    id: uuidv4(),
    type: 'hero',
    order: order++,
    content: {
      type: 'hero',
      headline: content.hook.headline,
      subheadline: content.hook.hashtags.join('  '),
    },
    attachedImages: imageUrls[0] ? [toAttached(imageUrls[0], 0)] : [],
    aiInstruction: undefined,
    eyebrow: content.hook.eyebrow || undefined,
  });

  // points — img[1..] 1장씩
  const pointSections: DetailSection[] = content.points.map((p, i) => ({
    id: uuidv4(),
    type: 'point' as const,
    order: order++,
    content: { type: 'point' as const, pointLabel: p.pointLabel, headline: p.headline, subheadline: p.subheadline },
    attachedImages: imageUrls[i + 1] ? [toAttached(imageUrls[i + 1], 0)] : [],
    ...base,
  }));
  sections.push(...pointSections);

  // 남는 이미지 분배
  const leftover = imageUrls.slice(1 + content.points.length);
  const hasColorOptions = content.colorOptions.length > 0;

  if (hasColorOptions) {
    // items가 leftover보다 적으면 빈 라벨로 패딩 (모든 이미지 렌더링 보장)
    const items: Array<{ label: string; swatchColor?: string }> = [...content.colorOptions];
    while (items.length < leftover.length) items.push({ label: '' });
    sections.push({
      id: uuidv4(),
      type: 'image_grid',
      order: order++,
      content: { type: 'image_grid', title: 'Product Info.', items },
      attachedImages: leftover.map((u, i) => toAttached(u, i)),
      ...base,
    });
  } else if (leftover.length >= 2) {
    sections.push({
      id: uuidv4(),
      type: 'image_grid',
      order: order++,
      content: { type: 'image_grid', title: 'Product Info.', items: leftover.map(() => ({ label: '' })) },
      attachedImages: leftover.map((u, i) => toAttached(u, i)),
      ...base,
    });
  } else if (leftover.length === 1 && pointSections.length > 0) {
    const last = pointSections[pointSections.length - 1];
    last.attachedImages = [...last.attachedImages, toAttached(leftover[0], last.attachedImages.length)];
  }

  // spec_table / warning / cta
  if (content.specs.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'spec_table',
      order: order++,
      content: { type: 'spec_table', specs: content.specs },
      attachedImages: [],
      ...base,
    });
  }
  if (content.warnings.length > 0) {
    sections.push({
      id: uuidv4(),
      type: 'warning',
      order: order++,
      content: { type: 'warning', warnings: content.warnings },
      attachedImages: [],
      ...base,
    });
  }
  sections.push({
    id: uuidv4(),
    type: 'cta',
    order: order++,
    content: { type: 'cta', text: content.ctaText },
    attachedImages: [],
    ...base,
  });

  return sections;
}

/**
 * 주어진 type과 order로 빈 DetailSection을 생성하는 헬퍼.
 * 드래그&드롭으로 새 섹션을 추가할 때 사용한다.
 */
export function createEmptySection(type: SectionType, order: number): DetailSection {
  const base = {
    id: uuidv4(),
    type,
    order,
    attachedImages: [] as DetailSection['attachedImages'],
    aiInstruction: undefined,
  } as const;

  switch (type) {
    case 'hero':
      return { ...base, type: 'hero', content: { type: 'hero', headline: '', subheadline: '' } };
    case 'selling_points':
      return { ...base, type: 'selling_points', content: { type: 'selling_points', points: [] } };
    case 'features':
      return { ...base, type: 'features', content: { type: 'features', items: [] } };
    case 'stats':
      return { ...base, type: 'stats', content: { type: 'stats', stats: [] } };
    case 'spec_table':
      return { ...base, type: 'spec_table', content: { type: 'spec_table', specs: [] } };
    case 'usage_steps':
      return { ...base, type: 'usage_steps', content: { type: 'usage_steps', steps: [] } };
    case 'warning':
      return { ...base, type: 'warning', content: { type: 'warning', warnings: [] } };
    case 'cta':
      return { ...base, type: 'cta', content: { type: 'cta', text: '' } };
    case 'brand_header':
      return { ...base, type: 'brand_header', content: { type: 'brand_header', brandName: '', rightLabel: '' } };
    case 'point':
      return { ...base, type: 'point', content: { type: 'point', pointLabel: '', headline: '', subheadline: '' } };
    case 'image_grid':
      return { ...base, type: 'image_grid', content: { type: 'image_grid', title: '', items: [] } };
  }
}

/**
 * 현재 배열 순서 기준으로 각 섹션의 order 필드를 0, 1, 2, ... 으로 재할당한다.
 * 드래그&드롭으로 순서가 바뀐 뒤 호출해 order를 정렬 상태와 동기화한다.
 * 원본 배열은 변경하지 않는다(불변 패턴).
 */
export function reorderSections(sections: DetailSection[]): DetailSection[] {
  return sections.map((s, i) => ({ ...s, order: i }));
}
