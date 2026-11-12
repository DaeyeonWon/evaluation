# AIPO Operations Web — 빅스비 실발화 평가 운영 콘솔 데모

빅스비 실발화 평가 파이프라인(AIPO)을 관제하는 **운영 콘솔의 실동작 데모**입니다.
언어별로 묶인 실발화 배치가 GCS에 올라오면 Eventarc/PubSub → Cloud Run Ingress → Firestore 레지스트리·대기열 →
언어별 스케줄러(ko 10 / en 25 / ja 5 / es 4, Global 36) → Cloud Workflows(재시도 최대 2회, backoff 60s/300s) →
Vertex AI Pipeline(preprocess → intent_eval ‖ response_eval ‖ latency_check → aggregate → persist) →
발화별 PASS/FAIL 결과 CSV(GCS)·BigQuery로 흐르고, 실패는 Retry → DLQ → 수동 Replay로 복구됩니다.

이 앱은 그 흐름을 **세 가지 디자인 콘셉트**로 구현했으며, 모든 화면은 앱에 내장된 **Mock Operations API(`/api/v1/*`)와
서버 시뮬레이터**의 데이터로 실제로 동작합니다. GCP 호출·비밀 값·실제 내부 데이터는 전혀 없습니다.

- 스택: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · ECharts 6 · SVG(DAG/플로우) · motion · d3-zoom
- 디자인 원본(승인된 프로토타입): [`../../designs/`](../../designs/) — `a-flowline.html`, `b-atlas.html`, `c-lanes.html`, `mock-data.js`
- 개발자용 상세 문서(API 레퍼런스·클라이언트 훅·공용 컴포넌트·Gotchas): **[FOUNDATION.md](./FOUNDATION.md)**

---

## 1. 세 가지 콘셉트

`/`(랜딩)에서 실시간 미니 프리뷰와 함께 세 콘셉트를 고를 수 있습니다. 세 콘셉트는 같은 Mock API와 같은 시뮬레이터 상태를 공유합니다.

| 콘셉트 | 진입 경로 | 성격 | 폰트 (전부 self-host, `next/font`) |
| --- | --- | --- | --- |
| **A · Flowline** | `/flowline` | 미션 컨트롤 파이프라인 레일. GCS 입력→결과 CSV까지 한 줄 레일 위로 배치 토큰이 흐르고, 단계 클릭 → 슬라이드 인스펙터 | **Pretendard Variable** + **JetBrains Mono** |
| **B · Atlas** | `/atlas` | 아키텍처 도면(블루프린트) 위의 실시간 관제. 줌/팬 캔버스, ADR·계획서 조항 주석 | **SUIT Variable** + **IBM Plex Mono** |
| **C · Lanes** | `/lanes` | 언어 레인 × 상태 머신 매트릭스 보드, Time river 타임라인, 에디토리얼 타이포그래피 | **Wanted Sans Variable**(디스플레이) + **Pretendard Variable** + **Fira Code** |

### 콘셉트별 라우트

| 화면 | Flowline | Atlas | Lanes |
| --- | --- | --- | --- |
| 오케스트레이션(홈) | `/flowline` | `/atlas` | `/lanes` (보드) |
| 개요(KPI·차트) | `/flowline/overview` | `/atlas/overview` | `/lanes/overview` |
| Capacity 관리 | `/flowline/capacity` | `/atlas/capacity` | `/lanes/capacity` |
| Workflow 탐색 | `/flowline/explorer` | `/atlas/explorer` | `/lanes/explorer` |
| Pipeline 상세 진입 | `/flowline/workflows` | `/atlas/workflows` | (보드·탐색에서 진입) |
| Pipeline 상세 | `/flowline/workflows/[id]` | `/atlas/workflows/[id]` | `/lanes/workflows/[id]` |
| DLQ · Replay | `/flowline/dlq` | `/atlas/dlq` | `/lanes/dlq` |
| 평가 결과(PASS/FAIL, CSV) | `/flowline/results` | `/atlas/results` | `/lanes/results` |
| 분석 | `/flowline/analytics` | `/atlas/analytics` | `/lanes/analytics` |
| 설정·권한·감사 | `/flowline/config` | `/atlas/config` | `/lanes/config` |

`[id]` 예: `wf-20261112-ko-0033`. 필터·선택 상태는 URL 쿼리에 동기화되어 링크로 공유할 수 있습니다.

