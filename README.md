# Bodhi Family Clinic: Queue & Token System

## Run
```
# backend (http://localhost:3001)
cd backend && npm install && npm start
npm test            # replays every example in data/clinic.json + edge cases
# frontend (http://localhost:5173, proxies /api to :3001)
cd frontend && npm install && npm run dev
```
Screens: `#/reception`, `#/doctor`, `#/display` (open the last one full-screen on the TV).

## How the queue logic works
All logic is in `backend/src/engine.ts` and is pure: every method takes `now` as an argument, so there is no hidden clock.
- **Time in tests:** the API reads `X-Now: <ISO time>` (ignored when `NODE_ENV=production`), otherwise uses the real clock. The replay test calls the engine directly with each event's `at`.
- **Check-in:** emergency → `E`; appointment checked in ≤ 15 min after its time (exactly 15 is on time) → `A`; otherwise `W`. Counters are per letter and per Kathmandu day (UTC+05:45 offset applied before taking the date).
- **`pick()`** implements rules 3 and 4 once. It is used both by *Call next* and by *GET /api/queue*, so the queue is literally "what would happen if doctors kept pressing Call next". The queue simulation removes each picked patient, records the rule used and repeats, with the clock frozen.
- **Fairness:** the engine remembers the rule behind the last 3 non-emergency calls (both doctors). If all 3 were "due appointment" and a walk-in waits, the walk-in is picked instead.
- **No-show:** first time → patient becomes a walk-in (keeps token, check-in time = no-show time, age priority still applies); second → removed.
- **Wait estimate:** `floor(position / doctors) × 12` (from `averageConsultationMinutes`).
- **Concurrency:** Node runs each request handler synchronously, and a call is a single synchronous read-modify-write, so two simultaneous Call nexts are serialised and cannot get the same patient.
- **Persistence:** the full state is written to `backend/state.json` (atomic rename) after every change and reloaded at start.
- **API errors:** 400 validation, 404 unknown doctor, 409 call-next while busy / done or no-show with no patient. Extra endpoint: `GET /api/doctors`.

## Decisions I made
- An emergency who is marked no-show goes back as a walk-in too (rule 5 doesn't exempt them); they keep their E token.
- `appointmentTime` must include a UTC offset; the form submits it as Kathmandu time.
- A no-show's earlier call still counts in the fairness history (it was a real call).
- Emergency is a flag, so it works with either kind.

## Frontend
Polling every 2 s (1.5 s on display) keeps the old data while refreshing, so nothing flickers. On a failed poll, the TV shows "Server unavailable" instead of the old queue; other screens show an error banner. A newly called token pulses for 8 s.

## AI use
Generated with Claude (Anthropic) from the brief. I'd review each file before the interview.

## Not done / with more time
- No HTTP-level tests (supertest) or frontend tests; only the engine is tested.
- Polling instead of SSE/WebSockets; no authentication for doctor actions; no multi-clinic support.
- A real DB (SQLite) instead of a whole-state JSON file; history/audit of calls.
- Frontend styling is basic, and I haven't browser-tested it beyond a successful build.
