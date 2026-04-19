import { redirect } from 'next/navigation';

/**
 * /detail 페이지
 * 상세페이지 생성 기능이 /listing Step Wizard로 통합되었습니다.
 * /listing?step=2 로 리다이렉트합니다.
 */
export default function DetailPage() {
  redirect('/listing?step=2');
}
