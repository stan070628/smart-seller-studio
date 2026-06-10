import type { Metadata } from 'next';
import DetailMakerClient from './DetailMakerClient';

export const metadata: Metadata = {
  title: '상품상세 자동만들기 | SmartSellerStudio',
  description: 'AI로 상품 상세페이지를 1분 만에 자동 생성',
};

export default function DetailMakerPage() {
  return <DetailMakerClient />;
}
