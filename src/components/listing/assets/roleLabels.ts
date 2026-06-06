import type { AiImageSlot } from '@/lib/detail-page/ai-html-builder';

// 역할별 한국어 레이블 — SceneImageDrawer, AssetsResultPanel 등에서 공유
export const ROLE_LABELS: Record<AiImageSlot['role'], string> = {
  hero: '메인 히어로',
  lifestyle: '라이프스타일',
  detail: '소재·디테일',
  feature: '기능 강조',
};
