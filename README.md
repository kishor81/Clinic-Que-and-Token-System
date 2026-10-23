# Bodhi Family Clinic: Queue & Token System

A simple patient queue management system for Bodhi Family Clinic. It assigns tokens, manages patient queues, helps doctors call patients, and displays queue updates on a TV screen.

## 1. How to Run the Project

### Start the Backend

```bash
cd backend
npm install
npm start
```

Backend URL: http://localhost:3001

### Start the Frontend

Open a new terminal and run:

```bash
cd frontend
npm install
npm run dev
```

Frontend URL: http://localhost:5173

### Run Tests

```bash
cd backend
npm test
```

The tests replay examples from `data/clinic.json` and check additional edge cases.

## 2. Available Screens

- **Reception (`#/reception`):** Register and check in patients.
- **Doctor (`#/doctor`):** Call the next patient and manage consultations.
- **Display (`#/display`):** Show the current queue on a TV. Open this screen in full-screen mode.

## 3. How the Queue Works

- **Emergency patients:** Receive an `E` token and priority.
- **Appointments:** Receive an `A` token if checked in within 15 minutes after the appointment time, including exactly 15 minutes.
- **Walk-in patients:** Receive a `W` token if they do not qualify for an appointment token.
- **Daily tokens:** Counters are maintained separately for each token type and reset according to Kathmandu's local date.
- **Call Next:** The system automatically selects the next patient according to the queue rules.
- **Fairness:** If the last three non-emergency calls were for due appointments and a walk-in is waiting, the next patient will be a walk-in.
- **No-show:** The first missed call changes the patient to a walk-in while keeping their token. The second missed call removes them from the queue.
- **Waiting time:** Estimated using queue position, the number of doctors, and the average consultation time of 12 minutes.

Both doctors use the same queue rules.

## 4. Technical Details

### Backend

- Queue logic is implemented in `backend/src/engine.ts`.
- The engine is designed to be predictable and testable because every method receives the current time as an argument.
- During development and testing, the API supports the `X-Now` header for setting a custom time. This is disabled in production.
- Appointment times must include a UTC offset. The frontend uses Kathmandu time.
- The `GET /api/doctors` endpoint returns doctor information.

### Data Persistence

- The system saves its state to `backend/state.json`.
- State is saved after every change and loaded again when the server restarts.
- Atomic file replacement helps prevent partially written state files.

### Concurrency and Errors

- Request handlers process queue updates synchronously, preventing two simultaneous calls from selecting the same patient.
- `400` — Invalid input.
- `404` — Doctor not found.
- `409` — Invalid action, such as calling the next patient while busy or reporting a no-show when no patient is assigned.

## 5. Frontend Features

- Automatic queue refresh every 2 seconds on reception and doctor screens.
- Automatic refresh every 1.5 seconds on the TV display.
- Existing data stays visible while refreshing to reduce flickering.
- The TV displays a "Server unavailable" message if a refresh fails.
- Newly called tokens pulse for 8 seconds to make them easier to notice.

## 6. Design Decisions

- Emergency status is a separate flag and can apply to appointments or walk-ins.
- Emergency patients marked as no-show follow the same no-show rules and keep their `E` token.
- A previous call still counts toward fairness, even if the patient later becomes a no-show.
- Both doctors share the same queue-selection logic for consistent results.



## 8. Limitations and Future Improvements

- Add HTTP API tests using Supertest and frontend tests.
- Replace polling with WebSockets or Server-Sent Events.
- Add authentication to protect doctor actions.
- Replace the JSON state file with a database such as SQLite.
- Add call history and audit logs.
- Support multiple clinics.
- Improve frontend styling and perform thorough browser testing.


