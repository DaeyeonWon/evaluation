# 다른 프로젝트에 이 운영 콘솔 도입하기

이 콘솔(AIPO 운영 콘솔, Next.js 16)은 **설정 파일 두 개 + 환경 변수**만 바꿔서 다른 배치/파이프라인 프로젝트에 재사용할 수 있도록 구성되어 있습니다.
인증·권한 세부 사항은 [docs/auth.md](./auth.md)를 참고하세요.

| 바꾸는 것 | 위치 |
| --- | --- |
| 제품명·부제·환경 배지, 인증 방식, 역할→권한, 사용자→역할, 외부 링크(Hermes), API 모드 | `console.config.ts` (앱 루트) |
| 도메인 모델(언어, 단계, 파이프라인 등) | `src/config/domain.ts` (`export const domain: DomainConfig`) |
| 비밀 값·사용자 목록·URL | 환경 변수 (`.env.example`) |

---

## 1. `console.config.ts` 와 `src/config/domain.ts` 수정

### 1-1. `console.config.ts`

`defineConsoleConfig()`로 감싸져 있어 타입 검사와 자동 완성이 됩니다. 스키마는 `src/config/schema.ts`에 있습니다.

```ts
export default defineConsoleConfig({
  branding: { productName: "MYPIPE", subtitle: "음성 인식 회귀 평가", envLabel: env.CONSOLE_ENV_LABEL },
  auth: {
    mode: env.CONSOLE_AUTH_MODE || "mock",           // mock | iap | oidc-header
    roles: {                                          // 역할 → 권한
      Viewer:   { permissions: ["view"] },
      Operator: { permissions: ["view", "capacity:write", "dlq:replay", "workflow:cancel", "hermes:access"] },
      Admin:    { permissions: "*" },
    },
    rules: [{ domains: ["mycorp.com"], roles: ["Viewer"] }],   // 사용자 → 역할 (이메일/도메인)
    envOverrides: { CONSOLE_ADMINS: ["Admin"], CONSOLE_OPERATORS: ["Operator"] },
    defaultRoles: [],                                 // 매칭 안 되면 권한 없음(403)
  },
  externalLinks: {
    hermes: { url: env.HERMES_DASHBOARD_URL, requiredPermission: "hermes:access", allowedRoles: ["Operator", "Admin"] },
  },
  api: { mode: env.OPERATIONS_API_URL ? "proxy" : "mock", upstreamUrl: env.OPERATIONS_API_URL },
  domain,
});
```

- 이 파일은 **서버 전용**입니다(이메일 목록을 담음). 클라이언트 컴포넌트에서 import하지 말고, 브라우저에는 `GET /api/v1/auth/session`(`useSession()`)으로 필요한 정보만 전달합니다.
- 권한 문자열은 자유롭게 추가할 수 있습니다. 새 변경 API를 만들면 `src/server/auth/policy.ts`에 규칙을 한 줄 추가하세요(미등록 변경 API는 기본적으로 `admin`만 허용).

### 1-2. `src/config/domain.ts`

언어 코드, 파이프라인 단계, 상태 등 **도메인 모델**을 정의합니다. `console.config.ts`의 `domain` 필드로 연결됩니다.

> `console.config.ts`가 `import { domain } from "./src/config/domain"`으로 이 파일을 읽습니다. 타입은 `DomainConfig`(`src/lib/types.ts`)입니다.

---

## 2. 환경 변수 설정

`.env.example`을 복사해 로컬은 `.env.local`, 운영은 Cloud Run 서비스 환경 변수로 설정합니다.

