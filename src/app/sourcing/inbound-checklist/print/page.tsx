import InboundChecklistDoc from '@/components/sourcing/InboundChecklistDoc';

export const metadata = {
  title: '1688 입고 체크리스트 (인쇄)',
};

export default function InboundChecklistPrintPage() {
  return (
    <main className="bg-gray-50 py-8 print:bg-white print:py-0">
      <InboundChecklistDoc />
    </main>
  );
}
