# LayoverJoy — Technical Implementation

Backend (NestJS + Prisma + PostgreSQL + Redis) · Android (Jetpack Compose) · Deployment target: Daytona Sandbox.

---

## 1. Repository Layout

```
project/
├── PRODUCT_DEFINITION.md        # English product definition
├── TECHNICAL_IMPLEMENTATION.md  # This document
├── AGENTS.md                    # Agent/developer conventions
├── backend/                     # NestJS API + background worker
│   ├── src/                     # Modules (see §3)
│   └── prisma/schema.prisma     # Data model (see §4)
├── android/                     # Jetpack Compose app (see §6)
├── infra/daytona/               # Daytona deployment scripts (see §8)
└── docker-compose.yml           # Local dev: postgres + redis + api + worker
```

Secrets live outside the repo in `.secrets/layoverjoy.env` (never committed); `qoder-input/.env.example` documents every variable.

## 2. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| API | NestJS 10 (TypeScript, strict) | Module boundaries map 1:1 to product domains |
| ORM/DB | Prisma 5 + PostgreSQL 16 | Typed schema, fast `db push` for sandbox deploys |
| Queue/cache | Redis 7 (ioredis) | Monitor ticks, search-run progress, idempotency |
| Validation | Zod (env + DTOs) | Fail fast at boot; precise error contracts |
| Auth | JWT access + refresh rotation | Stateless API; refresh stored hashed |
| Android | Kotlin + Jetpack Compose + Material3, Retrofit/kotlinx.serialization | Single-activity, fully declarative UI |
| Inference | Nosana GPU deployment (OpenAI-compatible API) | Plan explanations; deterministic template fallback |
| Deployment | Daytona Sandbox SDK (`@daytonaio/sdk`) | Hackathon-provided infra; native-process deploy |

## 3. Backend Module Map (`backend/src`)

| Module | Responsibility | Key endpoints |
|---|---|---|
| `auth` | Register/login, refresh rotation, `me` | `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/refresh`, `GET /v1/auth/me` |
| `users` | Profile, onboarding flags, interests | `GET/PATCH /v1/me` |
| `entry-rules` | Rule snapshots, eligibility engine | `GET /v1/rules`, internal evaluate API |
| `airports` | Airport/city catalog (hub seed) | `GET /v1/airports` |
| `atlas` | Atlas Sandbox adapter (search/verify/order/pay/webhook client) | internal; webhook: `POST /api/webhooks/atlas/:sharedToken` |
| `search` | Search orchestration state machine | `POST /v1/searches`, `GET /v1/searches/:runId/status`, `GET /v1/searches/:runId/plans` |
| `plans` | Plan detail, city packs, JoyScore breakdown | `GET /v1/plans/:id`, `POST /v1/plans/:id/explanation` |
| `explanations` | Nosana client + template fallback | used by `plans` |
| `monitors` | Monitor rules + trigger evaluation | `POST /v1/monitors`, `PATCH /v1/monitors/:id/status`, `GET /v1/monitors` |
| `notifications` | In-app center, email channel (SMTP optional) | `GET /v1/notifications`, `POST /v1/notifications/:id/read` |
| `bookings` | Dual-order state machine, verify/order/pay/refund mocks | `POST /v1/bookings/composite-order`, `POST /v1/bookings/:id/mock-pay`, `POST /v1/bookings/:id/mock-refund`, `GET /v1/bookings` |
| `webhooks` | Atlas order-status ingestion + compensation hooks | `POST /api/webhooks/atlas/:sharedToken`, `POST /api/orders/:id/events` |
| `planning-jobs` | Daytona planning-job contract | `POST /api/v1/planning-jobs`, status endpoints |
| `common` | Error contract, guards, interceptors, crypto | — |
| `worker.ts` | Standalone entry: monitor ticks every 5 min, notification fan-out | `node dist/worker.js` |

Route prefixes: business APIs under `/v1/*`; Atlas-facing contracts keep their original paths (`/api/orders/*`, `/api/webhooks/*`, `/api/v1/planning-jobs*`).

