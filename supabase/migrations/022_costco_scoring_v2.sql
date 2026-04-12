-- 022_costco_scoring_v2.sql
-- 소싱 스코어 v2: 채널 수수료 반영 마진 계산 + 가중치 재설정
--
-- 변경 사항:
--   1. margin_score 계산: 기존 10% 수수료 → 네이버 6% 수수료 기준으로 변경
--   2. SCORE_WEIGHTS 변경 (costco-constants.ts와 동기화):
--      demand: 25 → 20, urgency: 15 → 10, margin: 15 → 25
--
-- 이 마이그레이션은 스키마 변경 없이 기존 스코어를 재계산하는 트리거 역할을 합니다.
-- 실제 스코어 재계산은 recalculateSourcingScores() 함수 호출 시 적용됩니다.

-- 현재 스코어 통계 확인용 (실행 후 확인)
DO $$
BEGIN
  RAISE NOTICE 'costco_products score stats: count=%, avg_score=%, max_score=%',
    (SELECT COUNT(*) FROM public.costco_products WHERE is_active = true),
    (SELECT ROUND(AVG(sourcing_score)) FROM public.costco_products WHERE is_active = true),
    (SELECT MAX(sourcing_score) FROM public.costco_products WHERE is_active = true);
END $$;