| 변수 | 용도 | 필수 |
| --- | --- | --- |
| `CONSOLE_AUTH_MODE` | `mock` / `iap` / `oidc-header` | 운영: `iap` 권장 |
| `CONSOLE_SESSION_SECRET` | mock 세션 쿠키 HMAC 키 (`openssl rand -hex 32`) | mock 모드에서 로컬 외 필수 |
| `IAP_AUDIENCE` | IAP JWT `aud` 검증 값 | iap 모드에서 강력 권장 |
| `CONSOLE_AUTH_EMAIL_HEADER`, `CONSOLE_AUTH_NAME_HEADER` | oidc-header 모드 헤더 이름 | oidc-header |
| `CONSOLE_ADMINS`, `CONSOLE_OPERATORS`, `CONSOLE_VIEWERS`, `CONSOLE_HERMES_USERS` | 쉼표로 구분한 이메일 → 역할 | 선택 |
| `CONSOLE_VIEWER_DOMAINS` | 이 도메인 사용자 전원 Viewer | 선택 |
| `HERMES_DASHBOARD_URL` | `/hermes`가 리다이렉트할 주소(없으면 “미설정” 안내 화면) | 선택 |
| `CONSOLE_ENV_LABEL` | 로그인/403 화면의 환경 배지 | 선택 |
| `OPERATIONS_API_URL` | 실제 Operations API 주소 (**빌드 시점** 반영) | proxy 모드 |

`OPERATIONS_API_URL`을 뺀 나머지는 **런타임**에 읽으므로 이미지를 다시 빌드하지 않고 바꿀 수 있습니다(서버 재시작 필요).

---

## 3. 데이터 소스 선택: mock vs proxy (실제 FastAPI)

| 모드 | 설정 | 동작 |
| --- | --- | --- |
| **mock** (기본) | `OPERATIONS_API_URL` 미설정 | 앱 내장 Mock 엔진과 `/api/v1/**` 라우트가 응답합니다. 데모·UI 개발용입니다. |
| **proxy** | `OPERATIONS_API_URL=https://ops-api.internal/api/v1` 으로 **빌드** | `/api/v1/*` 요청을 서버 측에서 실제 FastAPI로 프록시합니다(`next.config.ts` rewrite, CORS 불필요). |

proxy 모드 주의 사항:

- 실제 API는 **FOUNDATION.md §4의 `/api/v1` 계약**(경로, 쿼리 파라미터, 응답 타입 `src/lib/types.ts`, 한국어 오류 `{ error: { code, message } }`, `Idempotency-Key`)을 구현해야 합니다.
- `/api/v1/auth/**`(session·login·logout)는 rewrite 대상에서 제외되어 **항상 콘솔이 직접** 응답합니다. 그 외 `/api/v1/*`는 `/api/v1/me`, `/api/v1/operators`를 포함해 모두 upstream으로 갑니다. 따라서 FastAPI는 `/me`를 `x-console-user-*` 헤더로 구현해야 합니다. 새 UI는 `/api/v1/auth/session`(`useSession()`) 사용을 권장합니다.
- `src/proxy.ts`가 rewrite **이전에** 실행되므로 인증과 권한 표(`policy.ts`)가 proxy 모드에서도 그대로 적용됩니다.
- 프록시는 사용자 정보를 `x-console-user-id`, `x-console-user-email`, `x-console-user-roles`, `x-console-user-permissions` 요청 헤더로 넘깁니다. 클라이언트가 보낸 같은 이름의 헤더는 제거됩니다.
- FastAPI는 이 헤더로 **감사 로그 actor를 기록**하고 필요하면 세부 권한을 재검사하세요. 단, 이 헤더는 콘솔을 통해서만 API에 접근할 수 있을 때만(내부 네트워크, 서비스 간 인증) 신뢰할 수 있습니다.
- `NEXT_PUBLIC_API_BASE`(브라우저가 API를 직접 호출)는 콘솔의 인증·RBAC를 우회하므로 권장하지 않습니다.

---

## 4. Cloud Run + IAP 배포

