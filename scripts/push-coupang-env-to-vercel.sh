#!/usr/bin/env bash
# .env.local 의 쿠팡 반품지 ENV 6개를 Vercel production 에 푸시.
# 기존 값이 있으면 삭제 후 재등록(덮어쓰기)한다.
#
# 사전 조건:
#   1. Vercel CLI 설치 (npm i -g vercel) 또는 npx 사용 가능
#   2. vercel login 완료
#   3. .vercel/project.json 존재 (이미 링크됨)
#
# 사용:
#   bash scripts/push-coupang-env-to-vercel.sh

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.local}"
TARGET_ENV="${TARGET_ENV:-production}"

KEYS=(
  COUPANG_RETURN_NAME
  COUPANG_CONTACT_NUMBER
  COUPANG_RETURN_ZIPCODE
  COUPANG_RETURN_ADDRESS
  COUPANG_RETURN_ADDRESS_DETAIL
  COUPANG_VENDOR_USER_ID
)

VERCEL_CMD="vercel"
if ! command -v vercel >/dev/null 2>&1; then
  echo "[info] vercel CLI 미설치 — npx 로 실행합니다."
  VERCEL_CMD="npx -y vercel@latest"
fi

if ! $VERCEL_CMD whoami >/dev/null 2>&1; then
  echo "[ERROR] Vercel 로그인 필요. 먼저 실행: $VERCEL_CMD login" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "[ERROR] $ENV_FILE 파일이 없습니다." >&2
  exit 1
fi

echo "[info] 대상 환경: $TARGET_ENV"
echo "[info] 소스 파일: $ENV_FILE"
echo

for KEY in "${KEYS[@]}"; do
  RAW=$(grep -E "^${KEY}=" "$ENV_FILE" | head -1 || true)
  if [ -z "$RAW" ]; then
    echo "[SKIP] $KEY — $ENV_FILE 에 정의 없음"
    continue
  fi

  VALUE="${RAW#${KEY}=}"
  # 양쪽 따옴표 제거 (있을 경우)
  VALUE="${VALUE%\"}"; VALUE="${VALUE#\"}"
  VALUE="${VALUE%\'}"; VALUE="${VALUE#\'}"

  if [ -z "$VALUE" ]; then
    echo "[SKIP] $KEY — 빈 값"
    continue
  fi

  printf "[PUSH] %s ← (length=%d)\n" "$KEY" "${#VALUE}"

  # 기존 값 삭제 (없어도 무시)
  $VERCEL_CMD env rm "$KEY" "$TARGET_ENV" -y >/dev/null 2>&1 || true

  # 신규 등록 — stdin 으로 값 전달
  printf '%s' "$VALUE" | $VERCEL_CMD env add "$KEY" "$TARGET_ENV" >/dev/null
done

echo
echo "[done] 푸시 완료. 재배포 명령:"
echo "  $VERCEL_CMD --prod"
