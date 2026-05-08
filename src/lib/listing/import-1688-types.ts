export type ImageClassificationType =
  | 'main_product'
  | 'lifestyle'
  | 'infographic'
  | 'size_chart';

export type TranslationStatus = 'ok' | 'no_text' | 'failed' | 'skipped';

export interface ClassifiedImage {
  url: string;
  type: ImageClassificationType;
}

/** 번역 단계를 거친 이미지. translatedUrl이 null이면 원본만 사용 */
export interface TranslatedImage extends ClassifiedImage {
  translatedUrl: string | null;
  translationStatus: TranslationStatus;
}

export interface ClassifyResponse {
  images: ClassifiedImage[];
}

export interface TranslateImagesRequest {
  images: ClassifiedImage[];
}

export interface TranslateImagesResponse {
  images: TranslatedImage[];
}

export interface GenerateResponse {
  thumbnailUrl: string;
  detailPageHtml: string;
}