### 3.1 Error contract

```json
{ "code": "PARTIAL_BOOKING", "message": "...", "details": { "intentId": "..." } }
```

- Stable machine codes (`VALIDATION_FAILED`, `UNAUTHORIZED`, `RULE_NOT_FOUND`, `PRICE_CHANGED`, `PARTIAL_BOOKING`, …) with human messages.
- The booking flow recovers from `PARTIAL_BOOKING` via `details.intentId` — no silent retries on order/pay paths.

### 3.2 Booking state machine (dual-order)

```
DRAFT → BOTH_VERIFIED → ORDERING → LEG_A_ORDERED → BOTH_ORDERED → PAYMENT_PENDING → COMPLETED
                                 ↘ PARTIAL_ORDER → (compensation) → SIMULATED_REFUND_PENDING → SIMULATED_REFUNDED
any unclear result → query status only; terminal anomalies → MANUAL_REVIEW / EXPIRED
```

Order creation order is intentional: **Leg B first** (higher inventory risk), then Leg A. `legBFailure=true` (demo injection) forces the partial path.

### 3.3 JoyScore

`joyScore = clamp(usable-hours component + fare-delta component + city-experience component + interest-match component)`; breakdown returned per component with points so the UI can render the composition transparently. Interests are counted only (semantic-stable codes sent by the client).

## 4. Data Model (Prisma)

Users & documents: `User`, `RefreshToken`, `TravelDocument` (kind PASSPORT/VISA, countryCode, type, expiresOn — **no numbers/names/photos**).

Rules & search: `EntryRule` (versioned snapshot, effective window, sourceUrl), `SearchRun` (state, counts, funnel JSON), `EligibilitySnapshot` (ruleId+version, verifiedAt, evidence), `FlightOfferSnapshot`, `StopoverPlan` (legs, stayDays, usableHours, joyScore + breakdown, cost breakdown, risk flags), `PlanExplanation` (provider NOSANA/TEMPLATE, payload).

Engagement: `MonitorRule`, `Notification`, `NotificationDelivery`.

Money path: `BookingIntent` (status, acceptedTotal, expiresAt), `FlightOrder` (per leg, orderNoLast4, status), `AtlasWebhookEvent` (idempotent ingestion).

Ops: `PlanningJob`, `PlanningJobCandidate`, `AuditEvent`.

Encryption: field-level AES for any sensitive column via `DATA_ENCRYPTION_KEY`; password hashing with bcrypt/argon2.

## 5. Environment & Boot

- `main.ts` binds `0.0.0.0:${PORT}` and does **not** load dotenv — the environment must be exported by the launcher (see `start.sh` in §8).
- Required (Zod-validated): `DATABASE_URL`, `JWT_SECRET` (≥16 chars), `DATA_ENCRYPTION_KEY` (≥16 chars).
- Optional with defaults: `ATLAS_*` (Sandbox base URL/keys), `NOSANA_*` (inference; falls back to template when unset), `SMTP_*` (email channel), `REDIS_URL`, `RUNTIME_TARGET`.
- `seed.ts` loads airport hubs and entry-rule snapshots (aligned with `qoder-input/06-签证规则种子数据`).

Local run:

```bash
docker compose up -d            # postgres + redis + api + worker (project/docker-compose.yml)
# or manually:
npm ci && npx prisma generate && npm run build
npx prisma migrate dev && node dist/seed.js
node dist/main.js               # API
npm run start:worker            # monitor worker
```

## 6. Android App

- Single activity + Compose Navigation; Material3 theme (`ui/theme`), brand palette.
- Network: Retrofit + kotlinx.serialization; session in DataStore (`SessionStore`), auto-refresh on 401.
- Screens: Auth → Onboarding(3 steps) → Main(bottom tabs: Home / Explore / Trips / Me) with stack routes for Results, PlanDetail, MonitorSetup, BookingFlow, Notifications, Documents.
- Home screen is **fully local** (`LocalDemoData`) — curated city cards, no upload of real documents.
- Configurable backend URL (Auth screen / Me tab): emulator default is the host Docker bridge; devices use LAN or the Daytona preview URL.

