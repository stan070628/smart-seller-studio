/**
 * 관리자 레퍼런스 학습 기능 관련 타입 정의
 *
 * - 레퍼런스 이미지 분석 요청/응답
 * - 템플릿 코드 반영 요청/응답
 * - 버전 이력 조회
 */

import type { FrameType } from '@/types/frames';

// ─────────────────────────────────────────
// 분석 요청
// ─────────────────────────────────────────

/** POST /api/admin/analyze-reference 요청 바디 */
export interface AnalyzeReferenceRequest {
  /** URL 방식: 공개 접근 가능한 레퍼런스 이미지 URL */
  referenceImageUrl?: string;
  /** 파일 업로드 방식: data URL 또는 raw base64 문자열 */
  referenceImageBase64?: string;
  /** 파일 업로드 방식에서 필수: 이미지 MIME 타입 (image/jpeg 등) */
  referenceImageMimeType?: string;
  /** 화면 표시용 소스 레이블 (URL 문자열 또는 업로드된 파일명) */
  referenceSource: string;
  /** 스타일을 반영할 대상 템플릿 타입 목록 (13개 메인 프레임만, custom_* 제외) */
  targetTemplates: FrameType[];
}

// ─────────────────────────────────────────
// 단일 템플릿 분석 결과
// ─────────────────────────────────────────

/** Claude가 단일 프레임 템플릿에 대해 제안한 코드 변경안 */
export interface TemplateProposal {
  /** 대상 프레임 타입 */
  frameType: FrameType;
  /** 수정 대상 파일명 (예: HeroTemplate.tsx) */
  templateFileName: string;
  /** 현재 파일 코드 전문 */
  currentCode: string;
  /** 레퍼런스 스타일을 반영한 제안 코드 전문 */
  proposedCode: string;
  /** 변경 사항 요약 (한국어) */
  changeSummary: string;
  /** 주요 변경 라인 범위 및 설명 */
  diffHighlights: { lineRange: string; description: string }[];
}

// ─────────────────────────────────────────
// 분석 API 응답
// ─────────────────────────────────────────

/** POST /api/admin/analyze-reference 성공 응답 */
export interface AnalyzeReferenceResponse {
  success: true;
  data: {
    /** 레퍼런스 이미지 전체 분석 결과 */
    referenceAnalysis: {
      /** 레이아웃 구성 방식 설명 */
      layoutStyle: string;
      /** 주요 색상 팔레트 (HEX 배열) */
      colorPalette: string[];
      /** 타이포그래피 특징 메모 */
      typographyNotes: string;
      /** 구도 및 시각적 구성 메모 */
      compositionNotes: string;
    };
    /** 각 템플릿별 제안 코드 변경안 목록 */
    templateProposals: TemplateProposal[];
  };
}

// ─────────────────────────────────────────
// 반영 요청
// ─────────────────────────────────────────

/** POST /api/admin/apply-template 요청 바디 */
export interface ApplyTemplateRequest {
  /** 버전 이력 저장 시 기록할 레퍼런스 소스 레이블 */
  referenceSource: string;
  /** 실제 파일에 반영할 승인 목록 */
  approvals: {
    frameType: FrameType;
    /** 수정 대상 파일명 (예: HeroTemplate.tsx) */
    templateFileName: string;
    /** 파일에 덮어쓸 제안 코드 전문 */
    proposedCode: string;
    /** 변경 사항 요약 (Supabase 이력 저장용) */
    changeSummary?: string;
  }[];
}

// ─────────────────────────────────────────
// 반영 API 응답
// ─────────────────────────────────────────

/** POST /api/admin/apply-template 성공 응답 */
export interface ApplyTemplateResponse {
  success: true;
  /** 각 템플릿별 반영 결과 */
  results: {
    frameType: FrameType;
    /** 반영 성공 여부 */
    status: 'applied' | 'failed';
    /** 원본 파일 백업 경로 (성공 시에만 존재) */
    backupPath?: string;
    /** 실패 시 오류 메시지 */
    error?: string;
  }[];
}

// ─────────────────────────────────────────
// 버전 이력
// ─────────────────────────────────────────

/** GET /api/admin/versions 응답의 단일 이력 아이템 */
export interface TemplateVersionRecord {
  /** UUID */
  id: string;
  /** 생성 시각 (ISO 8601) */
  createdAt: string;
  /** 분석에 사용된 레퍼런스 소스 레이블 */
  referenceSource: string;
  /** 대상 프레임 타입 */
  frameType: FrameType;
  /** 동일 frame_type 내 순번 (1부터) */
  versionNumber: number;
  /** 변경 사항 요약 (한국어, 없으면 null) */
  changeSummary: string | null;
  /** 현재 적용 중인 버전 여부 */
  isCurrent: boolean;
}
