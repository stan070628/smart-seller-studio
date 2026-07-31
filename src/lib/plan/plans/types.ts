/**
 * 플랜 WBS 데이터의 공통 타입.
 * 버전별 플랜 파일(v2-scale-1000, v3-scale-2000 등)이 공유한다.
 */

export interface WbsTask {
  id: string;
  text: string;
  /** 난이도 ⭐ 1~5. 1=매우쉬움, 5=매우어려움 */
  difficulty: 1 | 2 | 3 | 4 | 5;
  steps?: string[];
  tip?: string;
  /** 채널 영상 출처 (예: "회송 1편: 포장 (2025-03-17)") */
  videoRef?: string;
  /** 예상 소요 시간 (시간 단위) */
  estimatedHours?: number;
}

export interface WeekData {
  title: string;
  goal: string;
  revenueTarget: string;
  tasks: WbsTask[];
}
