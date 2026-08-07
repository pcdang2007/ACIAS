# ACIAS - AI Classroom Interaction Analytics System

An end-to-end implementation of the **Artificial Intelligence-Based Student Interaction Analytics System** described in `prompt.md`. The system collects, analyzes, and evaluates student interaction levels in the classroom through computer-vision style pipelines, speech/command recognition, and a scoring model that suggests which student to call next.

## Architecture

```
Presentation (React) ── REST API / WebSocket / SSE ──► Backend (Node.js/Express)
                                                        ├─ Business Services
                                                        ├─ AI Engine (audio + vision pipelines)
                                                        ├─ SQLite (node:sqlite, no native deps)
                                                        └─ File Storage (uploads)
```

The six spec layers map as:

| Layer | Implementation |
|---|---|
| Presentation | `frontend/` - React 18 + Vite + Recharts |
| Application | `backend/src/routes/` - users, classes, questions, sessions |
| AI Processing | `backend/src/ai/` - audio & vision pipelines (pluggable provider, `mock` built-in) |
| Business Logic | `backend/src/services/` - scoring, analytics, reports, import |
| Data Access | `backend/src/db/database.js` (SQLite) |
| Storage | SQLite database file + local `storage/` folder |

## Project structure

```
backend/
  src/
    server.js            Express app, REST, WebSocket, SSE, uploads
    config.js
    db/schema.js         Full schema for all entities
    db/database.js       SQLite wrapper (built-in node:sqlite)
    db/seed.js           Demo data + RBAC roles/permissions
    middleware/auth.js   JWT auth + permission/role guards
    middleware/audit.js  Audit logging
    ai/audio.js          VAD -> ASR -> command -> question match
    ai/vision.js         Person -> seat -> pose -> hand -> fingers -> answer
    ai/engine.js         Live session simulator + realtime events
    services/scoring.js  X'/Y'/Z' prioritization model (spec §III.C)
    services/analytics.js Key indicators, trends, auto-detection (spec §IV)
    services/report.js   Period reports (lesson/day/week/month/semester/year)
    services/importer.js Excel/CSV student import
    services/hub.js      In-process event bus -> WebSocket/SSE
    routes/              REST endpoints (see below)
frontend/
  src/
    App.jsx              Layout + role-based navigation
    pages/               Dashboard, Students, Classes, Seats, QuestionBank,
                         Lessons, Sessions, SessionLive, Attendance, Reports,
                         Statistics, Appeals, Users, Roles, Devices, Audit, Subjects, Profile
    api/client.js        fetch wrapper + WebSocket helper
```

## Quick start

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`; tested on Node 24). No native compilation is required.

```bash
# 1. Backend
cd backend
npm install
npm run seed        # create + populate SQLite database (data/acias.db)
npm start           # http://localhost:4000

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev         # http://localhost:5173  (proxies /api and /ws to backend)
```

Open `http://localhost:5173`.

## Demo accounts

| Role | Username | Password |
|---|---|---|
| Admin | `admin` | `admin123` |
| Subject teacher | `teacher.math` | `password123` |
| Homeroom teacher | `teacher.homeroom` | `password123` |
| Student | `hs001` | `password123` |
| Parent | `parent.hs001` | `password123` |
| Guest | `guest` | `guest123` |

## Feature walkthrough

1. **Students / Classes / Seating** - manage classes and students; import an `.xlsx/.csv` roster; build a seating chart and move students (with seat-change history).
2. **Question Bank** - multiple choice, true/false, short answer; difficulty, duration, points, and **voice-recognition keywords** used by the audio pipeline.
3. **Lessons → Sessions** - create a lesson, start a session from it, then open the **Live view**.
4. **Live session** - "Ask a question" (from the bank or custom) and choose a recognition mode:
   - `1` fingers → A/B/C/D, `2` fingers + left/right hand, `3` hand-raise + prioritization.
   - The AI engine (mock provider) streams simulated vision/audio events; answers, reaction times, and correctness appear in real time over WebSocket.
   - **Run prioritization (X′/Y′/Z′)** ranks students using the spec §III.C formula.
5. **Statistics** - participation rate, correct-answer rate, response time, activeness, interaction level, speech frequency, stability index, trends, and automatic detection of low-interaction / consistently-incorrect / declining / outstanding students.
6. **Reports** - generate per lesson/day/week/month/semester/school-year for class/student/global; export CSV; students/parents can appeal a report.
7. **Admin** - users, roles & permissions (RBAC), subjects, devices (webcam/IP cam/smartphone/USB mic), audit logs.

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/me`, `PUT /api/auth/me/profile`, `POST /api/auth/change-password` |
| Users / Roles | `/api/users`, `/api/roles`, `/api/roles/permissions` |
| Classroom | `/api/classes`, `/api/students`, `/api/students/import`, `/api/seats`, `/api/seats/move` |
| Teaching | `/api/subjects`, `/api/questions`, `/api/questions/banks`, `/api/lessons` |
| Sessions | `/api/sessions`, `/api/sessions/:id/start`, `/end`, `/live`, `/api/sessions/:id/questions` |
| Live AI | `/api/ai/audio`, `/api/ai/vision`, `/api/ai/suggestions`, `/api/ai/simulator/start` |
| Analytics | `/api/statistics/indicators`, `/trend`, `/detect`, `/student/:id` |
| Reports | `/api/reports/generate`, `/api/reports/:id`, `/api/reports/:id/export` |
| Misc | `/api/attendance`, `/api/answers`, `/api/interactions`, `/api/appeals`, `/api/devices`, `/api/audit` |

Realtime: `ws://localhost:4000/ws` (WebSocket) and `GET /api/events` (SSE).

## Security

- **RBAC** role model (`roles` + `role_permissions`) enforced by `requirePermission` middleware; access is also scoped by class/student for teachers, parents, and students.
- Passwords hashed with **bcrypt**; sessions via **JWT**; disabled accounts blocked at login.
- Every state change is written to the **Audit Log** with actor, IP, and payload.
- Seat tracking is preferred over facial recognition to minimize biometric data (per spec §III.B).

## Scoring model (spec §III.C)

For each question the system computes per-student `X'` (participation), `Y'` (capability), `Z'` (reaction speed) normalized into `[0,1]`:

```
X'_i = (max(X) - X_i) / (max(X) - min(X))
Y'_i = (Y_i - min(Y)) / (max(Y) - min(Y))
Z'_i = (max(Z) - Z_i) / (max(Z) - min(Z))

S_i = α·Z'_i + β·X'_i + γ·(A/A_max)·Y'_i + δ·((1-A)/A_max)·(1-Y'_i)
```

Default weights `α=0.3, β=0.3, γ=0.2, δ=0.2`; `A` is the question's points, `A_max` the maximum points. Higher question value favors capable, fast students; easy questions favor lower-ability and less-participating students. Weights are configurable per request (`/api/ai/suggestions?alpha=...&beta=...`).

## Notes on the AI engine

The pipelines implement the exact stage sequences from the spec, but the underlying CV/ASR providers are **simulated (`mock`)** so the whole system runs offline with zero heavy dependencies. The stage interfaces (`ai/audio.js`, `ai/vision.js`) are designed to be swapped for real providers (e.g., Whisper, MediaPipe) behind the same API.
