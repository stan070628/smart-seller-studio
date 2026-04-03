/**
 * 13개 프레임 상세페이지 관련 타입 정의 + 커스텀 타입
 */

export type FrameType =
  | 'hero'
  | 'pain_point'
  | 'solution'
  | 'usp'
  | 'detail_1'
  | 'detail_2'
  | 'how_to_use'
  | 'before_after'
  | 'target'
  | 'spec'
  | 'faq'
  | 'social_proof'
  | 'cta'
  | 'custom_3col'          // 3컬럼 제품 비교
  | 'custom_gallery'       // 4이미지 갤러리
  | 'custom_notice'        // 공지/안내 + 배송흐름도
  | 'custom_return_notice' // 반품/교환 주의 + CS 운영시간
  | 'custom_privacy';      // 개인정보제공 동의

export interface FrameMeta {
  type: FrameType;
  label: string;
  labelKo: string;
  description: string;
  sortOrder: number;
}

export interface FrameCopy {
  id: string;
  frameType: FrameType;
  version: number;
  headline: string;
  subheadline?: string;
  bodyText?: string;
  ctaText?: string;
  metadata: Record<string, unknown>;
  isSelected: boolean;
}

export interface GeneratedFrame {
  frameType: FrameType;
  headline: string;
  subheadline?: string | null;
  bodyText?: string | null;
  ctaText?: string | null;
  metadata: Record<string, unknown>;
  /** 제품 특성상 이 프레임이 맞지 않으면 true (UI에서 숨김 처리) */
  skip?: boolean;
  /** 이 프레임에 어울리는 이미지 연출 제안 (빈 슬롯 안내 문구로 표시) */
  imageDirection?: string | null;
}

export interface FrameState {
  id: string;
  frameType: FrameType;
  sortOrder: number;
  isEnabled: boolean;
  canvasObjects: unknown[];
  canvasJSON: Record<string, unknown> | null;
  copies: FrameCopy[];
  selectedCopyId: string | null;
  thumbnailDataUrl: string | null;
}
