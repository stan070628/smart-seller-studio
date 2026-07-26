/**
 * 활성 플랜 배럴.
 *
 * 플랜을 교체할 때는 아래 export 문의 import 경로 한 줄만 바꾼다.
 * 소비자(PlanClient / DashboardClient / api/dashboard/orders-summary)는
 * 이 파일만 import하므로 수정할 필요가 없다.
 */
export type { WbsTask, WeekData } from './plans/types';
export { WBS_DATA, WEEKLY_TARGETS, PLAN_START } from './plans/v2-scale-1000';
