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
| `bookings` | Dual-order state machine, verify/order/pay/refund mocks | `POST /api/orders/composite`, `POST /api/orders/:id/mock-pay`, `POST /api/orders/:id/mock-refund`, `POST /api/orders/:id/simulate-leg-b-failure`, `GET /v1/bookings`, `GET /v1/bookings/:id` |
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
DRAFT → BOTH_VERIFIED → [booking-time eligibility re-check] → LEG_B_ORDERING → LEG_B_ORDERED →
LEG_A_ORDERING → BOTH_ORDERED → PAYMENT_PENDING → COMPLETED
                    ↘ PARTIAL_ORDER → (compensation) → SIMULATED_REFUND_PENDING → SIMULATED_REFUNDED
re-check fails → EXPIRED (BOOKING_ELIGIBILITY_FAILED); no order placed at all → MANUAL_REVIEW
any unclear result → query status only; never auto-retry
```

- Order creation order is intentional: **Leg B first** (higher inventory risk), then Leg A. Status is driven by the actual set of successfully ordered legs (`orderedLegs`), never optimistically.
- `legBFailure=true` (demo injection on `composite`): after the stopover leg (leg 2) is ordered successfully, leg 1 fails with `INVENTORY_CHANGED` → `PARTIAL_ORDER` with `details.{intentId, failedLeg, providerCode}` on the `PARTIAL_BOOKING` error.
- A booking-time eligibility re-check (mode `BOOKING`, onward ticket confirmed) runs before ordering; failure aborts honestly.
- Demo injection for payment: header `X-Demo-Pay-Result: FAIL` on `mock-pay` forces leg-1 payment to fail (Mock payment provider only) — driven by the Android hidden dev-page toggle, stored locally only. Refund (`mock-refund`) closes out any partial/complete state.
- Passenger given/family names are AES-encrypted at rest (`passengerJson: {givenNameEnc, familyNameEnc}`); order numbers stored encrypted with only last-4 exposed.

### 3.3 JoyScore

`joyScore = clamp(usable-hours component + fare-delta component + city-experience component + interest-match component)`; breakdown returned per component with points so the UI can render the composition transparently. Interests are counted only (semantic-stable codes sent by the client).

### 3.4 Eligibility engine (two-stage, fail-closed)

- `mode: 'SEARCH_SCREEN'`: search-time pre-screening. Missing onward-ticket confirmation does **not** block, but results are marked `provisional: true` with `ONWARD_TICKET_PENDING_VERIFY` — never reported as confirmed.
- `mode: 'BOOKING'` (default): hard decision before ordering. `onwardTicketConfirmed !== true` → `NEEDS_INFO` (fail-closed); the client can never fake confirmation.
- Visa checks: missing expiry → `VISA_EXPIRY_MISSING` (NEEDS_INFO); expired → `VISA_EXPIRED` (INELIGIBLE). No document on file → fail-closed, surfaced in the funnel with honest reason codes.

### 3.5 Atlas Sandbox contract (verified against the real API)

- Requests must send `Accept-Encoding: gzip` (otherwise `status=102`). Business success is `status === 0` inside an HTTP 200 body.
- Search payload: `{tripType:"1", requestId, adultNum, childNum, infantNum, fromCity, toCity, fromDate:"YYYYMMDD", currency, includeMultipleFareFamily}`; response `routings[]` keyed by `routingIdentifier` (used for verify), prices in `adultPrice/adultTax/transactionFee`.
- Verify payload: `{routingIdentifier}`; response top-level `{sessionId, maxSeats, routing, bookingRequirement, priceChange.isPriceChange}`.
- Anonymized real captures archived in `backend/test/fixtures/atlas/` (captured 2026-08-29).

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
- Optional with defaults: `ATLAS_*` (Sandbox base URL/keys), `NOSANA_*` (inference; falls back to template when unset — `NOSANA_TIMEOUT_MS` defaults to 90000 since qwen3.5:9b inference can reach ~60 s; `NOSANA_DEPLOYMENT_ID` is shown as a tail in the UI), `SMTP_*` (email channel), `REDIS_URL`, `RUNTIME_TARGET`.
- Masked placeholder secrets (`•••`, `REPLACE_ME`) are detected by `isMaskedSecret()` and treated as unconfigured.
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
- Network: Retrofit + kotlinx.serialization; session in DataStore (`SessionStore`); OkHttp `Authenticator` performs refresh-token rotation on 401 (concurrency-safe, new token pair persisted); read timeout is 120 s to cover 90 s Nosana inference.
- Screens: guest-first boot — Main(bottom tabs: Home / Explore / Trips / Me) immediately, with stack routes for Login, Results, PlanDetail, MonitorSetup, BookingFlow, Notifications, Documents. Identity-requiring entries (Explore/Trips tabs, document wallet) pop up the Login screen; after sign-in, first-time users complete Onboarding(3 steps) and are routed back to the blocked target automatically. Onboarding document upload failures are shown explicitly with retry/skip — never silent (the eligibility engine is fail-closed without document data).
- Home screen is **fully local** (`LocalDemoData`) — curated city cards, no upload of real documents; the Me tab works for guests (language switching).
- Backend selection is **hidden from end users**: default is the local Docker server `http://127.0.0.1:8080`; double-tapping the Me-tab title opens a hidden Developer Settings page offering "Local" vs "Remote official server" (Daytona Preview URL, with an editable `X-Daytona-Preview-Token` field — the token is **never baked into the APK**, entered by hand at demo time; injected by an OkHttp interceptor); the choice persists in DataStore. The same page hosts the **payment-failure simulation toggle** (local-only): when on, pay requests carry `X-Demo-Pay-Result: FAIL` so the demo can show both success and compensation outcomes.
- Plan explanations show honest provenance: Nosana results render model id, inference latency and deployment id tail; template fallbacks are labelled as such.

