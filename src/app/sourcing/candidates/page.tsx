import CandidatesWorkspace from '@/components/sourcing/candidates/CandidatesWorkspace';

export const metadata = {
  title: '소싱 후보 수집',
  description: '네이버 쇼핑 캡처와 1688 캡처로 소싱 후보 20개를 고릅니다.',
};

export default function SourcingCandidatesPage() {
  return <CandidatesWorkspace />;
}