---

## 2. 실행 방법

요구 사항: Node.js 20.9 이상.

```bash
cd applications/operations-web
npm i
npm run dev            # → http://localhost:3000 을 열어 주세요
```

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (http://localhost:3000) |
| `npm run build` → `npm start` | 프로덕션 빌드·실행 (`npm start -- -p 3100` 처럼 포트 지정 가능) |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run lint` | ESLint (next core-web-vitals + typescript) |
| `npm run test:e2e` | Playwright (`PW_BASE_URL`, 기본 http://localhost:3100) |
| `npm run oracle` | Mock 엔진이 `designs/mock-data.js`와 동일한 데이터를 내는지 지문 비교 (`ORACLE: IDENTICAL`) |

화면 우상단(또는 랜딩 하단)의 시뮬레이터 컨트롤로 일시정지 / 배속(1×·2×·5×·10×) / 배치 주입을 할 수 있습니다.

---

## 3. Mock API 개요

서버 시뮬레이터(`src/server/mock`)는 프로토타입의 `mock-data.js`를 그대로 포팅한 결정적(seeded) 엔진입니다.
가상 시계는 **2026-11-12 14:30 KST**에서 시작해 1.2초마다 20초 × 배속만큼 진행하고, 매 틱마다 Workflow 상태 전이·이벤트·로그·
알림·DLQ가 생성됩니다. 상태는 서버 프로세스 메모리에만 있으며 재시작하면 처음 시나리오로 돌아갑니다.

### 계획서 §8 API ↔ Mock 구현

| Method | Endpoint (계획서 §8) | 기능 | Mock 구현 |
| --- | --- | --- | --- |
| GET | `/api/v1/overview` | 전체 운영 현황 | ✅ |
| GET | `/api/v1/workflows` | Workflow 목록 (검색·필터·정렬·페이지) | ✅ |
| GET | `/api/v1/workflows/{id}` | Workflow 상세 | ✅ |
| GET | `/api/v1/workflows/{id}/events` | Event Timeline | ✅ |
| GET | `/api/v1/workflows/{id}/logs` | 상세 로그 | ✅ |
| GET | `/api/v1/workflows/{id}/attempts` | Attempt 이력 | ✅ |
| GET | `/api/v1/languages/capacity` | 언어별 Capacity | ✅ |
| PATCH | `/api/v1/languages/{lang}/capacity` | Capacity 변경 (`dry_run=1` 지원) | ✅ |
| GET | `/api/v1/dead-letters` | DLQ 목록 | ✅ |
| GET | `/api/v1/dead-letters/{id}` | DLQ 상세 | ✅ |
| POST | `/api/v1/dead-letters/{id}/replay` | 단건 Replay | ✅ |
| POST | `/api/v1/dead-letters/replay-batch` | 일괄 Replay | ✅ |
| POST | `/api/v1/workflows/{id}/cancel` | 실행 취소 | ✅ |
| GET | `/api/v1/analytics/throughput` | 처리량 분석 | ✅ |

§8 외에 화면에 필요해 추가한 엔드포인트:

- `workflows/{id}/dag`, `workflows/{id}/results` — Vertex PipelineJob DAG, 해당 Workflow의 발화 결과
- `capacity/global`, `reservations` — Global Slot 상한·분당 시작 수, 슬롯 예약
- `dead-letters/{id}/assign|close`, `replays` — DLQ 배정·종료, Replay 이력
- `analytics/{quality,errors,components,versions,languages,cost,daily,summary}` — 장기 분석(BigQuery 성격 집계)
- `stages`, `stages/{id}`, `gcs/{buckets,objects,object}` — 파이프라인 단계 상세, GCS 객체 탐색·미리보기
- `results`, `results/{utterance_id}`, `results/csv`, `results/file` — 발화별 PASS/FAIL 조회·집계, **CSV 다운로드**(UTF-8 BOM)
- `config`, `audit`, `alerts` (+ `ack`/`resolve`), `incidents`, `me`, `operators`, `meta`, `events`, `logs`, `sim`, `stream`

계획서 §8의 운영 원칙도 Mock에서 재현합니다.

- **인증/RBAC**: `x-operator` 헤더(운영자 id, URI 인코딩)로 Viewer / Operator / Admin 권한을 검사합니다. 운영자 선택(헤더 또는 설정 화면)을 Viewer로 바꾸면 변경 요청이 403으로 거부되는 것을 확인할 수 있습니다.
- **Idempotency-Key**: POST/PATCH에 대해 첫 성공 응답을 10분간 캐시하고, 재요청에는 `idempotent-replay: true`로 같은 응답을 돌려줍니다.
- **감사 기록·입력 검증**: 모든 상태 변경에 `reason`이 필수이며, 변경은 `AuditEntry`로 남습니다(`GET /audit`, SSE `audit`). 오류는 `{ error: { code, message(한국어) } }` 형식입니다.

### 실시간 갱신 — SSE

`GET /api/v1/stream` (`text/event-stream`). 앱 전체가 EventSource 하나를 공유하고(`LiveStreamProvider`), 각 화면은 필요한 이벤트만 구독합니다.

| event | 내용 |
| --- | --- |
| `hello` | 연결 직후 시뮬레이터 상태 |
| `tick` | 1.2초마다: 상태별 카운트, 단계별 카운트, KPI, Capacity, 진행 중 배치 위치 |
| `transition` | Workflow 상태 전이 (예: `RESERVED → DISPATCHING`) |
| `event` / `log` | 레지스트리 이벤트, 구조화 로그 (로그는 대량) |
| `alert` / `audit` / `dlq` / `sim` | 알림, 운영자 감사 기록, DLQ 변경, 시뮬레이터 일시정지·배속 |

`?types=tick,transition` 처럼 구독 이벤트를 걸러낼 수 있으며, 15초마다 keep-alive 주석을 보냅니다.
계획서대로 SSE로 먼저 구현했고, 필요하면 WebSocket으로 확장할 수 있습니다.

---

## 4. 실제 Operations API(FastAPI)로 교체하기

화면 코드는 모두 `src/lib/client`(`api.*`, `useApi`, `useLiveStream`, `csvUrl`)를 통해서만 API를 호출하므로,
**API 기준 URL 하나만 바꾸면** 실제 FastAPI Operations API로 전환됩니다. 아무것도 설정하지 않으면 내장 Mock API를 씁니다.
두 변수 모두 **빌드 시점**에 반영되므로 값을 바꾼 뒤에는 다시 `npm run build` 해야 합니다. 예시는 [`.env.example`](./.env.example)에 있습니다.

| 방식 | 환경 변수 | 동작 | 비고 |
| --- | --- | --- | --- |
| **서버 측 프록시 (권장)** | `OPERATIONS_API_URL=https://ops.example.com/api/v1` | `next.config.ts`의 `beforeFiles` rewrite가 `/api/v1/*`를 실제 API로 프록시. 내장 Mock 라우트보다 우선합니다. | 같은 출처라 CORS 불필요. 브라우저 코드는 그대로 `/api/v1`를 호출 |
| 브라우저 직접 호출 | `NEXT_PUBLIC_API_BASE=https://ops.example.com/api/v1` | 클라이언트의 `API_BASE`(`src/lib/client/api.ts`)가 해당 URL로 바뀜 (fetch, SSE, CSV 링크 모두) | 실제 API에 CORS 허용 필요 (`x-operator`, `idempotency-key` 헤더 포함) |

```bash
# 예: 사내 Operations API로 프록시
OPERATIONS_API_URL=https://ops.internal.example/api/v1 npm run build && npm start
```

실제 API가 지켜야 할 계약은 `src/lib/types.ts`(요청·응답 타입)와 FOUNDATION.md §4(파라미터·오류 형식·SSE 이벤트)입니다.
인증은 현재 데모용 `x-operator` 헤더이므로, 실제 환경에서는 IAP/OIDC 등 사내 인증으로 대체해야 합니다.
전환 후에는 `src/app/api/v1`과 `src/server`(Mock)를 제거해도 화면은 영향을 받지 않습니다.

---

## 5. 폴더 구조

```
operations-web/
├── src/
│   ├── app/
│   │   ├── page.tsx                 # / 랜딩 (콘셉트 선택 + 실시간 미니 프리뷰)
│   │   ├── flowline/ atlas/ lanes/  # 콘셉트별 라우트 (layout + 화면별 page.tsx)
│   │   └── api/v1/**/route.ts       # Mock Operations API (얇은 핸들러, SSE 포함)
│   ├── components/
│   │   ├── flowline/ atlas/ lanes/  # 콘셉트별 화면 컴포넌트
│   │   ├── landing/                 # 랜딩 페이지·프리뷰
│   │   └── shared/                  # EChart, StatusPill, 테마, 아이콘, 모션 등 공용
│   ├── lib/
│   │   ├── types.ts                 # 도메인·API 타입 (클라이언트/서버 단일 출처)
│   │   ├── catalog.ts               # 정적 카탈로그 (단계, 상태 메타, DAG 템플릿, 색상…)
│   │   ├── format.ts                # KST 포매터
│   │   └── client/                  # api 페처, useApi, LiveStream(SSE), CSV, URL 쿼리 상태, 운영자
│   ├── server/
│   │   ├── mock/                    # 결정적 시뮬레이터 엔진 (mock-data.js 포팅) + 런타임/프로젝션
│   │   ├── services/                # 도메인별 검증·비즈니스 규칙
│   │   └── http.ts                  # 오류 형식, 쿼리 파서, RBAC, Idempotency
│   ├── fonts/index.ts               # next/font 정의 (Pretendard, SUIT, Wanted Sans, JetBrains Mono, IBM Plex Mono, Fira Code)
│   └── styles/                      # 콘셉트별 CSS (data-variant 스코프) + landing.css
├── e2e/                             # Playwright 스펙
├── scripts/                         # oracle.mjs (엔진 동일성 검증), gen-catalog.mjs
├── FOUNDATION.md                    # 개발자 레퍼런스
└── .env.example                     # API 전환용 환경 변수 예시
```

---

## 6. 알려진 제한 사항

- **상태는 서버 프로세스 메모리**: 재시작하면 14:30 시나리오로 초기화되고, 서버 인스턴스마다 시뮬레이터가 따로 돕니다. 가상 시계는 1×에서 실제 시간의 약 16.7배로 흐르며, 약 34분 뒤 가상 자정을 넘기면 "오늘" KPI가 초기화됩니다.
- **유휴 정지**: SSE 연결과 API 요청이 2분간 없으면 시뮬레이터 틱을 건너뜁니다. 다음 요청이 오면 다시 진행합니다.
- **평가 결과의 모델 버전 필터**: `GET /results`에 `model_version` 파라미터가 없습니다. Flowline에는 모델 필터가 없고, Atlas는 모델을 Pipeline 버전으로 대응시켜 클라이언트에서 거릅니다(Mock은 버전당 모델이 하나라서 가능).
- **설정 변경 이력 메타**: `GET /config`의 `drift[].changedBy/changedAt/reason`이 PATCH 후에도 초기 시드 값을 돌려줍니다. Lanes는 `/audit`를 겹쳐 최신 값을 보여 주지만, Flowline·Atlas는 시드 값을 그대로 표시합니다.
- **GCS 목록 `delimiter=""`**: 클라이언트 `qs()`가 빈 문자열 파라미터를 생략하므로, 평면 목록이 필요할 때는 다른 구분자를 써야 합니다(Lanes는 `|` 사용).
- **단계별 GCS 객체**: `/stages/{id}`는 `gcs_input`·`vertex`·`results`·`dlq`에 대해서만 `gcsObjects`를 돌려줍니다. Atlas는 그 밖의 단계에서 입력 버킷 목록으로 대체합니다.
- **Retry/DLQ 로그 빈도**: 시뮬레이터가 `RETRY_*`/`DLQ` 로그를 드물게 만들기 때문에, 해당 단계 인스펙터의 로그는 몇 초 동안 새 줄이 없을 수 있습니다(가짜 로그는 만들지 않음).
- **Atlas 세부 동작**: Explorer 브레드크럼은 이 탭에서 마지막으로 저장된 탐색 쿼리로 돌아갑니다. 존재하지 않는 Workflow ID로 들어가면 브라우저 콘솔에 404 리소스 오류 4건이 남고 폴링이 멈춥니다. 토스트가 Log Explorer 선택 상자를 일시적으로 가릴 수 있습니다.
- **Flowline 계획 DAG**: PipelineJob이 생기기 전 흐리게 보이는 예정 DAG 노드는 키보드 포커스는 받지만 동작하지 않습니다.
- **인증**: `x-operator` 헤더 기반 데모 RBAC이며 실제 인증이 아닙니다.
- 개발 모드 화면 좌하단의 "N" 배지는 Next.js 개발 표시기이며 프로덕션 빌드에는 나타나지 않습니다.
