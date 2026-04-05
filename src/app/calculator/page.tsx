import CalculatorClient from '@/components/calculator/CalculatorClient';

export const metadata = {
  title: '마진 계산기 — Smart Seller Studio',
  description: '플랫폼별 수수료 자동 계산으로 순이익과 마진율을 확인하세요',
};

export default function CalculatorPage() {
  return <CalculatorClient />;
}
