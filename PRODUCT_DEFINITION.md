# LayoverJoy — Product Definition

> Turn a layover into a second destination.
> Hackathon MVP · Android app + cloud backend · all flights are simulated (Atlas Sandbox).

---

## 1. One-line Summary

LayoverJoy is a travel agent that finds **stopover cities worth leaving the airport for**: it checks your entry eligibility from the minimum document metadata you provide, searches both flight legs, scores each candidate with a **JoyScore**, and lets you monitor prices or complete a fully simulated booking.

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

1. **Privacy-first document handling.** We never ask for passport numbers, names or document photos. Only the minimum needed for eligibility checks: issuing country, document/visa type, validity period. The home screen runs entirely on local demo data.
2. **Honest simulation.** All fares come from the Atlas **Sandbox** environment. No real ticketing, no real charges. Every simulated action is clearly labelled.
3. **Explainable decisions.** The funnel shows why cities were kept or dropped; every plan carries eligibility evidence (rule ID + version + verified-at + official source).
4. **No silent retries on money paths.** Order creation and payment never auto-replay; unclear results are resolved by querying order status only.

## 5. Key Concepts

| Concept | Meaning |
|---|---|
| **Stopover plan** | Origin → stopover city → destination, split into two separately ticketed legs, with a stay of N days in between. |
| **JoyScore (0–100)** | Composite of usable play hours, fare delta vs. direct baseline, destination experience quality (curated city packs) and user interest match. |
| **Eligibility funnel** | Per-candidate pipeline: candidate → eligible/ineligible/needs-info → flight inventory → experience filter → plan produced. |
| **Direct baseline** | Best bookable direct fare used as the reference for fare deltas. |
| **Dual-order booking** | Leg B (higher inventory risk) is ordered first, then Leg A; a partial failure triggers the compensation flow instead of silent loss. |

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

Plan detail shows: leg schedule, cost breakdown with confidence labels (confirmed / sandbox quote / estimate / rule-based), Agent recommendation explanation (Nosana GPU inference with a safe template fallback), curated city pack, and eligibility evidence.

### 6.3 Watch
Set a target fare (and/or minimum JoyScore) → backend checks every 5 minutes → in-app + optional email notification only when the target is hit.

### 6.4 Book (simulated)
Passengers (optional) + mandatory risk acknowledgement → Verify + Order for both legs → ~30-minute payment window → mock payment. A demo injection checkbox lets evaluators experience the **PARTIAL_ORDER** path: Leg B fails after Leg A is ordered, payment stops, and a dual-order compensation (mock refund) resolves the booking.

## 7. Feature Inventory (MVP scope)

| Area | Shipped |
|---|---|
| Auth | Email + password register/login, JWT sessions |
| Document wallet | Passports & visas, minimal fields, primary passport, delete |
| Entry rules engine | Rule snapshots with version, effective window, official source; eligibility verdicts with evidence |
| Search orchestration | Candidate generation → eligibility → dual-leg search → JoyScore → plans; polling-friendly status API |
| JoyScore | Transparent breakdown components shown on plan cards and detail |
| Explanations | Nosana GPU inference endpoint + deterministic template fallback |
| City packs | Curated attractions/areas/tips per stopover city (demo content) |
| Price monitors | Target fare / min JoyScore triggers, pause/resume/stop, 5-minute cadence |
| Notifications | In-app center + optional email channel; kinds: price / booking / refund / system |
| Booking state machine | draft → verified → ordering → ordered → payment_pending → completed / partial_order → refund_pending / refunded / manual_review / expired |
| Atlas webhook | Order-status webhook ingestion with shared-token auth |
| i18n | Full in-app Chinese/English switching (Me tab), persisted, no restart required |

## 8. Non-goals (explicitly out of scope)

- Real ticketing / real payment / real refunds (Sandbox only).
- Collecting passport numbers, names, document photos.
- Real-time push notifications (polling model in MVP).
- Multi-currency conversion accuracy guarantees (display currencies come from the Sandbox quotes).

## 9. Success Metrics (demo-oriented)

- End-to-end demo completes in < 3 minutes: search → plan detail → monitor or booking.
- 100% of money-path actions labelled as simulated.
- Eligibility evidence (rule + version + source) present on every produced plan.
- Language switch takes effect instantly across all screens.

## 10. Privacy Statement (as shown to users)

- We store only issuing country, document/visa type and validity — never numbers, names or photos.
- Flight quotes come from the Atlas Sandbox simulated environment; no real ticketing or charges occur.
- Nosana and Daytona receive de-identified plan data only; no personal identifiers are transmitted.
