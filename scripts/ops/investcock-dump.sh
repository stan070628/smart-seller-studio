#!/usr/bin/env bash
# scripts/ops/investcock-dump.sh — 투자콕 50개 테이블을 스키마+데이터로 덤프한다.
# 사용법: bash scripts/ops/investcock-dump.sh   → 경로를 출력한다
set -euo pipefail
umask 077  # 덤프에 토큰·비밀번호 해시가 평문으로 들어간다
cd "$(dirname "$0")/../.."
DB_URL=$(grep -E '^SUPABASE_DB_URL=' .env.local | cut -d= -f2- | sed -E "s/^[\"']|[\"']$//g" || true)
[ -n "$DB_URL" ] || { echo "SUPABASE_DB_URL 없음" >&2; exit 1; }
[ -d /Volumes/Mac_SSD ] || { echo "외장 SSD(/Volumes/Mac_SSD)가 없다" >&2; exit 1; }
OUT_DIR=/Volumes/Mac_SSD/backup/investcock
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/investcock-$(date +%Y%m%d-%H%M).sql"
ARGS=()
while read -r t; do [ -n "$t" ] && ARGS+=(-t "public.$t"); done < scripts/ops/investcock-tables.txt
[ "${#ARGS[@]}" -eq 100 ] || { echo "테이블 목록이 50개가 아니다" >&2; exit 1; }
pg_dump "$DB_URL" --no-owner --no-privileges --no-publications --no-subscriptions --no-statistics "${ARGS[@]}" -f "$OUT"
echo "$OUT ($(du -h "$OUT" | cut -f1))"
