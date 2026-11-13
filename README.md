# evaluation — 빅스비 실발화 평가 (AIPO)

빅스비 실발화를 언어별 배치로 받아 **이벤트 기반 AI 파이프라인**(GCS → Eventarc/Pub/Sub → Cloud Run Ingress →
Firestore 레지스트리·대기열 → 언어별 Scheduler → Cloud Workflows → Vertex AI Pipeline)으로 평가하고,
발화별 PASS/FAIL 결과를 GCS CSV와 BigQuery에 남기는 AIPO 플랫폼 작업 공간입니다. 실패는 Retry → DLQ → 수동 Replay로 복구됩니다.

| 경로 | 내용 |
| --- | --- |
| [`plan.md`](./plan.md) | 아키텍처·운영 계획서 (콘솔 화면과 API의 근거) |
| [`applications/operations-web/`](./applications/operations-web/) | **AIPO Operations Console (Atlas)**: Next.js 16 기반의 단일 운영 콘솔. 내장 Mock API·SSE로 GCP 없이 동작하며, 실제 Operations API와 IAP 인증으로 전환할 수 있습니다. KO/EN 지원 |
| [`designs/`](./designs/) | 과거 디자인 프로토타입(단일 HTML): `a-flowline.html`, `b-atlas.html`, `c-lanes.html`과 공유 Mock 데이터 `mock-data.js`. 콘솔은 이 중 **Atlas**로 확정되었으며, 이 폴더는 참고용 기록입니다 |

세 디자인 후보(Flowline · Atlas · Lanes)를 모두 Next.js로 구현했던 시점은 git 태그 **`design-candidates-v1`**에 보존되어 있습니다
(`git checkout design-candidates-v1`).

## 빠르게 실행하기

```bash
cd applications/operations-web
npm i
npm run dev        # http://localhost:3000 → /login 에서 데모 사용자 선택
```

데모 사용자와 역할, 화면 목록, 설정, 인증 모드, Docker/Cloud Run 배포, 알려진 제한 사항은
[applications/operations-web/README.md](./applications/operations-web/README.md)를 참고하세요.
구조와 개발 가이드는 [docs/architecture.md](./applications/operations-web/docs/architecture.md)에 있습니다.

> 이 저장소는 공개 저장소입니다. 모든 데이터는 결정적으로 생성된 Mock이며 비밀 값이나 실제 내부 데이터는 포함하지 않습니다.
