/**
 * 영수증 초안 상세 — 검토 후 확정
 */
import ReceiptDetail from '@/components/receipt/ReceiptDetail';

export default async function ReceiptDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReceiptDetail draftId={id} />;
}
