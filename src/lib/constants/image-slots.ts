/**
 * image-slots.ts
 * 프레임 타입별 이미지 슬롯 정의 상수
 */

import type { FrameType } from '@/types/frames';

export interface ImageSlotDef {
  key: string;
  label: string;
  /** 이미지 비율 힌트 (AI 생성 프롬프트에 반영) */
  aspectHint?: string;
}

export const FRAME_IMAGE_SLOTS: Partial<Record<FrameType, ImageSlotDef[]>> = {
  hero: [{ key: 'main', label: '메인 이미지', aspectHint: '780x660 landscape, wide horizontal banner' }],
  pain_point: [
    { key: 'background', label: '배경 이미지', aspectHint: '780x500 wide landscape, cinematic background' },
    { key: 'card', label: '카드 이미지', aspectHint: '380x200 wide horizontal, product close-up' },
  ],
  detail_1: [{ key: 'main', label: '상세 이미지', aspectHint: '684x270 ultra-wide horizontal banner, product detail shot' }],
  detail_2: [{ key: 'main', label: '감성 이미지', aspectHint: '340x300 nearly square, product lifestyle shot' }],
  spec: [{ key: 'main', label: '스펙 이미지', aspectHint: '780x260 wide horizontal banner' }],
  custom_3col: [
    { key: 'col1', label: '1번 제품' },
    { key: 'col2', label: '2번 제품' },
    { key: 'col3', label: '3번 제품' },
  ],
  custom_gallery: [
    { key: 'slot1', label: '이미지 1' },
    { key: 'slot2', label: '이미지 2' },
    { key: 'slot3', label: '이미지 3' },
    { key: 'slot4', label: '이미지 4' },
  ],
  how_to_use: [
    { key: 'step1', label: 'Step 1 이미지', aspectHint: '160x180 portrait, step illustration' },
    { key: 'step2', label: 'Step 2 이미지', aspectHint: '160x180 portrait, step illustration' },
    { key: 'step3', label: 'Step 3 이미지', aspectHint: '160x180 portrait, step illustration' },
  ],
  thumbnail: [
    { key: 'ref1', label: '참조 사진 1', aspectHint: '780x780 square, product reference photo' },
    { key: 'ref2', label: '참조 사진 2', aspectHint: '780x780 square, product reference photo' },
    { key: 'ref3', label: '참조 사진 3', aspectHint: '780x780 square, product reference photo' },
  ],
  // 텍스트 전용 프레임은 빈 배열
  solution: [],
  usp: [],
  before_after: [],
  target: [],
  faq: [],
  social_proof: [],
  cta: [],
  custom_notice: [],
  custom_return_notice: [],
  custom_privacy: [],
};

/** 주어진 프레임의 슬롯 목록 (없으면 빈 배열) */
export function getFrameSlots(frameType: FrameType): ImageSlotDef[] {
  return FRAME_IMAGE_SLOTS[frameType] ?? [];
}
