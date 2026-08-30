# LayoverJoy — Product Definition

> Turn a layover into a second destination.
> Hackathon MVP · Android app + cloud backend · fares and test bookings run against the Atlas **Sandbox** (test data, clearly labelled, no real charges).

---

## 1. One-line Summary

LayoverJoy is a travel agent that finds **stopover cities worth leaving the airport for**: it checks your entry eligibility from the minimum document metadata you provide, searches both flight legs, scores each candidate with a **JoyScore**, streams an AI value narrative per plan, and lets you monitor prices or complete an **Atlas Sandbox test booking** (real upstream order → pay → ticketing flow with test data and test PNR/ticket numbers — never real charges).

## 2. Problem

- Direct flights are optimized for speed, not experience. Many travellers would happily spend 1–3 days in a transit city — if only they knew it was legally possible and actually fun.
- Entry rules (visa-free, transit passes, e-visas) are scattered and hard to verify per nationality/passport type.
- Booking two separate legs feels risky; nobody explains the trade-offs or offers compensation flows when something fails.

## 3. Target User

Curious travellers (primarily Chinese-passport holders in the MVP demo data) who:

- Have a fixed final destination and flexible dates around it;
- Can spend 1–5 extra days in transit;
- Care about *experience value*, not just the cheapest fare.

## 4. Core Product Principles

1. **Privacy-first document handling.** We never ask for passport numbers, names or document photos. Only the minimum needed for eligibility checks: issuing country, document/visa type, validity period. Sandbox test orders use fictional passengers only (e.g. `TEST/TRAVELER`); real passenger data never reaches the Sandbox.
2. **Honest Sandbox.** All fares come from the Atlas **Sandbox** environment and are labelled as such. Bookings execute the real upstream Sandbox order → payment → ticketing chain with test balances and test PNR/ticket numbers; refunds have no upstream API and are simulated, explicitly labelled. Production ticketing/payment is permanently disabled by configuration gates.
3. **Explainable decisions.** The funnel shows why cities were kept or dropped; every plan carries eligibility evidence (rule ID + version + verified-at + official source).
4. **No silent retries on money paths.** Order creation and payment never auto-replay; unclear results are resolved by querying order status only. Payment requires a one-time confirmation bound to the exact amount shown.

## 5. Key Concepts

| Concept | Meaning |
|---|---|
| **Stopover plan** | Origin → stopover city → destination, split into two separately ticketed legs, with a stay of N days in between. |
| **JoyScore (0–100)** | Composite of usable play hours, fare delta vs. direct baseline, destination experience quality (curated city packs) and user interest match. |
| **Eligibility funnel** | Per-candidate pipeline: candidate → eligible/ineligible/needs-info → flight inventory → experience filter → plan produced. |
| **Direct baseline** | Best bookable direct fare used as the reference for fare deltas. |
| **Dual-order booking** | Leg B (higher inventory risk) is ordered first, then Leg A; a partial failure moves the booking to manual handling / simulated compensation (developer-triggered only, hidden from the main demo). |
| **Sandbox test booking** | Real upstream Sandbox order → explicit payment confirmation → balance pay → ticketing with test PNR/ticket numbers; offers expire (~minutes) and stale quotes are never bookable. |
| **One-time payment confirmation** | Backend-issued token bound to user, order, amount, currency and environment generation; single use; never sent to Atlas. |

## 6. User Journeys

### 6.1 First launch
Register/sign in → Onboarding (3 steps):
1. **Document basics** — issuing country, passport type, expiry (never the number);
2. **Existing visas** — tick any valid visas to unlock more transit cities;
3. **Interests** — food / nature / museums / shopping / nightlife / old town / family, plus red-eye tolerance.

### 6.2 Explore & decide
Enter origin, destination, dates, stay range, optional fare-delta budget → the agent:
- Verifies entry rules per candidate city against the user's document wallet;
- Searches both legs via the Atlas Sandbox adapter;
- Computes JoyScore and returns an ordered plan list with the funnel explanation.

Plan detail shows: leg schedule, cost breakdown with confidence labels (confirmed / sandbox quote / estimate / rule-based), a **streaming AI value narrative** (productized analysis progress → incremental sections; Nosana GPU inference with a same-structure template fallback), curated city pack, and eligibility evidence with localized status summaries.

### 6.3 Watch
Set a target fare (and/or minimum JoyScore) → backend checks every 5 minutes → in-app + optional email notification only when the target is hit.

### 6.4 Book (Sandbox test booking)
Risk acknowledgement → Verify (re-verified immediately before ordering; any price increase requires explicit re-confirmation of the new total) → orders placed with fictional test passengers → payment summary (legs, total, currency, pay-by deadline, Sandbox badge) with an exact-amount confirm button → Sandbox balance payment → bounded ticketing poll (≤120 s) surfacing test PNR/ticket numbers. Entry-eligibility verdicts other than ELIGIBLE are shown as a non-blocking risk notice; final admission always rests with border/airline authorities. The dual-order compensation drill (leg-B failure injection + simulated refund) is a developer-page capability only and is not part of the judge-facing journey.

## 7. Feature Inventory (MVP scope)

| Area | Shipped |
|---|---|
| Auth | Email + password register/login, JWT sessions |
| Document wallet | Passports & visas, minimal fields, primary passport, delete |
| Entry rules engine | Rule snapshots with version, effective window, official source; eligibility verdicts with evidence |
| Search orchestration | Candidate generation → eligibility → dual-leg search → JoyScore → plans; polling-friendly status API |
| JoyScore | Transparent breakdown components shown on plan cards and detail |
| Explanations | Streaming Nosana GPU inference (SSE backend → incremental Android rendering) + deterministic same-structure template fallback |
| City packs | Curated attractions/areas/tips per stopover city (demo content) |
| Price monitors | Target fare / min JoyScore triggers, pause/resume/stop, 5-minute cadence |
| Notifications | In-app center + optional email channel; bilingual (ZH/EN) titles & bodies per language; kinds: price / booking / refund / system |
| Booking state machine | per-leg: verified → price-confirmation → ordered → payment-confirmation → pay-submitted → paid → ticketing-pending → ticketed; partial → manual handling / simulated refund; unclear → query-only |
| Atlas Sandbox booking | Real upstream order/pay/ticketing with test data; one-time payment confirmations; offer-expiry gates; environment generation invalidation |
| Atlas webhook | Order-status webhook ingestion with shared-token auth |
| i18n | Full in-app Chinese/English switching (Me tab), persisted, no restart required; backend error codes mapped to localized copy client-side (raw backend messages never rendered) |

## 8. Non-goals (explicitly out of scope)

- Production ticketing / production payment / real refunds (Sandbox test orders only; refunds simulated and labelled).
- Collecting passport numbers, names, document photos.
- Real-time push notifications (polling model in MVP).
- Multi-currency conversion accuracy guarantees (display currencies come from the Sandbox quotes).

## 9. Success Metrics (demo-oriented)

- End-to-end demo completes in < 3 minutes: search → plan detail → monitor or booking.
- 100% of money-path actions honestly labelled (simulated, or Atlas Sandbox test transaction).
- Eligibility evidence (rule + version + source) present on every produced plan.
- Language switch takes effect instantly across all screens.

## 10. Privacy Statement (as shown to users)

- We store only issuing country, document/visa type and validity — never numbers, names or photos.
- Flight quotes and test bookings run against the Atlas Sandbox environment; test PNR/ticket numbers are encrypted at rest and no real charges occur.
- Nosana and Daytona receive de-identified plan data only; no personal identifiers are transmitted.
