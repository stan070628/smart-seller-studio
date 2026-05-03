export type ImageClassificationType =
  | 'main_product'
  | 'lifestyle'
  | 'infographic'
  | 'size_chart';

export interface ClassifiedImage {
  url: string;
  type: ImageClassificationType;
}

export interface ClassifyResponse {
  images: ClassifiedImage[];
}

export interface GenerateRequest {
  images: ClassifiedImage[];
  thumbnailUrl: string;
  sessionId: string;
}

export interface GenerateResponse {
  thumbnailUrl: string;
  detailPageHtml: string;
}
