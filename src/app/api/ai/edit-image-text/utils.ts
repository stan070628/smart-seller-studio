/**
 * edit-image-text 라우트에서 사용하는 Zod 스키마 모음.
 * Next.js 16 Route 파일은 HTTP 핸들러와 Route Segment Config만 export할 수 있으므로
 * 테스트 대상 스키마는 이 파일에서 export하고 route.ts에서 import한다.
 */

import { z } from 'zod';

export const RequestSchema = z.object({
  imageUrl: z.string().min(1, 'imageUrl은 비어있을 수 없습니다.'),
  instruction: z
    .string()
    .min(1, 'instruction은 비어있을 수 없습니다.')
    .max(500, 'instruction은 500자 이내여야 합니다.'),
  productName: z.string().max(200).optional(),
});
