'use client';
import { useState, useEffect } from 'react';
import { WizardShell } from '@/components/listing/auto-register/WizardShell';
import { UrlInputStep } from '@/components/listing/auto-register/UrlInputStep';
import { Step1BasicInfo, type BasicInfoValue } from '@/components/listing/auto-register/steps/Step1BasicInfo';
import { Step2PriceStock, type PriceStockValue } from '@/components/listing/auto-register/steps/Step2PriceStock';
import { Step3Images, type ImagesValue } from '@/components/listing/auto-register/steps/Step3Images';
import { Step4DetailPage, type DetailPageValue } from '@/components/listing/auto-register/steps/Step4DetailPage';
import { Step5Delivery, type DeliveryValue } from '@/components/listing/auto-register/steps/Step5Delivery';
import { Step6Keywords, type KeywordsValue } from '@/components/listing/auto-register/steps/Step6Keywords';
import type {
  NormalizedProduct,
  MappedCoupangFields,
  FieldCorrection,
  AutoModeStatus,
} from '@/lib/auto-register/types';

// 위저드 전체에서 공유하는 데이터 묶음
type WizardData = {
  product: NormalizedProduct;
  mappedFields: MappedCoupangFields | null;
  basicInfo?: BasicInfoValue;
  priceStock?: PriceStockValue;
  images?: ImagesValue;
  detailPage?: DetailPageValue;
  delivery?: DeliveryValue;
  deliveryDefaults?: { outboundShippingPlaceCode: string; returnCenterCode: string };
};

