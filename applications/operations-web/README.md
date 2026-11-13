# AIPO Operations Console (Atlas) — 빅스비 실발화 평가 운영 콘솔

AIPO 플랫폼의 **빅스비 실발화 평가** 파이프라인을 관제하는 단일 운영 콘솔입니다.
언어별 실발화 배치가 GCS에 올라오면 Eventarc/Pub/Sub → Cloud Run Event Ingress → Firestore 레지스트리·언어별 Pending Queue →
언어별 Scheduler(Capacity Slot) → Cloud Workflows(Retry·Backoff) → Vertex AI Pipeline(root + sub-pipeline) →
발화별 PASS/FAIL 결과 CSV(GCS)·BigQuery로 흐르고, 실패는 Retry → DLQ → 수동 Replay로 복구됩니다.

콘솔은 Atlas 디자인(블루프린트 도면 스타일, 라이트/다크 테마) 하나로 구성되며, 앱에 내장된 **Mock Operations API(`/api/v1`)와
서버 시뮬레이터**로 GCP 없이 그대로 동작합니다. 실제 FastAPI Operations API와 IAP 인증으로 전환할 수 있습니다.

- 스택: Next.js 16 (App Router, `src/proxy.ts`) · React 19 · TypeScript · Tailwind CSS v4 · ECharts 6 · motion · d3-zoom
- 폰트: SUIT Variable + IBM Plex Mono (`next/font`로 self-host)
- 언어: 한국어 / English 전환 (KO | EN). 한국어 UI도 기술 용어·서비스 이름은 영어로 유지합니다.

---

## 1. 화면

모든 화면 상단에 전역 기간 선택기(오늘 · 어제 · 1h · 6h · 24h · 7d · 30d · 직접 지정, KST)가 있습니다. 기간은 URL(`?range=` 또는
`?from=&to=`)에 저장되어 새로고침과 화면 이동 후에도 유지되고, 콘솔 안의 모든 링크가 현재 기간을 함께 넘깁니다.

| 경로 | 화면 |
| --- | --- |
| `/` | **오케스트레이션 캔버스**: §3.1 아키텍처를 줌/팬 가능한 도면으로 그리고, 실시간 배치 토큰·Edge 처리량·단계 인스펙터·파일명 검색을 제공합니다. Vertex AI 노드에서 Pipeline을 골라 내부 DAG를 볼 수 있습니다 (`?pipeline=`) |
| `/board` | **언어 레인 보드**: 언어 × Workflow 상태 매트릭스, Time river, 단계 인스펙터 드로어 |
| `/overview` | 개요: KPI, 상태·언어·오류 차트, 알림 |
| `/capacity` | 언어별·Global Capacity 조회와 변경 (dry run 영향 분석, 사유 필수) |
| `/explorer` | Workflow 검색·필터 표 |
| `/pipelines` | Pipeline 레지스트리 (root / sub-pipeline, version) |
| `/pipelines/[id]` | Pipeline 상태: 실행 이력, 노드별 활동, PipelineJob 탐색 |
| `/workflows/[id]` | Pipeline 상세: DAG, Event Timeline, Attempt 이력, 로그, Workflow 취소 (`/workflows`는 최근 실행 중인 Workflow로 이동) |
| `/files` | 모든 단계의 GCS 객체를 파일명으로 검색 |
| `/dlq` | DLQ: 검토, 단건·일괄 Replay, 종료 처리, 담당 지정 |
| `/results` | 평가 결과 (PASS/FAIL): 발화별 판정 근거, CSV 내보내기 |
| `/analytics` | 장기 분석: 품질, 오류, Component, Version, 비용 |
| `/config` | 운영 설정: Retry·Timeout, Version 트래픽, 서비스, 알림 정책, 권한, 감사 로그 |
| `/hermes` | 외부 Hermes 대시보드 진입점 (권한이 있으면 307 이동, 없으면 403) |
| `/login` | mock 모드 데모 로그인 (다른 모드에서는 인증 프록시 안내) |
| `/403` | 권한 없음 안내 (서버 렌더링, HTTP 403). 권한 없는 화면은 proxy가 이 화면으로 rewrite합니다 |

