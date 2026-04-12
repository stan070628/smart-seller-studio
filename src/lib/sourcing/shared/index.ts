/**
 * shared/index.ts
 * 공통 소싱 유틸리티 통합 re-export
 *
 * 코스트코·도매꾹 양쪽에서 import:
 *   import { getGrade, getSeasonBonus, classifyMaleTarget } from '@/lib/sourcing/shared';
 */

export * from './channel-policy';
export * from './grade';
export * from './male-classifier';
export * from './season-bonus';