export default function AutoRegisterPage() {
  // step 0: URL 입력, 1~6: 위저드 단계
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4 | 5 | 6>(0);
  const [data, setData] = useState<Partial<WizardData>>({});
  const [autoModeStatus, setAutoModeStatus] = useState<AutoModeStatus | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [registerError, setRegisterError] = useState('');
  const [registerSuccess, setRegisterSuccess] = useState(false);

  // 배송 기본값(출하지·반품센터 코드)을 서버에서 미리 로드
  useEffect(() => {
    fetch('/api/auto-register/delivery-defaults')
      .then((r) => r.json())
      .then((d: { outboundShippingPlaceCode: string; returnCenterCode: string }) => {
        setData((prev) => ({ ...prev, deliveryDefaults: d }));
      })
      .catch(() => {});
  }, []);

  // 상품이 확정되면 해당 소스의 학습 상태를 조회
  useEffect(() => {
    if (!data.product) return;
    fetch(`/api/auto-register/learning-status?sourceType=${data.product.source}`)
      .then((r) => r.json())
      .then((d: { status: AutoModeStatus }) => setAutoModeStatus(d.status))
      .catch(() => {});
  }, [data.product]);

  // URL 입력 완료 → step 1로 이동
  function handleUrlComplete(
    product: NormalizedProduct,
    fields: MappedCoupangFields | null,
  ) {
    setData((prev) => ({ ...prev, product, mappedFields: fields }));
    setStep(1);
  }

  // Step 6 완료 → 쿠팡 등록 API 호출
  async function handleFinalRegister(keywords: KeywordsValue) {
    if (
      !data.product ||
      !data.basicInfo ||
      !data.priceStock ||
      !data.images ||
      !data.detailPage ||
      !data.delivery
    )
      return;

    setIsRegistering(true);
    setRegisterError('');

    // AI 제안값과 사용자가 실제 수락한 값을 비교해 보정 이력 생성
    const corrections: FieldCorrection[] = [];
    const mf = data.mappedFields;

    if (mf) {
      const fieldMap: Record<string, string> = {
        sellerProductName: data.basicInfo.sellerProductName,
        brand: data.basicInfo.brand,
        salePrice: String(data.priceStock.salePrice),
        stockQuantity: String(data.priceStock.stockQuantity),
      };

      (Object.keys(fieldMap) as Array<keyof typeof fieldMap>).forEach((field) => {
        const mappedField = mf[field as keyof MappedCoupangFields];
        if (!mappedField) return;
        const aiVal = String(mappedField.value);
        const acceptedVal = fieldMap[field];
        corrections.push({
          sourceType: data.product!.source,
          fieldName: field as keyof MappedCoupangFields,
          aiValue: aiVal,
          acceptedValue: acceptedVal,
          wasCorrected: aiVal !== acceptedVal,
        });
      });
    }

    // 쿠팡 등록 API 호출
    const res = await fetch('/api/listing/coupang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: data.basicInfo.sellerProductName,
        salePrice: data.priceStock.salePrice,
        originalPrice: data.priceStock.originalPrice,
        stock: data.priceStock.stockQuantity,
        thumbnailImages: [data.images.thumbnailUrl, ...data.images.additionalUrls].filter(Boolean),
        detailImages: [],
        description: data.detailPage.detailHtml,
        deliveryCharge: data.delivery.deliveryCharge,
        deliveryChargeType: data.delivery.deliveryChargeType,
        returnCharge: 0,
        displayCategoryCode: data.basicInfo.displayCategoryCode,
        brand: data.basicInfo.brand,
        outboundShippingPlaceCode: data.delivery.outboundShippingPlaceCode,
        returnCenterCode: data.delivery.returnCenterCode,
        searchTags: keywords.searchTags,
      }),
    });

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      setRegisterError(errData.error ?? '등록 중 오류가 발생했습니다.');
      setIsRegistering(false);
      return;
    }

    // 보정 이력을 학습 엔진에 저장
    if (corrections.length > 0) {
      await fetch('/api/auto-register/save-corrections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ corrections }),
      }).catch(() => {});
    }

    setIsRegistering(false);
    setRegisterSuccess(true);
  }

  // 등록 성공 화면
  if (registerSuccess) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center flex flex-col gap-4">
        <div className="text-5xl">✓</div>
        <h2 className="text-xl font-semibold text-gray-900">쿠팡 등록 완료!</h2>
        <p className="text-gray-500 text-sm">쿠팡윙스에서 등록된 상품을 확인할 수 있습니다.</p>
        <button
          onClick={() => {
            setStep(0);
            setData({});
            setRegisterSuccess(false);
          }}
          className="mt-4 mx-auto px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
        >
          다른 상품 등록하기
        </button>
      </div>
    );
  }

  const mf = data.mappedFields;

  return (
    <div className="max-w-2xl mx-auto py-8 px-4">
      {/* 페이지 헤더 */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">쿠팡 자동등록</h1>
        <p className="text-sm text-gray-500 mt-1">도매꾹 · 코스트코 → 쿠팡윙스 직접 등록</p>
      </div>

      {/* AI 학습 현황 배너 */}
      {autoModeStatus && (
        <div className="mb-4 bg-blue-50 rounded-lg px-4 py-2 text-sm text-blue-700">
          학습 현황: {autoModeStatus.fieldsTrusted}/{autoModeStatus.fieldsTotal} 필드 완료
          {autoModeStatus.isAvailable && ' · 자동 모드 사용 가능'}
        </div>
      )}

      {/* Step 0: URL 입력 */}
      {step === 0 && <UrlInputStep onComplete={handleUrlComplete} />}

      {/* Step 1~6: 위저드 */}
      {step >= 1 && (
        <WizardShell currentStep={step}>
          {/* Step 1: 기본 정보 */}
          {step === 1 && (
            <Step1BasicInfo
              initialValue={{
                sellerProductName: mf?.sellerProductName.value ?? data.product?.title ?? '',
                displayCategoryCode: mf?.displayCategoryCode.value ?? 0,
                brand: mf?.brand.value ?? data.product?.brand ?? '기타',
              }}
              confidences={{
                sellerProductName: mf?.sellerProductName.confidence,
                displayCategoryCode: mf?.displayCategoryCode.confidence,
                brand: mf?.brand.confidence,
              }}
              onNext={(v) => {
                setData((d) => ({ ...d, basicInfo: v }));
                setStep(2);
              }}
              onBack={() => setStep(0)}
            />
          )}

          {/* Step 2: 가격 · 재고 */}
          {step === 2 && (
            <Step2PriceStock
              initialValue={{
                salePrice: mf?.salePrice.value ?? data.product?.price ?? 0,
                originalPrice: mf?.originalPrice.value ?? data.product?.originalPrice ?? 0,
                stockQuantity: mf?.stockQuantity.value ?? 100,
              }}
              costPrice={data.product?.price ?? 0}
              confidences={{
                salePrice: mf?.salePrice.confidence,
                stockQuantity: mf?.stockQuantity.confidence,
              }}
              onNext={(v) => {
                setData((d) => ({ ...d, priceStock: v }));
                setStep(3);
              }}
              onBack={() => setStep(1)}
            />
          )}

          {/* Step 3: 이미지 */}
          {step === 3 && (
            <Step3Images
              initialValue={{
                thumbnailUrl: data.product?.imageUrls[0] ?? '',
                additionalUrls: data.product?.imageUrls.slice(1) ?? [],
              }}
              onNext={(v) => {
                setData((d) => ({ ...d, images: v }));
                setStep(4);
              }}
              onBack={() => setStep(2)}
            />
          )}

          {/* Step 4: 상세페이지 — detailHtml 필드명 확인 완료 */}
          {step === 4 && (
            <Step4DetailPage
              initialValue={{
                detailHtml: data.product?.detailHtml ?? data.product?.description ?? '',
              }}
              onNext={(v) => {
                setData((d) => ({ ...d, detailPage: v }));
                setStep(5);
              }}
              onBack={() => setStep(3)}
            />
          )}

          {/* Step 5: 배송 · 반품 */}
          {step === 5 && (
            <Step5Delivery
              initialValue={{
                deliveryMethod: 'SEQUENCIAL',
                deliveryChargeType:
                  (mf?.deliveryChargeType.value ?? 'FREE') as 'FREE' | 'NOT_FREE',
                deliveryCharge: mf?.deliveryCharge.value ?? 0,
                outboundShippingPlaceCode:
                  data.deliveryDefaults?.outboundShippingPlaceCode ?? '',
                returnCenterCode: data.deliveryDefaults?.returnCenterCode ?? '',
              }}
              onNext={(v) => {
                setData((d) => ({ ...d, delivery: v }));
                setStep(6);
              }}
              onBack={() => setStep(4)}
            />
          )}

          {/* Step 6: 검색 태그 · 최종 등록 */}
          {step === 6 && data.basicInfo && data.priceStock && data.images && (
            <Step6Keywords
              initialValue={{ searchTags: mf?.searchTags.value ?? [] }}
              summary={{
                sellerProductName: data.basicInfo.sellerProductName,
                displayCategoryCode: data.basicInfo.displayCategoryCode,
                brand: data.basicInfo.brand,
                salePrice: data.priceStock.salePrice,
                stockQuantity: data.priceStock.stockQuantity,
                thumbnailUrl: data.images.thumbnailUrl,
                deliveryChargeType: data.delivery?.deliveryChargeType ?? 'FREE',
              }}
              isRegistering={isRegistering}
              registerError={registerError}
              onNext={handleFinalRegister}
              onBack={() => setStep(5)}
            />
          )}
        </WizardShell>
      )}
    </div>
  );
}
