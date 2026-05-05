import { Suspense } from 'react';
import type { Metadata } from 'next';
import LabelEditor from '@/components/label/LabelEditor';

export const metadata: Metadata = {
  title: '라벨 인쇄 | SmartSellerStudio',
  description: '소분 판매용 A4 라벨지를 편집하고 인쇄합니다.',
};

export default function LabelPage() {
  return (
    <Suspense>
      <LabelEditor />
    </Suspense>
  );
}
