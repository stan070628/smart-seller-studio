/**
 * useIntersectionObserver
 * 특정 DOM 요소가 뷰포트에 진입했을 때 콜백을 호출하는 훅
 * 무한스크롤 트리거에 활용
 */
import { useEffect, type RefObject } from 'react';

interface Options {
  rootMargin?: string;
  threshold?: number;
  onIntersect: () => void;
  /** false이면 observer 등록하지 않음 */
  enabled?: boolean;
}

export function useIntersectionObserver(
  ref: RefObject<Element | null>,
  { rootMargin = '0px', threshold = 0, onIntersect, enabled = true }: Options,
): void {
  useEffect(() => {
    // enabled가 false이거나 ref가 null이면 아무것도 안 함
    if (!enabled || !ref.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          onIntersect();
        }
      },
      { rootMargin, threshold },
    );

    observer.observe(ref.current);

    // cleanup: observer 해제
    return () => {
      observer.disconnect();
    };
  }, [ref, rootMargin, threshold, onIntersect, enabled]);
}