단계 인스펙터는 URL로 열 수 있습니다: `/?stage=gcs_input&tab=gcs&q=batch-0014` (`tab` = `wf` · `gcs` · `ev` · `log` · `met`).
`/board`에서도 같은 파라미터가 동작합니다.

---

## 2. 빠른 시작

요구 사항: Node.js 20.9 이상.

```bash
cd applications/operations-web
npm i
npm run dev            # http://localhost:3000 → /login 으로 이동합니다
```

`/login`에서 데모 사용자를 고르면 로그인됩니다 (mock 모드). 역할에 따라 버튼이 비활성화되고, 서버도 같은 권한을 검사합니다.

| 사용자 | ID | 역할 | 할 수 있는 일 |
| --- | --- | --- | --- |
| 김서연, 한도윤 | `op-kim-sy`, `op-han-dy` | Admin | 전체 (설정 변경, 시뮬레이터 제어 포함) |
| 박지훈, 이하은, 정유나 | `op-park-jh`, `op-lee-he`, `op-jung-yn` | Operator | Capacity 변경, DLQ Replay, Workflow 취소, Hermes |
| 최민준, Kenji Sato | `op-choi-mj`, `op-sato-k` | Viewer | 조회·내보내기만 (Hermes 불가) |

헤더의 시뮬레이터 컨트롤(일시정지, 1x·2x·5x)은 Admin만 사용할 수 있습니다.

