# evaluation — 빅스비 실발화 평가 (AIPO)

빅스비 실발화를 언어별 배치로 받아 **이벤트 기반 AI 파이프라인**(GCS → Eventarc/PubSub → Cloud Run Ingress →
Firestore 레지스트리·대기열 → 언어별 스케줄러 → Cloud Workflows → Vertex AI Pipeline)으로 평가하고,
발화별 PASS/FAIL 결과를 GCS CSV와 BigQuery에 남기는 AIPO 플랫폼 작업 공간입니다. 실패는 Retry → DLQ → 수동 Replay로 복구됩니다.

| 경로 | 내용 |
| --- | --- |
| [`designs/`](./designs/) | 승인된 운영 대시보드 디자인 프로토타입 3종(단일 HTML): `a-flowline.html`, `b-atlas.html`, `c-lanes.html`과 공유 Mock 데이터·시뮬레이터 `mock-data.js` |
| [`applications/operations-web/`](./applications/operations-web/) | 세 디자인을 Next.js + TypeScript + Tailwind + ECharts로 구현한 **실동작 운영 콘솔 데모**. 내장 Mock API·SSE로 동작하며 GCP가 필요 없습니다. |

## 빠르게 실행하기

```bash
cd applications/operations-web
npm i
npm run dev        # http://localhost:3000 → Flowline / Atlas / Lanes 선택
```

자세한 내용(콘셉트별 라우트·폰트, Mock API, 실제 Operations API 전환 방법, 제한 사항)은
[applications/operations-web/README.md](./applications/operations-web/README.md)를 참고하세요.

> 이 저장소는 공개 저장소입니다. 모든 데이터는 결정적으로 생성된 Mock이며 비밀 값이나 실제 내부 데이터는 포함하지 않습니다.
