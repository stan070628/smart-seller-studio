import MarginCalc from './components/MarginCalc'

export default function App() {
  return (
    <main className="container mx-auto px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">1688 사입 마진 계산기</h1>
      <p className="mb-6 text-sm text-gray-600">
        1688 박스 위안가에 환율·관세·국제배송·쿠팡 그로스 운영비까지 모두 반영한
        실 마진을 계산합니다. 도매꾹 위탁 마진과 비교하여 사입 전환 권장 여부를 판단합니다.
      </p>
      <MarginCalc />
    </main>
  )
}
