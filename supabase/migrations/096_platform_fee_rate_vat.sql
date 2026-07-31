-- ═══════════════════════════════════════════════════════════════════════════
-- 096_platform_fee_rate_vat.sql
-- [Render PostgreSQL] Supabase 마이그레이션이 아니다. SOURCING_DATABASE_URL로
-- 접속하는 Render DB 전용이며, Supabase 프로젝트에는 적용되지 않는다.
--
-- 판매 수수료율에 부가세를 반영하고, 식품 카테고리 요율을 실측값으로 교정한다.
--
-- 배경:
--   쿠팡 판매 수수료는 VAT 별도로 고지된다(판매자센터: "10.6 %, (VAT 별도, 정률)").
--   사업자가 **간이과세자**라 매입세액 공제가 `매입액 × 0.5%`로 제한되므로,
--   수수료 VAT를 사실상 돌려받지 못한다. 따라서 VAT가 그대로 비용이다.
--
--   기존 장부는 VAT를 전혀 반영하지 않아 마진을 과대계상하고 있었다.
--   극세사 타월 기준 개당 111원, 월 약 4.2만원 규모다.
--
-- 실측 근거 (2026-07-31 판매자센터 카테고리 화면):
--   식품>스낵/간식>스낵/시리얼>시리얼          (위트빅스)        = 10.6%
--   식품>건강식품>헬스/다이어트식품>다이어트쉐이크 (랩노쉬 슬림쉐이크) = 10.6%
--   식품>건강식품>헬스/다이어트식품>드링크믹스 RTD (랩노쉬 드링크)   = 10.6%
--
--   ⚠️ 나머지 카테고리는 미검증이므로 기존 고지값(10.8%)을 유지한 채
--      VAT만 반영한다. 임의로 10.6%를 적용하지 않는다.
--
-- 결과:
--   식품 계열 4종  0.1060 × 1.1 = 0.1166
--   그 외 52종     0.1080 × 1.1 = 0.1188
--
-- 되돌리기 (일반과세자 전환 시):
--   UPDATE public.product_costs SET platform_fee_rate = ROUND(platform_fee_rate / 1.1, 4);
--   그리고 src/lib/tax.ts의 IS_SIMPLIFIED_TAXPAYER를 false로 바꾼다.
--
-- 적용: node scripts/migrate-sourcing.mjs 096
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. 식품 계열 3종을 실측 고지값(10.6%)으로 교정.
--    덴프스 NMN은 이미 0.1060으로 올바르게 입력되어 있어 대상에서 빠진다.
UPDATE public.product_costs
   SET platform_fee_rate = 0.1060
 WHERE platform_fee_rate = 0.1080
   AND (
        product_name LIKE '%위트빅스%'
     OR product_name LIKE '%슬림쉐이크%'
     OR product_name LIKE '%프로틴 드링크%'
   );

-- 2. 전 상품에 VAT 반영. 고지 요율 → 실질 부담 요율.
--    이미 반영된 건이 없음을 조건으로 확인해 이중 적용을 막는다.
UPDATE public.product_costs
   SET platform_fee_rate = ROUND(platform_fee_rate * 1.1, 4)
 WHERE platform_fee_rate <= 0.1080;

COMMIT;