| 명령 | 설명 |
| --- | --- |
| `npm run dev` | 개발 서버 (http://localhost:3000) |
| `npm run build` → `npm start` | 프로덕션 빌드·실행 (standalone 출력) |
| `npm run typecheck` | `next typegen && tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run i18n:check` | ko/en 메시지 키·placeholder 일치 검사 (`tsx src/i18n/check-messages.ts`) |
| `npm run test:e2e` | Playwright smoke. `next dev -p 3100`(`.next-e2e`)을 자동으로 띄웁니다. 이미 실행 중인 서버를 쓰려면 `PW_BASE_URL=http://localhost:3000` |
| `npm run gen:catalog` | `src/config/domain.ts`·Mock 엔진에서 `src/lib/catalog.ts`를 다시 생성 |

개발 서버 여러 개를 동시에 띄울 때는 빌드 디렉터리를 나눕니다: `NEXT_DIST_DIR=.next-a npx next dev -p 3101`.

---

## 3. 설정

| 파일 | 내용 |
| --- | --- |
| [`console.config.ts`](./console.config.ts) | 브랜딩, 인증 모드, 역할 → 권한, 사용자 → 역할 규칙, env 목록 매핑, 외부 링크(Hermes). 서버 전용입니다 |
| [`src/config/domain.ts`](./src/config/domain.ts) | 도메인 모델: 언어와 Capacity 기본값, 단계, 버킷, Capsule, 기기, 모델, Pipeline 레지스트리(version별 DAG, sub-pipeline) |
| [`.env.example`](./.env.example) | 환경 변수 전체 목록과 설명 |

주요 환경 변수 (별도 표시가 없으면 서버 실행 시점에 읽습니다):

| 변수 | 설명 |
| --- | --- |
| `CONSOLE_AUTH_MODE` | `mock`(기본) · `iap` · `oidc-header` |
| `CONSOLE_SESSION_SECRET` | mock 모드 세션 쿠키 HMAC 키. 노트북 밖에서는 반드시 설정해야 합니다 |
| `IAP_AUDIENCE` | iap 모드에서 IAP JWT의 `aud`. 설정하면 모든 요청의 JWT를 검증합니다 |
| `CONSOLE_AUTH_EMAIL_HEADER`, `CONSOLE_AUTH_NAME_HEADER` | oidc-header 모드의 헤더 이름 |
| `CONSOLE_ADMINS`, `CONSOLE_OPERATORS`, `CONSOLE_VIEWERS`, `CONSOLE_HERMES_USERS` | 쉼표로 구분한 이메일 → 역할 |
| `CONSOLE_VIEWER_DOMAINS` | 이 도메인의 모든 사용자에게 Viewer 부여 |
| `HERMES_DASHBOARD_URL` | `/hermes`가 이동할 Hermes 대시보드 URL |
| `CONSOLE_ENV_LABEL` | `/login`·403 화면의 환경 배지 (기본 `DEV`, production이면 `PROD`) |
| `CONSOLE_DEFAULT_LOCALE`, `CONSOLE_LOCALE_DETECTION` | 기본 언어(`ko`), `0`이면 `Accept-Language` 감지를 끕니다 |
| `OPERATIONS_API_URL` [빌드 시점] | 설정하면 `/api/v1/*`를 실제 FastAPI로 서버 측 프록시합니다 (`/api/v1/auth/**` 제외). 미설정이면 내장 Mock API |
| `NEXT_PUBLIC_API_BASE` [빌드 시점] | 브라우저가 실제 API를 직접 호출 (CORS 필요, 콘솔 RBAC를 우회하므로 비권장) |

---

## 4. 인증과 권한

| 모드 | 동작 |
| --- | --- |
| `mock` | `/login`에서 데모 사용자 선택 → 서명된 HttpOnly 쿠키(`aipo_session`, 12시간) |
| `iap` | Google Cloud IAP 헤더(`x-goog-authenticated-user-email`)와 JWT(`IAP_AUDIENCE` 설정 시) |
| `oidc-header` | oauth2-proxy 등 인증 프록시가 넣는 이메일 헤더를 신뢰 |

- `src/proxy.ts`가 모든 페이지와 API 요청을 먼저 검사합니다: 세션이 없으면 페이지는 `/login?next=…`, API는 401입니다.
  권한이 없으면 API는 403, 페이지는 `/403`입니다. 상태 변경 API는 route handler에서 한 번 더 검사하고 감사 로그에 세션 사용자를 기록합니다.
- 권한 키: `view`, `capacity:write`, `config:write`, `dlq:replay`, `workflow:cancel`, `sim:control`, `hermes:access`, `admin`.
- 세션이 만료되면 백그라운드 요청을 포함한 모든 API 호출의 401이 `/login?next=<현재 화면>`으로 이동시킵니다.
- 자세한 내용: [docs/auth.md](./docs/auth.md).

### Hermes

`/hermes`는 `hermes:access` 권한(Operator, Admin, `CONSOLE_HERMES_USERS`)이 있는 사용자만 엽니다.
`HERMES_DASHBOARD_URL`이 있으면 그 URL로 307 이동하고, 없으면 "아직 연결되지 않음" 안내를 보여 줍니다. 권한이 없으면 HTTP 403입니다.

---

## 5. 다국어 (KO / EN)

- 헤더의 KO | EN 토글로 전환하며, 선택은 `console_locale` 쿠키에 저장됩니다. 쿠키가 없으면 `Accept-Language`, 그다음 `ko`를 씁니다.
- 모든 화면 문자열, aria-label, 차트 라벨, 토스트, 페이지 제목이 번역되어 있습니다. 상태 값(Running, Succeeded…)은 두 언어 모두 영어입니다.
- API 오류 메시지도 요청 언어로 돌아옵니다: `{ error: { code, message, key } }`.
- 시각은 두 언어 모두 KST로 표시합니다. 자세한 내용: [docs/i18n.md](./docs/i18n.md).

---

## 6. Docker / Cloud Run

[`Dockerfile`](./Dockerfile)은 standalone 빌드를 non-root로 실행하며 8080 포트를 엽니다. IBM Plex Mono를 빌드 시점에 내려받으므로 빌드에 네트워크가 필요합니다.

```bash
docker build -t aipo-ops-web .
docker run -p 8080:8080 -e CONSOLE_SESSION_SECRET=$(openssl rand -hex 32) aipo-ops-web

# 실제 API로 프록시하는 이미지
docker build --build-arg OPERATIONS_API_URL=https://ops-api.internal.example/api/v1 -t aipo-ops-web .
```

Cloud Run에서는 public ingress 없이 배포하고, 외부 HTTPS Load Balancer + IAP 뒤에 두는 구성을 권장합니다
(`CONSOLE_AUTH_MODE=iap`, `IAP_AUDIENCE` 설정). 단계별 명령은 [docs/auth.md](./docs/auth.md) "Cloud Run + IAP setup notes"와
[docs/adoption.md](./docs/adoption.md)를 참고하세요.

---

## 7. 문서

| 문서 | 내용 |
| --- | --- |
| [docs/architecture.md](./docs/architecture.md) | 폴더 구조, 요청·데이터 흐름, 어댑터, 라우트, SSE, URL 계약, 화면 추가 방법, Gotchas |
| [docs/data-contract.md](./docs/data-contract.md) | `/api/v1` 계약: 기간, Pipeline·sub-pipeline, 파일 검색, SSE (`docs/openapi.yaml` 포함) |
| [docs/auth.md](./docs/auth.md) | 세션, 인증 모드, 역할·권한, Hermes, Cloud Run + IAP |
| [docs/i18n.md](./docs/i18n.md) | i18n API, 용어집, 어조, 숫자·날짜 형식 |
| [docs/adoption.md](./docs/adoption.md) | 다른 프로젝트에 이 콘솔을 도입하는 방법 |
| [docs/integration-spec.md](./docs/integration-spec.md) | 시스템 연동 스펙: Platform·Workflows·Vertex AI·Data·Operations API 팀이 구현할 계약 |

---

## 8. 알려진 제한 사항

- **Mock 상태는 서버 프로세스 메모리에 있습니다.** 재시작하면 시드 시나리오(가상 시계 14:30 KST, 30일 이력)로 돌아가고, 서버 인스턴스마다 시뮬레이터가 따로 돕니다.
- **가상 시계**: 1x에서 1.2초마다 20초씩 흐릅니다. 가상 자정을 넘기면 엔진이 새 날짜로 다시 시드되어 "오늘" 수치가 바뀝니다. API 요청과 SSE 연결이 2분간 없으면 틱을 건너뜁니다.
- **SSE는 HTTP 상태를 볼 수 없습니다.** 스트림 연결이 끊기면 `/api/v1/auth/session`으로 세션 만료를 확인한 뒤 로그인 화면으로 이동합니다. 재연결 시 `Last-Event-ID`로 최근 5분(최대 5,000건) 메시지를 backfill하고, 그보다 오래되었으면 화면 데이터를 다시 불러옵니다. Backfill 버퍼는 서버 프로세스 메모리에 있습니다.
- **캔버스 배치 토큰**은 legacy 단계 위치만 알기 때문에, 모든 단계를 갖춘 root Pipeline DAG를 선택했을 때만 Vertex AI 노드 안에 그려집니다. 다른 Pipeline을 고르면 노드별 실행 수 배지로 대신합니다.
- **Capacity 변경 결과 메시지**(PATCH 응답의 `message`, 영향 분석 문구)는 아직 한국어로만 제공됩니다. 사용자가 입력한 사유 등 자유 텍스트는 입력한 그대로 저장됩니다(기본 취소 사유는 언어 중립 코드로 저장되어 화면 언어로 표시됩니다).
- **감사 로그**는 Mock 엔진 메모리에 있습니다. proxy/Hermes/login 감사는 `OPERATIONS_API_URL`로 실제 API를 쓰는 경우에도 콘솔의 Mock 감사 로그에 기록됩니다.
- **IAP JWT 검증**은 위조·누락 토큰으로만 확인했습니다. 첫 배포 후 실제 IAP로 한 번 검증해 주세요.
- **403 화면**: HTTP 상태가 403이므로 브라우저 콘솔에 문서 리소스 403 오류 한 줄이 남습니다 (브라우저 기본 동작).
- `oidc-header` 모드와 `IAP_AUDIENCE` 없는 `iap` 모드는 헤더를 그대로 신뢰합니다. 콘솔에 인증 프록시를 거쳐서만 접근할 수 있어야 합니다.
- 개발 모드 화면 좌하단의 "N" 배지는 Next.js 개발 표시기이며 프로덕션 빌드에는 나타나지 않습니다.
