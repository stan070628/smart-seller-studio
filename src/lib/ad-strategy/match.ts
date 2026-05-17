import type { RawProduct } from './types';

/**
 * adProducts 목록에서 상품명으로 매칭되는 항목을 반환한다.
 * 우선순위: 완전 일치 → 10자 prefix 포함 매칭
 */
export function matchAdProduct(adProducts: RawProduct[], name: string): RawProduct | undefined {
  const namePrefix = name.slice(0, 10);
  return (
    adProducts.find((ap) => ap.name === name) ??
    adProducts.find(
      (ap) =>
        ap.name.includes(namePrefix) ||
        name.includes(ap.name.slice(0, 10)),
    )
  );
}
