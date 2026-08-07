# Action Log - ACIAS Project Build

Documentation of the actions taken to build the **AI Classroom Interaction Analytics System (ACIAS)** from `prompt.md`.

## 1. Environment analysis
- Read `prompt.md` and extracted the full requirements: 6-layer architecture, 5 functional subsystems (users, classrooms, question bank, sessions, AI), the X′/Y′/Z′ scoring model, analytics indicators, entity list, business processes, deployment architecture, and security mechanisms.
- Verified the toolchain: Node v24.16.0, npm 11.13.0, empty project folder.
- Tried `better-sqlite3` first; its install failed because no prebuilt binary exists for Node 24 on win32 and Visual Studio C++ build tools are unavailable on the machine.
- **Decision:** switched to Node's **built-in `node:sqlite` module** (verified working) — a real SQLite database with zero native compilation. Also upgraded `multer` to v2 (v1 has known CVEs).

## 2. Backend build (`backend/`)
- **package.json + config**: Express, cors, bcryptjs, jsonwebtoken, ws, multer, xlsx.
- **Database layer**: full SQL schema (`src/db/schema.js`) covering every entity group from the spec — `roles`, `permissions`, `role_permissions`, `users`, `classes`, `students`, `subjects`, `question_banks`, `questions`, `lessons`, `devices`, `sessions`, `session_questions`, `seats`, `seat_history`, `answers`, `interactions`, `attendance`, `reports`, `appeals`, `audit_logs`, `statistics`. Wrapper in `src/db/database.js`.
- **Seed data** (`src/db/seed.js`): the RBAC model from the spec (Admin [0], Homeroom Teacher [1a], Parent [1b], Subject Teacher [2], Student [3], Guest [4]), permission matrix per role, 6 subjects, 3 classes, 17 students with linked user/parent accounts, 2 question banks with 9 questions (all 3 types), 2 lessons, 2 devices, and a full seating chart for class 10A1. Fixed two seed bugs (`class_id`/`parent_user_id` columns) and a login bug (missing `status` column in the login query).
- **Middleware**: JWT auth, permission guards, role guards, class/student-level access control, and an audit logger.
- **Routes** for all entities, incl. `POST /api/students/import` (Excel/CSV), `POST /api/seats/move` (seat-change history), session start/end with live summary, session-question answers & X′/Y′/Z′ suggestions, report generation with CSV export, attendance auto-marking, and appeals.
- **AI engine** (`src/ai/`): implemented both pipelines as structured stages —
  - Audio: Voice Activity Detection → Speech Recognition → Command Recognition → Question Matching (by keywords).
  - Vision: Person Detection → Seat Tracking → Pose Estimation → Hand Detection → Finger Counting → Answer Recognition (mode 1/2/3).
  - `src/ai/engine.js` runs a live simulator that streams interactions/answers/reaction-times for an open session question and closes questions after their duration. Providers are pluggable (`mock` built-in).
- **Scoring service** (`src/services/scoring.js`): literal implementation of the §III.C formulas with configurable α, β, γ, δ.
- **Analytics service** (`src/services/analytics.js`): participation rate, correct-answer rate, response time, activeness, interaction level, speech frequency, stability index, per-session/day/week/month trends, and auto-detection of low-interaction / consistently-incorrect / declining / outstanding students.
- **Real-time**: WebSocket server (`/ws`) + SSE (`/api/events`) fed by an in-process event bus; the dashboard and live-session page consume it.

## 3. Frontend build (`frontend/`)
- Vite + React 18 + react-router-dom + recharts.
- **API client** with JWT storage, file upload helper, and a WebSocket helper.
- **Auth context** powering role-based navigation.
- **17 pages**: Login (with demo-account quick fill), Dashboard (live KPI cards + realtime AI event ticker), Students (CRUD + Excel/CSV import), Classes, Seating Chart (grid map + seat-change history), Question Bank (banks, 3 question types, difficulty/duration/points/voice keywords), Lessons, Sessions, **Session Live** (ask a question, recognition modes, live stats, X′/Y′/Z′ ranking, answers table, realtime stream, auto-attendance), Attendance, Reports (generate + view + CSV export), Statistics (indicators, trend chart, auto-detection, per-student detail), Appeals, Users, Roles & Permissions, Devices, Audit Logs, Subjects, Profile.

## 4. Verification
- `node:sqlite` capability check.
- Backend smoke tests over HTTP: login, classes, statistics indicators, X′/Y′/Z′ suggestions, report generation.
- Full end-to-end live-session test: created a session → added a question → started the AI simulator → collected answers over time (8 answers, 75% correct) → computed rankings → auto-attendance for 12 students → indicators/report/detection all returned correct data.
- Frontend production build succeeded (629 kB bundle, warning only about chunk size).
- Proxy test through Vite: `http://localhost:5173/api/*` reaches the backend; frontend serves HTTP 200.
- Fixed a report-export bug (download now authenticates via `?token=` query) and cleaned up the Statistics page.

## 5. Final deliverables
- `README.md` - architecture, structure, quick-start, demo accounts, walkthrough, API table, security notes, scoring model, AI engine notes.
- This `action.md`.
- Freshly seeded database for a clean demo state.

## Conventions / trade-offs
- **SQLite without native modules** — uses Node's built-in `node:sqlite` to guarantee installation on machines without build tools.
- **AI providers are simulated** — the exact pipeline stage order and interfaces are implemented and wired end-to-end; real CV/ASR models can replace the `mock` provider behind the same API.
- **Backend-first verification** — every feature was exercised over HTTP before wiring the UI.
