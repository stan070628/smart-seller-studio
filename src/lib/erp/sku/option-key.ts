/**
 * 쿠팡 옵션(item)에서 「실물 옵션」과 「수량」을 가른다.
 *
 * 다슈 1개/2개/3개, 퓨어틴 6팩/12팩처럼 수량만 다른 옵션은 재고가 같은 물건이라 SKU 하나로 묶고
 * 리스팅에 배수를 둔다. 반면 `2개입`·`750ml`·`45g`은 물건 자체의 내용이라 옵션에 남긴다.
 */
export interface ItemAttribute {
  attributeTypeName: string;
  attributeValueName: string;
}

export interface OptionKey {
  option: string;
  quantity: number;
}

const QTY_ATTR = /수량/;
// `N개`(뒤에 `입`이 없는 것)·`N팩` 토큰. 여러 개면 마지막 것이 수량이다 — `1개 2개입`은 1개가 수량, 2개입은 내용물
const QTY_TOKEN = /(^|\s)(\d+)\s*(개(?!입)|팩)(?=\s|$)/g;

const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();
/** 수량을 떼고 남은 구분자(`/`·`,`·`·`)를 양끝에서 걷어낸다 — `네이비 / L / 1개` → `네이비 / L` */
const trimSep = (s: string) => tidy(s).replace(/^[\s/,·]+|(\s+[xX×*+])?[\s/,·]*$/g, '');
const firstInt = (s: string) => {
  const m = s.match(/\d+/);
  return m ? Number(m[0]) : 1;
};

export function optionKeyOf(item: { itemName: string; attributes?: ItemAttribute[] }): OptionKey {
  const attrs = item.attributes ?? [];
  const qtyAttr = attrs.find((a) => a.attributeTypeName.trim() === '수량') ?? attrs.find((a) => QTY_ATTR.test(a.attributeTypeName));
  if (qtyAttr) {
    const option = attrs
      .filter((a) => a !== qtyAttr)
      .map((a) => tidy(a.attributeValueName))
      .filter(Boolean)
      .join(' / ');
    return { option, quantity: firstInt(qtyAttr.attributeValueName) };
  }

  const name = tidy(item.itemName ?? '');
  const tokens = [...name.matchAll(QTY_TOKEN)];
  const last = tokens.at(-1);
  if (!last) return { option: name, quantity: 1 };
  const start = last.index! + last[1].length;
  const option = trimSep(name.slice(0, start) + name.slice(start + last[0].length - last[1].length));
  return { option, quantity: Number(last[2]) };
}