### 6.1 In-app i18n (Chinese / English)

- `ui/i18n/L10n.kt`: singleton with ~300 keys in paired ZH/EN dictionaries.
- `L10n.current` is a Compose `mutableStateOf` snapshot state — switching language recomposes every reader instantly, **no activity restart**.
- Persisted in SharedPreferences (`layoverjoy_i18n/app_language`), restored in `Application.onCreate` via `L10n.init(context)`.
- Switch control: Material3 `SingleChoiceSegmentedButtonRow` in the **Me tab** (profile.language).
- Placeholder format `{1}/{2}` via `L10n.t(key, args...)`; missing EN keys fall back to ZH, then to the key itself.
- Enum-like labels (funnel statuses, confidence, risk flags, passport/visa types) are stored as **code → i18n-key maps**; only codes cross the wire to the backend.

## 7. Testing

- Backend: vitest unit tests — `rule-engine.spec.ts` (10 cases: two-stage modes, visa expiry, provisional flags) and `bookings-saga.spec.ts` (4 cases: happy path, leg-1 failure after leg-2 ordered, no-order failure → MANUAL_REVIEW, injection semantics). Run: `npx vitest run`.
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
6. `prisma db push` + seed; `nohup ./start.sh main` and `nohup ./start.sh worker`.
7. Poll `http://127.0.0.1:8080/v1/health`, then print `getPreviewLink(8080)` — the only public port; PG/Redis listen on loopback only.

Known pitfalls baked into the script:

- **Agent readiness**: `echo ready` retry loop (20×5 s) after create/start.
- **Transient `fork/exec /usr/bin/zsh` errors**: command-level retry (5×5 s); these are Agent-not-ready signals, not real missing shells.
- **cwd must exist**: early commands run with `cwd=undefined` — pointing at a not-yet-created directory breaks the Agent's shell spawn.
- **`/workspace` not writable** by the default user: create the workdir with `sudo mkdir && sudo chown`.
- **`fs.uploadFile` is file-only** (EISDIR on directories): the script uses a recursive upload helper.
- **binaries.prisma.sh is unreachable from the sandbox** (persistent ECONNRESET — even engine binaries fail to download). Engines are therefore downloaded locally (cached in `infra/daytona/engines/`) and uploaded to `/workspace/layoverjoy/engines`. Prisma 5.22 override env vars: library-style query engine uses `PRISMA_QUERY_ENGINE_LIBRARY` (not `_BINARY`) and `PRISMA_SCHEMA_ENGINE_BINARY`; additionally the query engine is copied to `node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node` because the runtime PrismaClient only looks up that fixed filename. Hard gates verify engine presence and table count in the target database (`psql -d layoverjoy`).
- **Entry files**: API is `dist/main.js` (`./start.sh main`), worker is `dist/worker.js`.
- **Re-deploy port conflict**: on an already-running sandbox the previous `node dist/main.js` still holds 8080, so the new process fails with `EADDRINUSE` while health checks keep passing against the *old* code. The script `pkill`s old api/worker processes before start and hard-fails if `/tmp/api.log` contains `EADDRINUSE`.
- **No outbound route to `sandbox.atriptech.com`** from the Daytona sandbox (verified by curl: connection timeout). The deploy therefore overrides `ATLAS_SEARCH_PROVIDER=mock` / `ATLAS_VERIFY_PROVIDER=mock` in the runtime `.env`; the UI honestly shows the provider label (`MOCK`) in search results and booking badges. The real Atlas Sandbox chain is demonstrated from the local/egress-capable environment.
- **No outbound SMTP/Nosana either**: external SMTP hangs and makes pay/refund responses stall until the preview proxy drops the connection (body arrives empty while state still advances server-side). The deploy overrides `MAIL_PROVIDER=console` (emails logged only). Nosana inference falls back to the template provider with an honest UI label (`lastErrorCategory: NETWORK_ERROR` on `/v1/integrations`).
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