```bash
# 1) 이미지 빌드 (proxy 모드면 --build-arg OPERATIONS_API_URL=…)
docker build -t REGION-docker.pkg.dev/PROJECT/REPO/ops-console .
docker push REGION-docker.pkg.dev/PROJECT/REPO/ops-console

# 2) 배포: 공개 ingress 차단, IAP 모드
gcloud run deploy ops-console \
  --image REGION-docker.pkg.dev/PROJECT/REPO/ops-console --region REGION \
  --ingress internal-and-cloud-load-balancing --no-allow-unauthenticated \
  --set-env-vars "CONSOLE_AUTH_MODE=iap,IAP_AUDIENCE=/projects/NUM/global/backendServices/ID,CONSOLE_ADMINS=lead@mycorp.com,CONSOLE_VIEWER_DOMAINS=mycorp.com,HERMES_DASHBOARD_URL=https://hermes.mycorp.com"
```

이미지 빌드·배포 뒤 다음을 설정합니다.

3. 외부 HTTPS 로드밸런서와 서버리스 NEG를 구성하고, 백엔드 서비스에서 IAP를 켭니다. Cloud Run 내장 IAP(`--iap`)를 써도 되며, 이때 audience는 `/projects/NUM/locations/REGION/services/NAME`입니다.
4. 접속 허용 대상(사람/그룹)에게 `roles/iap.httpsResourceAccessor`를 부여합니다. IAP 서비스 에이전트에는 서비스의 `roles/run.invoker`를 부여합니다.
5. `IAP_AUDIENCE`를 설정합니다. 백엔드 서비스 ID는 `gcloud compute backend-services describe NAME --global --format='value(id)'`로 확인합니다.

이미지 구성(`Dockerfile`):

- node 22 alpine 멀티 스테이지 빌드
- `output: "standalone"`
- non-root 사용자(uid 1001)
- `PORT=8080`

역할 분담은 다음과 같습니다.

- **IAP**: 누가 들어올 수 있는지 결정합니다.
- **콘솔 RBAC**(`console.config.ts`): 들어온 사람이 무엇을 할 수 있는지 결정합니다.

---

## 5. 체크리스트

- [ ] `console.config.ts`의 `branding`(제품명, 부제, 환경 배지)을 프로젝트에 맞게 수정
- [ ] `auth.roles`의 역할→권한 표를 팀 운영 정책에 맞게 검토
- [ ] 사용자→역할: `rules`(도메인/이메일) 또는 `CONSOLE_ADMINS`/`CONSOLE_OPERATORS`/… 설정, `defaultRoles`는 `[]` 유지(기본 거부)
- [ ] `src/config/domain.ts` 작성 후 `console.config.ts`의 `domain` 연결
- [ ] 운영 `CONSOLE_AUTH_MODE=iap` + `IAP_AUDIENCE` 설정 (mock 모드는 운영 금지)
- [ ] mock 모드를 공유 환경(데모)에 띄운다면 `CONSOLE_SESSION_SECRET` 설정
- [ ] Cloud Run ingress `internal-and-cloud-load-balancing`, `--no-allow-unauthenticated`
- [ ] IAP를 우회한 직접 호출(`curl https://…run.app/api/v1/overview`)이 401/403인지 확인
- [ ] IAP를 통해 로그인한 뒤 `GET /api/v1/auth/session`의 `roles`/`permissions`가 기대값인지 확인 (IAP JWT 검증 실제 동작 확인)
- [ ] Viewer 계정으로 변경 API(예: `PATCH /api/v1/languages/ko/capacity`)가 403인지 확인
- [ ] 감사 로그(`GET /api/v1/audit`)의 actor가 로그인 사용자 이메일인지 확인
- [ ] `/hermes`: 권한 없는 계정 403, 권한 있는 계정 307 → `HERMES_DASHBOARD_URL`
- [ ] proxy 모드: 실제 API가 `/api/v1` 계약을 구현하고 `x-console-user-*` 헤더로 감사 기록
- [ ] 새 변경 API를 추가했다면 `src/server/auth/policy.ts`에 권한 규칙 추가
- [ ] `npm run typecheck && npm run lint && npm run build` 통과
