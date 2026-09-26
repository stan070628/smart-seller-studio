import { redirect } from 'next/navigation';

/** 사이드바 「재고·매입」(부모 링크) → 재고현황 */
export default function ErpIndexPage() {
  redirect('/erp/stock');
}
