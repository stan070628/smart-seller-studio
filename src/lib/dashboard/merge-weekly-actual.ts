/**
 * Wing 주차별 + RG 누적 매출 합산 순수 함수.
 *
 * Wing API 실패(null)여도 RG 기여값을 보존한다.
 * 미래 주차(w > currentWeek)는 null 반환.
 */
export function mergeWeeklyActual(
  wingWeekly: (number | null)[],
  rgWeeklyRaw: (number | null)[],
  currentWeek: number,
): (number | null)[] {
  let rgAcc = 0;
  return wingWeekly.map((wingVal, i) => {
    rgAcc += rgWeeklyRaw[i] ?? 0;
    const w = i + 1;
    if (w > currentWeek) return null;
    return (wingVal ?? 0) + rgAcc;
  });
}
