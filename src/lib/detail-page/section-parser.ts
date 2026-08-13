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

  // richSections — AI가 selectedSections 순서대로 지정한 rich 섹션들
  if (content.richSections?.selectedSections?.length) {
    const rich = content.richSections;
    const seenKeys = new Set<string>();
    for (const key of rich.selectedSections) {
      if (seenKeys.has(key)) continue;
      seenKeys.add(key);
      switch (key) {
        case 'point':
          if (rich.pointSections && rich.pointSections.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'point_section',
              order: order++,
              content: { type: 'point_section', items: rich.pointSections },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'stat':
          if (rich.statCallouts && rich.statCallouts.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'stat_callout',
              order: order++,
              content: { type: 'stat_callout', items: rich.statCallouts },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'bar_chart':
          if (rich.barChartItems && rich.barChartItems.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'bar_chart',
              order: order++,
              content: { type: 'bar_chart', items: rich.barChartItems },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'why':
          if (rich.whyIcons && rich.whyIcons.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'why_icons',
              order: order++,
              content: { type: 'why_icons', items: rich.whyIcons },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'cert':
          if (rich.certifications && rich.certifications.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'certifications',
              order: order++,
              content: { type: 'certifications', items: rich.certifications },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
        case 'steps':
          if (rich.infographicSteps && rich.infographicSteps.length > 0) {
            sections.push({
              id: uuidv4(),
              type: 'infographic_steps',
              order: order++,
              content: { type: 'infographic_steps', items: rich.infographicSteps },
              attachedImages: [],
              aiInstruction: undefined,
              eyebrow: undefined,
            });
          }
          break;
      }
    }
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

  // 🔴 렌더 API는 섹션당 이미지를 6개까지만 받는다(render/route.ts의 .max(6)).
  //    leftover를 한 섹션에 통째로 넣으면 7장부터 전체 렌더가
  //    "Too big: expected array to have <=6 items"로 실패한다 — 2026-08-12 실측.
  //    프롬프트로 Claude에게 제한을 알려도 leftover는 여기서 붙으므로 막히지 않는다.
  const IMAGES_PER_SECTION = 6;
  const chunk = <T,>(arr: T[], size: number): T[][] =>
    arr.length ? Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size)) : [];

  if (hasColorOptions) {
    // items가 leftover보다 적으면 빈 라벨로 패딩 (모든 이미지 렌더링 보장)
    const items: Array<{ label: string; swatchColor?: string }> = [...content.colorOptions];
    while (items.length < leftover.length) items.push({ label: '' });
    chunk(leftover, IMAGES_PER_SECTION).forEach((group, gi) => {
      sections.push({
        id: uuidv4(),
        type: 'image_grid',
        order: order++,
        content: {
          type: 'image_grid',
          title: 'Product Info.',
          items: items.slice(gi * IMAGES_PER_SECTION, gi * IMAGES_PER_SECTION + group.length),
        },
        attachedImages: group.map((u, i) => toAttached(u, i)),
        ...base,
      });
    });
  } else if (leftover.length >= 2) {
    chunk(leftover, IMAGES_PER_SECTION).forEach(group => {
      sections.push({
        id: uuidv4(),
        type: 'image_grid',
        order: order++,
        content: { type: 'image_grid', title: 'Product Info.', items: group.map(() => ({ label: '' })) },
        attachedImages: group.map((u, i) => toAttached(u, i)),
        ...base,
      });
    });
  } else if (leftover.length === 1 && pointSections.length > 0) {
    // 이미 6장인 섹션에 더 붙이면 같은 이유로 렌더가 실패한다.
    // 여유 있는 섹션을 뒤에서부터 찾고, 없으면 별도 섹션으로 뺀다.
    const room = [...pointSections].reverse().find(s => s.attachedImages.length < IMAGES_PER_SECTION);
    if (room) {
      room.attachedImages = [...room.attachedImages, toAttached(leftover[0], room.attachedImages.length)];
    } else {
      sections.push({
        id: uuidv4(),
        type: 'image_grid',
        order: order++,
        content: { type: 'image_grid', title: 'Product Info.', items: [{ label: '' }] },
        attachedImages: [toAttached(leftover[0], 0)],
        ...base,
      });
    }
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
    case 'point_section':
      return { ...base, type: 'point_section', content: { type: 'point_section', items: [] } };
    case 'stat_callout':
      return { ...base, type: 'stat_callout', content: { type: 'stat_callout', items: [] } };
    case 'bar_chart':
      return { ...base, type: 'bar_chart', content: { type: 'bar_chart', items: [] } };
    case 'why_icons':
      return { ...base, type: 'why_icons', content: { type: 'why_icons', items: [] } };
    case 'certifications':
      return { ...base, type: 'certifications', content: { type: 'certifications', items: [] } };
    case 'infographic_steps':
      return { ...base, type: 'infographic_steps', content: { type: 'infographic_steps', items: [] } };
    case 'claude_layout':
      return { ...base, type: 'claude_layout', content: { type: 'claude_layout', title: '', blocks: [] } };
    case 'youtube':
      return { ...base, type: 'youtube', content: { type: 'youtube', url: '', videoId: '', aspect: 'horizontal', enabled: true } };
    default: {
      const _exhaustive: never = type;
      throw new Error(`createEmptySection: unhandled type "${_exhaustive}"`);
    }
  }
}

/**
 * 생성된 섹션에 업로드된 원본 이미지를 순서대로 배분한다.
 * hero → img[0], selling_points → img[1], features → img[2]  순으로 할당.
 * 이미지가 섹션보다 적으면 나머지 이미지 대상 섹션은 attachedImages 빈 채로 유지.
 */
export function distributeImagesToSections(
  sections: DetailSection[],
  imageUrls: string[],
): DetailSection[] {
  const IMAGE_TARGETS = new Set<SectionType>(['hero', 'selling_points', 'features']);
  let imgIdx = 0;
  return sections.map(s => {
    if (imgIdx >= imageUrls.length) return s;
    if (!IMAGE_TARGETS.has(s.type)) return s;
    const url = imageUrls[imgIdx++];
    return {
      ...s,
      attachedImages: [{ url, order: 0, processingMode: 'original' as const }],
    };
  });
}

/**
 * 현재 배열 순서 기준으로 각 섹션의 order 필드를 0, 1, 2, ... 으로 재할당한다.
 * 드래그&드롭으로 순서가 바뀐 뒤 호출해 order를 정렬 상태와 동기화한다.
 * 원본 배열은 변경하지 않는다(불변 패턴).
 */
export function reorderSections(sections: DetailSection[]): DetailSection[] {
  return sections.map((s, i) => ({ ...s, order: i }));
}
