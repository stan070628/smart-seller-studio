import { describe, it, expect } from 'vitest';
import { z } from 'zod';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
const ImageItemSchema = z.object({
  imageBase64: z.string().min(1),
  mimeType: z.enum(ALLOWED_MIME_TYPES),
});
const RequestSchema = z.object({
  images: z.array(ImageItemSchema).min(1).max(5).optional(),
  imageUrls: z.array(z.string().url()).max(5).optional(),
  productName: z.string().max(100).optional(),
  price: z.number().int().positive().optional(),
}).refine(
  (d) => (d.images && d.images.length > 0) || (d.imageUrls && d.imageUrls.length > 0),
  { message: 'images 또는 imageUrls 중 하나는 필수입니다.' },
);

describe('generate-detail-html RequestSchema (imageUrls 추가)', () => {
  it('imageUrls만 있어도 통과한다', () => {
    const result = RequestSchema.safeParse({
      imageUrls: ['https://example.com/img.jpg'],
    });
    expect(result.success).toBe(true);
  });

  it('images만 있어도 통과한다', () => {
    const result = RequestSchema.safeParse({
      images: [{ imageBase64: 'abc123', mimeType: 'image/jpeg' }],
    });
    expect(result.success).toBe(true);
  });

  it('images, imageUrls 둘 다 없으면 실패한다', () => {
    const result = RequestSchema.safeParse({ productName: '상품명' });
    expect(result.success).toBe(false);
  });

  it('imageUrls는 최대 5개', () => {
    const urls = Array(6).fill('https://example.com/img.jpg');
    const result = RequestSchema.safeParse({ imageUrls: urls });
    expect(result.success).toBe(false);
  });

  it('imageUrls 항목은 유효한 URL이어야 한다', () => {
    const result = RequestSchema.safeParse({ imageUrls: ['not-a-url'] });
    expect(result.success).toBe(false);
  });
});