### 6.1 In-app i18n (Chinese / English)

- `ui/i18n/L10n.kt`: singleton with ~300 keys in paired ZH/EN dictionaries.
- `L10n.current` is a Compose `mutableStateOf` snapshot state — switching language recomposes every reader instantly, **no activity restart**.
- Persisted in SharedPreferences (`layoverjoy_i18n/app_language`), restored in `Application.onCreate` via `L10n.init(context)`.
- Switch control: Material3 `SingleChoiceSegmentedButtonRow` in the **Me tab** (profile.language).
- Placeholder format `{1}/{2}` via `L10n.t(key, args...)`; missing EN keys fall back to ZH, then to the key itself.
- Enum-like labels (funnel statuses, confidence, risk flags, passport/visa types) are stored as **code → i18n-key maps**; only codes cross the wire to the backend.

## 7. Testing

- Backend: unit tests per module (rule engine, scoring, state machine transitions, webhook idempotency) + integration tests against a throwaway Postgres via docker compose.
- Android: debug build via Gradle (`assembleDebug`); manual smoke across the four journeys (§6).
- Full-chain smoke verified locally: register → wallet → search → plan → monitor → booking (including PARTIAL_ORDER compensation).

## 8. Deployment: Daytona Sandbox (native-process scheme)

Docker-in-Docker is **not usable** on this Daytona account (bare `docker:*-dind` images don't receive the Daytona Agent → `fork/exec /bin/sh` failures; disk quota 10 GB). The deploy therefore runs everything natively inside the default Debian snapshot.

`infra/daytona/deploy-demo.ts` (7 steps):

1. Get/create sandbox `layoverjoy-demo` (default snapshot: Debian 13, passwordless sudo, Node preinstalled). **Never call `start()` on an already-started sandbox.**
2. `sudo apt-get install postgresql redis-server build-essential python3`.
3. Start Redis (`--daemonize yes`) + PostgreSQL (`service postgresql start`); idempotently create role `layoverjoy` and database `layoverjoy`.
4. Upload backend sources (package.json/lock, tsconfig, nest-cli, `src/`, `prisma/`).
5. `npm ci` → `prisma generate` → `nest build`; write runtime `.env` (secrets + `DATABASE_URL`, `REDIS_URL`, `NODE_ENV=production`, `RUNTIME_TARGET=daytona`, `PORT=8080`) and `start.sh` (`set -a; . ./.env; set +a; exec node dist/$1.js`).
6. `prisma db push` + seed; `nohup ./start.sh api` and `nohup ./start.sh worker`.
7. Poll `http://127.0.0.1:8080/v1/health`, then print `getPreviewLink(8080)` — the only public port; PG/Redis listen on loopback only.

Known pitfalls baked into the script:

- **Agent readiness**: `echo ready` retry loop (20×5 s) after create/start.
- **Transient `fork/exec /usr/bin/zsh` errors**: command-level retry (5×5 s); these are Agent-not-ready signals, not real missing shells.
- **cwd must exist**: early commands run with `cwd=undefined` — pointing at a not-yet-created directory breaks the Agent's shell spawn.
- `DAYTONA_*` variables are kept out of the app runtime env (only app secrets are injected).

Run:

```bash
cd project/infra/daytona && npm install
set -a; . ../../../.secrets/layoverjoy.env; set +a
npm run deploy:demo
```

The printed Preview URL is the Android backend URL (Me tab → server address). If the preview is token-protected, requests need `X-Daytona-Preview-Token` (configure at runtime; never bake into the APK).

## 9. Security Notes

- Secrets only in `.secrets/layoverjoy.env` (gitignored); deployment scripts never log secret values.
- Webhook endpoints authenticate via per-user shared tokens; events stored idempotently.
- No PII beyond minimal document metadata; Nosana/Daytona payloads are de-identified plan data.
- All money-path endpoints are simulation-only and explicitly labelled in responses/UI.
