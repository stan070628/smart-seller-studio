-- 템플릿 버전 이력 테이블
-- 레퍼런스 학습 기능으로 적용된 템플릿 변경 이력을 저장합니다.
CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  reference_source TEXT NOT NULL,       -- 분석에 사용된 레퍼런스 URL 또는 업로드 파일명
  frame_type TEXT NOT NULL,             -- 대상 프레임 타입 (hero, pain_point 등)
  version_number INTEGER NOT NULL,      -- 동일 frame_type 내 순번 (1부터 자동 증가)
  previous_code TEXT NOT NULL,          -- 적용 전 원본 파일 코드 (롤백용)
  applied_code TEXT NOT NULL,           -- 실제 파일에 저장된 코드
  change_summary TEXT,                  -- 변경 사항 요약 (한국어)
  is_current BOOLEAN DEFAULT false      -- 현재 적용 중인 버전 여부 (최신 1건만 true)
);

-- frame_type별 최신 버전 조회를 위한 인덱스
CREATE INDEX IF NOT EXISTS idx_template_versions_frame_type
  ON template_versions(frame_type, created_at DESC);
