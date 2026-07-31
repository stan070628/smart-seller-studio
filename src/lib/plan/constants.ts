/**
 * 활성 플랜 배럴.
 *
 * 플랜을 교체할 때는 아래 export 문의 import 경로 한 줄만 바꾼다.
 * 소비자 4곳(PlanClient / DashboardClient / api/dashboard/summary /
 * api/dashboard/orders-summary)은 이 파일만 import하므로 수정할 필요가 없다.
 *
 * plans/ 아래에 index 배럴(export *)을 만들지 않는다. 만들면 v2와 v3 데이터가
 * 둘 다 번들에 딸려 들어간다. 여기서 특정 파일 하나만 named import 한다.
 *
 * 활성: v3 (2026-07-27 ~ 2026-10-18, 목표 월매출 2,000만원)
 * 이전: v2 (plans/v2-scale-1000.ts — 아카이브, 참조되지 않음)
 */
export type { WbsTask, WeekData } from './plans/types';
export {
  WBS_DATA,
  WEEKLY_TARGETS,
  WEEKLY_RUN_RATE,
  PLAN_START,
  PLAN_MAX_TARGET,
  PLAN_GOAL_MONTHLY,
  MONTH_WEEKS,
} from './plans/v3-scale-2000';
