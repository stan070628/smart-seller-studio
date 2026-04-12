/**
 * template-dimensions.ts
 * 프레임 타입별 템플릿 규격 상수
 *
 * ExportSection, DownloadAllButton에서 공동 참조하여
 * 크기 정보가 두 곳에서 중복 정의되지 않도록 분리
 */

import type { FrameType } from '@/types/frames';

export interface TemplateDimensions {
  w: number;
  h: number;
}

/**
 * frameType별 명시적 치수 오버라이드
 * 여기에 없는 프레임은 DEFAULT_DIMS가 적용됨
 */
export const TEMPLATE_DIMENSIONS: Partial<Record<FrameType, TemplateDimensions>> = {
  thumbnail: { w: 780, h: 780 },
};

/** 기본 치수 (780×1100 세로형 상세페이지 프레임) */
export const DEFAULT_DIMS: TemplateDimensions = { w: 780, h: 1100 };

/** frameType에 맞는 치수를 반환하는 헬퍼 */
export function getDims(frameType: FrameType): TemplateDimensions {
  return TEMPLATE_DIMENSIONS[frameType] ?? DEFAULT_DIMS;
}
