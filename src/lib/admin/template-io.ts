/**
 * template-io.ts
 *
 * 템플릿 파일 읽기/쓰기 유틸리티
 *
 * - 화이트리스트 기반 접근 제어: 13개 메인 프레임만 허용 (custom_* 제외)
 * - path traversal 방지: path.resolve 결과가 허용 디렉터리 내부인지 검증
 * - 쓰기 전 .backups/ 디렉터리에 원본 자동 백업
 */

import fs from 'fs/promises';
import path from 'path';
import type { FrameType } from '@/types/frames';

// ─────────────────────────────────────────
// 상수 정의
// ─────────────────────────────────────────

/** 템플릿 파일이 위치한 절대 경로 */
const TEMPLATES_DIR = path.resolve(
  process.cwd(),
  'src/components/templates'
);

/** 백업 파일이 저장될 절대 경로 */
const BACKUPS_DIR = path.resolve(
  process.cwd(),
  'src/components/templates/.backups'
);

// ─────────────────────────────────────────
// 화이트리스트: 13개 메인 프레임 → 파일명 매핑
// custom_* 타입은 의도적으로 제외
// ─────────────────────────────────────────

const FRAME_FILE_MAP: Partial<Record<FrameType, string>> = {
  hero:         'HeroTemplate.tsx',
  pain_point:   'PainPointTemplate.tsx',
  solution:     'SolutionTemplate.tsx',
  usp:          'UspTemplate.tsx',
  detail_1:     'Detail1Template.tsx',
  detail_2:     'Detail2Template.tsx',
  how_to_use:   'HowToUseTemplate.tsx',
  before_after: 'BeforeAfterTemplate.tsx',
  target:       'TargetTemplate.tsx',
  spec:         'SpecTemplate.tsx',
  faq:          'FaqTemplate.tsx',
  social_proof: 'SocialProofTemplate.tsx',
  cta:          'CtaTemplate.tsx',
} as const;

// ─────────────────────────────────────────
// 내부 헬퍼
// ─────────────────────────────────────────

/**
 * frameType이 화이트리스트에 등록되어 있는지 확인합니다.
 * custom_* 등 미등록 타입은 여기서 차단됩니다.
 */
function assertWhitelisted(frameType: FrameType): string {
  const fileName = FRAME_FILE_MAP[frameType];
  if (!fileName) {
    throw new Error(
      `[template-io] 허용되지 않은 프레임 타입: "${frameType}". ` +
      '13개 메인 프레임(custom_* 제외)만 수정할 수 있습니다.'
    );
  }
  return fileName;
}

/**
 * 파일 경로가 허용된 디렉터리(TEMPLATES_DIR) 내부에 있는지 검증합니다.
 * path traversal 공격 방지용입니다.
 */
function assertSafePath(resolvedPath: string): void {
  if (!resolvedPath.startsWith(TEMPLATES_DIR + path.sep) &&
      resolvedPath !== TEMPLATES_DIR) {
    throw new Error(
      `[template-io] 경로 탐색 공격이 감지되었습니다: "${resolvedPath}"`
    );
  }
}

// ─────────────────────────────────────────
// 공개 유틸리티
// ─────────────────────────────────────────

/**
 * frameType에 해당하는 템플릿 파일의 절대 경로를 반환합니다.
 *
 * @throws frameType이 화이트리스트에 없으면 Error
 */
export function getTemplatePath(frameType: FrameType): string {
  const fileName = assertWhitelisted(frameType);
  const resolved = path.resolve(TEMPLATES_DIR, fileName);
  assertSafePath(resolved);
  return resolved;
}

/**
 * frameType에 해당하는 템플릿 파일의 소스코드를 읽어 반환합니다.
 *
 * @param frameType - 읽을 프레임 타입 (화이트리스트 검증 후 진행)
 * @returns 파일 내용 문자열 (UTF-8)
 * @throws 화이트리스트 미등록, 경로 탐색 감지, 파일 읽기 실패 시 Error
 */
export async function readTemplateFile(frameType: FrameType): Promise<string> {
  const filePath = getTemplatePath(frameType);

  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch (err) {
    throw new Error(
      `[template-io] 파일 읽기 실패 (${filePath}): ` +
      (err instanceof Error ? err.message : String(err))
    );
  }
}

/**
 * frameType에 해당하는 템플릿 파일을 새 코드로 덮어씁니다.
 *
 * 처리 순서:
 * 1. 화이트리스트 + path.resolve 검증
 * 2. .backups/ 폴더 생성 (없으면)
 * 3. 원본 파일을 {FileName}.backup.{timestamp}.tsx 로 백업
 * 4. 새 코드를 파일에 저장
 * 5. 백업 파일의 절대 경로 반환
 *
 * @param frameType  - 수정할 프레임 타입
 * @param code       - 파일에 쓸 새 소스코드
 * @returns 생성된 백업 파일의 절대 경로
 * @throws 화이트리스트 미등록, 경로 탐색 감지, 파일 I/O 실패 시 Error
 */
export async function writeTemplateFile(
  frameType: FrameType,
  code: string
): Promise<string> {
  // 1단계: 화이트리스트 + 경로 검증
  const fileName = assertWhitelisted(frameType);
  const filePath  = path.resolve(TEMPLATES_DIR, fileName);
  assertSafePath(filePath);

  // 2단계: 백업 디렉터리 생성
  await fs.mkdir(BACKUPS_DIR, { recursive: true });

  // 3단계: 원본 백업
  //   파일명 형식: HeroTemplate.backup.1712345678901.tsx
  const baseName   = path.basename(fileName, '.tsx'); // 확장자 제거
  const timestamp  = Date.now();
  const backupName = `${baseName}.backup.${timestamp}.tsx`;
  const backupPath = path.resolve(BACKUPS_DIR, backupName);

  try {
    const originalCode = await fs.readFile(filePath, 'utf-8');
    await fs.writeFile(backupPath, originalCode, 'utf-8');
  } catch (err) {
    throw new Error(
      `[template-io] 백업 생성 실패 (${backupPath}): ` +
      (err instanceof Error ? err.message : String(err))
    );
  }

  // 4단계: 새 코드 저장
  try {
    await fs.writeFile(filePath, code, 'utf-8');
  } catch (err) {
    throw new Error(
      `[template-io] 파일 쓰기 실패 (${filePath}): ` +
      (err instanceof Error ? err.message : String(err))
    );
  }

  return backupPath;
}
