# Bio Attend — Features & implementation plan

> **Product:** Bio Attend — classroom attendance that proves *who* is present (face + liveness) and *where* they are (near-ultrasonic sound heard inside the room).
> **Surfaces:** one responsive website (React) used by teachers and students · one API (Express + MongoDB Atlas) · one small face service (Python).
> **Audience:** anyone building the project. It says exactly what we build, in what order, and how each piece works — student side, teacher side, database, APIs, frontend, backend.
> **Companion files:** `plan.md` (signal design + research decisions) · `progress.md` (build log + measurements) · `agent.md` (how to work: one slice at a time, test before moving on).
> **Decisions locked (2026-10-18):** website only (no native app for now) · college Google sign-in · one bound device per student · ID card + live selfie at first sign-in · face + liveness + sound at every check-in · teacher reviews only unsure cases, same day.

Send this file when someone asks: *what is Bio Attend, how does a class take attendance with it, what is built, and what do we build next?*

---

## Shipped status (honest)

A row is **Shipped** only when it runs today against the real backend. Nothing here has been tested by a full class.

| Phase | Area | Status |
| --- | --- | --- |
| **0** | Local dev setup (Atlas DB, own Google client, env files), tests green | **Shipped** (local) |
| **0** | Security fixes (expired/invalid session → 401, token cookie-only, production CORS allowlist, Windows `start:shared`) | **Shipped** |
| **0** | Hosting: backend on Render, frontend on Vercel (`capstone-7th-sem.vercel.app`, `/api` proxied to Render) | **Shipped** |
| **1** | Google sign-in (college domain + test accounts), roles, roster gate, logout / session check | **Shipped** |
| **2** | Classes, rooms (API), roster CSV preview / save / read | **Shipped** |
| **2** | Standard classroom list (101–112, 201–212, 301–312) seeded via `npm run seed:rooms` | **Shipped** |
| **2** | Room picker grouped by floor, class detail page, single-student add/remove, class edit/archive/restore, CSV preview with row highlighting, student "Your classes" | **Shipped** |
| **3** | Device binding v1 (key per browser + teacher review queue) | **Shipped** |
| **3** | Device binding v2 (signed challenges — proves the phone holds its key; approving one device supersedes the student's other requests) | **Shipped** |
| **4** | Sound lab (sample rate, mic settings, 5-tone margins, < 44.1 kHz refusal, 6 ms fades, live meter) | **Shipped** |
| **4** | FSK codec (encode / decode / checksum), 12 synthetic tests | **Shipped** |
| **4** | Band profiles (high 18.00–19.76 kHz, mid 16.50–18.26 kHz), streaming receiver with **repeat combining**, transmitter, wake lock, `/acoustic-lab/link` | **Shipped** (19/19 codec tests; first phone runs logged) |
| **4** | Phone-to-phone measurements at 1 m / 6 m / far corner → band decision | **Planned** (owner) |
| **5** | Check-in sessions (teacher starts, students hear key, server marks present) | **Planned** |
| **6** | Cascade relay (students re-play the next key to reach the back of the room) | **Planned** |
| **7** | Face service (match + liveness) | **Planned** |
| **8** | Student identity enrollment (ID card + live selfie + teacher verification) | **Planned** |
| **9** | Face + liveness at check-in | **Planned** |
| **10** | Reviews, overrides, same-day queries, daily lock, data retention | **Planned** |
| **11** | Attendance records, reports, CSV export, student history | **Planned** |
| **12** | Neighbour verification (ID round) | **Planned** |
| **13** | Pilot readiness (consent, privacy notice, monitoring, runbook) → live class pilot | **Planned** |
| — | Native mobile app, iOS, multi-college | **Not in v1** |

### Build order — what we build next

Every phase depends **only on phases above it**. Finish and test a phase before starting the next.

| Order | Phase | What | Why this position |
| --- | --- | --- | --- |
| **0** | Foundation | Hosting, env, security fixes | Everything runs on it |
| **1** | Identity & access | Google sign-in, roles, roster gate | Who is who |
| **2** | Teacher workspace | Classes, rooms, rosters | Who belongs to which class |
| **3** | Trusted device | Signed challenges from the student's bound phone | Every later request is signed |
| **4** | Acoustic engine | Play / hear key frames on real phones, choose band | Riskiest technical piece — prove it early |
| **5** | Check-in sessions | Start → hear key → signed claim → present | The core loop (sound only) |
| **6** | Cascade relay | Waves of phones re-play the next key | Covers a 20 m room |
| **7** | Face service | Python service: match + liveness | Needed by 8 and 9 |
| **8** | Identity enrollment | ID card + selfie at first sign-in | Reference face for every check-in |
| **9** | Face at check-in | Random liveness challenge + match | Proves the right person holds the phone |
| **10** | Reviews & lock | Unsure cases, overrides, queries, midnight lock, deletion | Makes it fair and compliant |
| **11** | Records & reports | Attendance matrix, %, CSV, student history | Useful output |
| **12** | Neighbour verification | Phones confirm they heard each other | Stops key forwarding to outside phones |
| **13** | Pilot | Consent, privacy, monitoring, runbook, live class | Delivery |

**Minimum pilot path:** if time is short, a usable pilot needs phases **0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 13**. Phase 11 can ship as "CSV export only" and Phase 12 can run in *record-only* mode.

**Golden rule — the phone collects, the server decides.** A website cannot prove it is unmodified, so the phone never reports "passed". It sends raw evidence (decoded key, signed nonce, camera frames, neighbour reports); the server checks everything and decides *present / review / absent*.

---

## How to read this document

Sections **1–4** explain the product, people, flows and data. Section **5** is the phased plan; each phase has the same parts:

1. **Goal** — what the phase delivers.
2. **Depends on** — earlier phases only.
3. **What users get** — student side and teacher side.
4. **Database** — collections and fields added or changed.
5. **API** — endpoints (method, path, who can call it, request → response).
6. **Backend work** — files to create / change.
7. **Frontend work** — screens and modules.
8. **Rules & edge cases.**
9. **Done when** — tests and checks that close the phase.

Words we use everywhere:

| Word | Meaning |
| --- | --- |
| **Teacher** | College account listed in `TEACHER_EMAILS`; creates classes, starts check-ins, reviews unsure cases |
| **Student** | College account on at least one active class roster |
| **Test student** | Gmail in `TEST_STUDENT_EMAILS`; skips domain + roster gate (development only) |
| **Roster** | List of student emails allowed in a class |
| **Bound device** | The one browser/phone whose secret key is linked to a student |
| **Enrollment** | One-time ID card + live selfie; produces the student's reference face |
| **Check-in session** | One attendance-taking window for one class (default 6 minutes) |
| **Key** | Short-lived secret number minted by the server, sent as sound |
| **Frame** | One key turned into 11 tones (~1.3 s) |
| **Wave** | Wave 0 = teacher's phone plays; wave 1 = phones that heard wave 0 re-play; and so on |
| **Liveness challenge** | Random instructions ("turn left, then blink") proving a live face |
| **Review** | A record the server could not decide; the teacher decides, same day |
| **Lock** | At midnight (IST) a session's records become final |

---

## 1. What the software is

Bio Attend replaces roll call. During the last minutes of class the teacher taps **Start check-in**. Students tap **Join**. Each student's phone **hears** a one-time key played as near-inaudible sound inside the room, then the student does a **3-second face check**. The server marks the student present only if:

1. the key was really heard (correct, fresh, from this session),
2. the request came from the student's **own bound phone** (signed with its secret key),
3. the face is **live** and **matches** the student's verified reference face.

| Question | Answered by |
| --- | --- |
| Is this person a real student of this class? | Google sign-in + roster |
| Is this their own phone? | Device binding + signed challenge |
| Is the phone inside the room? | Sound key (can't travel through walls or over the internet) |
| Is the right person holding it? | Face match + liveness |
| What if the system is unsure? | Teacher review, same day |

### 1.1 Architecture

```
 ┌─────────────── Browser (phone / laptop) ───────────────┐
 │ React app (attendance-frontend)                         │
 │  • pages: Home, Login, dashboards, check-in, enrollment │
 │  • acoustic engine: fsk.js + transmitter + receiver     │
 │  • device key (WebCrypto ECDSA P-256, IndexedDB)        │
 │  • camera + MediaPipe (guides liveness only)            │
 └───────────────▲─────────────────────────────────────────┘
                 │ HTTPS JSON + multipart (cookie JWT)
 ┌───────────────┴─────────────────────────────────────────┐
 │ API (attendance-backend, Express)                       │
 │  auth · classes · rosters · devices · sessions · claims │
 │  enrollment · reviews · reports · lock/cleanup jobs     │
 └──────┬──────────────────────────────┬───────────────────┘
        │ Mongoose                      │ HTTPS (service token)
 ┌──────┴───────────┐        ┌──────────┴──────────────────┐
 │ MongoDB Atlas    │        │ face-service (Python FastAPI)│
 │ users, classes,  │        │ /compare-id /verify          │
 │ sessions, records│        │ InsightFace + MediaPipe      │
 │ media (binary)   │        └──────────────────────────────┘
 └──────────────────┘
```

### 1.2 Surfaces

| Surface | Who | Notes | Status |
| --- | --- | --- | --- |
| Website — public | Anyone | Home, Login, Privacy notice, Sound lab | **Shipped** (Privacy notice planned) |
| Website — student | Students on phone (Android Chrome first) | Dashboard, enrollment, check-in, history | Partial |
| Website — teacher | Teachers on laptop + phone | Dashboard, classes, live check-in, reviews, reports | Partial |
| Face service | Backend only (never called by browsers) | Python | Planned |

---

## 2. People and access

### 2.1 Access model

| Rule | Detail |
| --- | --- |
| Sign-in | Google only. No passwords. |
| College gate | Token must be verified **and** `hd = nitjsr.ac.in` (or the email is in `TEST_STUDENT_EMAILS`). |
| Teacher | Created on first sign-in if email in `TEACHER_EMAILS`; afterwards the role lives in the database. |
| Student | Must be on an **active** roster at **every** sign-in. |
| Session | JWT in an httpOnly cookie (`token`), expiry `JWT_EXPIRE`. |

### 2.2 Roles

| Can… | Student | Teacher |
| --- | --- | --- |
| Create classes, rooms, rosters | — | ✓ (own classes) |
| Start / close a check-in | — | ✓ (own classes) |
| Join a check-in | ✓ (own classes) | — |
| Enroll ID + face | ✓ (self) | — |
| Approve devices / enrollments / attendance reviews | — | ✓ (own students) |
| Override a record | — | ✓ review records only, same day |
| See attendance | Own only | Own classes |

### 2.3 Classrooms

Classes are held in a fixed set of 36 rooms on three floors. A room is just its number.

| Floor | Rooms |
| --- | --- |
| First | 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112 |
| Second | 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212 |
| Third | 301, 302, 303, 304, 305, 306, 307, 308, 309, 310, 311, 312 |

- The list is created by `npm run seed:rooms` in `attendance-backend` (safe to re-run; existing rooms are skipped). Run it once on every new database.
- Teachers pick a room from this list when creating a class; the floor is the first digit.
- `POST /rooms` stays available for a teacher to add a room outside this list (e.g. a lab), but the standard list is the default.

---

## 3. End-to-end flows (plain language)

### 3.1 Teacher — once per term
1. Sign in with college Google.
2. Create class (course code, title, section, default room picked from the classroom list in §2.3).
3. Paste / upload the roster CSV (`email,name`). Fix any errors shown in the preview. Save.

### 3.2 Student — first time (≈2 minutes)
1. Open the website on their own phone → **Sign in with Google** (college account).
2. Server checks the roster → account created.
3. Phone is **bound**: a secret key is created in this browser; the server stores the public half.
4. Consent screen (what is collected, why, how long) → **I agree**.
5. **Upload college ID card** (photo of the front).
6. **Live selfie** with a random challenge ("turn left, then blink").
7. Server compares selfie ↔ ID-card face:
   - match → enrollment **verified**, selfie becomes the reference face;
   - unsure → teacher sees ID + selfie side by side → approve / reject.
8. Dashboard shows: ✅ Phone bound · ✅ Identity verified.

### 3.3 Every class — teacher (≈3–6 minutes)
1. Opens **Live check-in** for the class on their phone → **Start**.
2. Server creates the session and key K0; the teacher's phone plays K0 as sound on a loop (screen kept awake).
3. Live panel: present count by wave, list of names, review count, thumbnails.
4. Optional: types the **headcount**; the panel warns if *present > heads*. Optional: **Spot-check** shows 5 random present students to call out.
5. **Close** (or auto-close when the window ends). Students who never joined become **absent**.
6. Same day: resolves the **Reviews** list.

### 3.4 Every class — student (≈30–60 seconds)
1. Dashboard shows **"Check-in open for CS301"** → tap **Join** (browsers need a tap to use the mic).
2. **Listen:** phone hears the key → signs it with its device key → server checks key + device → *heard ✅*.
3. **Relay:** phone plays the next key 2–3 times (helps phones further back), then stays silent.
4. **Face:** camera opens → random challenge → 3–5 frames sent → server checks liveness + match.
5. Result: **Present ✅**, or **In review ⚠️** (with reason), or **Not marked ❌** (with what to do).

### 3.5 After class
- Student may raise **one query per record** the same day ("my phone could not hear").
- At **23:59 IST** the session **locks**: no more changes. Check-in photos, IP and location details are **deleted**; the reference face and ID stay for the term.
- Teacher exports CSV anytime; student sees their attendance %.

### 3.6 Hearing the teacher in bad conditions (owner requirement, 2026-10-22)

Every student phone must hear the teacher's key even in a noisy room, at the back, or with a weak phone. A student needs **one** good frame during the window, not every frame, so reception is built in layers:

| Layer | What it does | Phase |
| --- | --- | --- |
| Repeat combining | Each repeat of the key may lose a different tone; the receiver merges the best reading of each tone across recent repeats. Checksum + server key check reject any mixed-up key | 4 (**shipped**) |
| Whole-window playback | The teacher's phone plays the key on loop at full gain for the entire check-in window (many chances per student) | 5 |
| Teacher speaker check | Before **Start**, a 10 s self-test on the teacher's phone with a "set media volume to maximum" prompt; warns if the speaker is weak (speakers vary far more than mics — measured 12.5 vs 28.5 dB) | 5 |
| Relay (cascade) | Phones that heard the key replay it, so back rows hear a nearby phone instead of the teacher | 6 |
| Never silently absent | A phone that still never hears the key (broken mic, phone in a bag) goes to **review (`not_heard`)**, never straight to absent, as long as the student joined | 5 + 10 |

Measured so far (1 m, mid band): a weak-speaker sender reached ~67–90% of frames; a strong-speaker sender at 50% media volume reached ~92%+ with 28.5 dB average margin.

### 3.7 Decision table (what the server marks)

| Sound heard + signed by bound device | Face (when required) | Enrollment | Result |
| --- | --- | --- | --- |
| ✓ | ✓ live + match | verified | **present** |
| ✓ | unsure (low score / poor light) | verified | **review** (`face_unsure`) |
| ✓ | ✗ no match / not live | verified | **review** (`face_failed`) — teacher sees frames |
| ✓ | — | not verified | **review** (`not_enrolled`) |
| ✗ not heard, face ✓ | ✓ | verified | **review** (`not_heard`) — e.g. weak phone |
| key from wrong session / expired / reused | any | any | claim **rejected** (no record change) |
| signature invalid / device not bound | any | any | claim **rejected**; device change → device review |
| never joined | — | — | **absent** at close |

---

## 4. Data and API overview

### 4.1 Collections (final state)

| Collection | Purpose | Phase |
| --- | --- | --- |
| `users` | Name, email, role, Google subject, device binding, enrollment, consent | 1 (+3, 8, 13) |
| `rooms` | Room number | 2 |
| `courseclasses` | Class, teacher, default room, archived | 2 |
| `enrollments` | Roster rows (class + email + identity + active/inactive) | 2 |
| `devicebindingrequests` | New-device review queue | 3 |
| `devicechallenges` | One-time nonces for signatures (TTL) | 3 |
| `attendancesessions` | One check-in window | 5 |
| `wavekeys` | Keys per session per wave (rotating) | 5 (+6) |
| `attendancerecords` | One row per student per session (final result) | 5 (+9, 10) |
| `checkinevidence` | IP, user agent, optional GPS, check-in frames — **TTL 24 h** | 5 (+9) |
| `identitymedia` | ID card image + reference face image (binary, size-capped) | 8 |
| `facechallenges` | Random liveness challenges (TTL) | 8 |
| `auditlogs` | Overrides, approvals, rejections | 10 |
| `neighbourreports` | Which IDs each phone heard in the ID round | 12 |

> Images are stored as compressed JPEG binaries inside MongoDB documents (ID card ≤ 600 KB, reference face ≤ 200 KB, each check-in frame ≤ 60 KB). No extra storage service needed; Atlas free tier (512 MB) holds a pilot easily. Check-in frames live in `checkinevidence`, which a TTL index deletes automatically.

### 4.2 API index (all under `/api/v1`)

| Area | Endpoints | Phase |
| --- | --- | --- |
| Health / auth | `GET /health` · `POST /auth/google` · `GET /islogin` · `GET /logout` · `GET /time` | 1 (+6) |
| Rooms | `GET /rooms` · `POST /rooms` | 2 |
| Classes | `GET /classes` · `POST /classes` · `GET /classes/:classId` · `PATCH /classes/:classId` · `POST /classes/:classId/archive` | 2 |
| Roster | `POST /classes/:classId/roster/preview` · `PUT /classes/:classId/roster` · `GET /classes/:classId/roster` · `POST /classes/:classId/roster/students` · `DELETE /classes/:classId/roster/students/:email` | 2 |
| Student classes | `GET /me/classes` | 2 |
| Devices | `POST /device/challenge` · `POST /device-bindings/claim` · `GET /device-bindings/status` · `GET /device-reviews` · `POST /device-reviews/:reviewId` | 3 |
| Sessions (teacher) | `POST /classes/:classId/sessions` · `GET /sessions/:sessionId` · `GET /sessions/:sessionId/beacon` · `POST /sessions/:sessionId/close` · `PATCH /sessions/:sessionId/headcount` · `GET /sessions/:sessionId/spot-check` | 5 (+10) |
| Sessions (student) | `GET /sessions/active` · `POST /sessions/:sessionId/claims` · `GET /sessions/:sessionId/me` | 5 (+6) |
| Enrollment (student) | `GET /enrollment/status` · `POST /enrollment/id-card` · `POST /face/challenge` · `POST /enrollment/selfie` | 8 |
| Enrollment (teacher) | `GET /enrollment-reviews` · `POST /enrollment-reviews/:userId` | 8 |
| Face at check-in | `POST /sessions/:sessionId/face` | 9 |
| Reviews & queries | `GET /reviews` · `POST /records/:recordId/decision` · `POST /records/:recordId/query` | 10 |
| Media (teacher) | `GET /media/:mediaId` · `GET /evidence/:recordId/frames/:index` | 8 (+9) |
| Reports | `GET /classes/:classId/attendance` · `GET /classes/:classId/attendance.csv` · `GET /sessions/:sessionId/export.csv` · `GET /me/attendance` | 11 |
| Neighbour round | `GET /sessions/:sessionId/id-round` · `POST /sessions/:sessionId/neighbour-reports` | 12 |
| Consent | `GET /consent/current` · `POST /me/consent` | 13 |

Face service (internal, token-protected): `POST /compare-id` · `POST /verify` · `GET /health`.

### 4.3 Screens map

| Route | Who | Screen | Phase |
| --- | --- | --- | --- |
| `/` · `/login` · `*` | Public | Home · Login · 404 | Shipped |
| `/acoustic-lab` | Public | Sound lab | Shipped (fix in 4) |
| `/acoustic-lab/link` | Public | Phone-to-phone link test | 4 |
| `/privacy` | Public | Privacy & data notice | 13 |
| `/student-dashboard` | Student | Status cards + open check-ins | Shipped (extended 5, 8) |
| `/student/enroll` | Student | ID card + selfie wizard | 8 |
| `/student/check-in/:sessionId` | Student | Listen → relay → face → result | 5 (+6, 9) |
| `/student/attendance` | Student | History, %, queries | 10–11 |
| `/teacher-dashboard` | Teacher | Stats, recent classes | Shipped (extended 11) |
| `/teacher/classes` | Teacher | Classes, rooms, rosters | Shipped (restyle 2) |
| `/teacher/classes/:classId` | Teacher | Class detail: roster, sessions, attendance | 2 (+11) |
| `/teacher/live/:sessionId` | Teacher | Live check-in (beacon, counts, headcount, spot-check, thumbnails) | 5 (+6, 9, 10) |
| `/teacher/reviews` | Teacher | Devices · enrollments · attendance reviews | 3 (+8, 10) |

### 4.4 Configuration

| Variable | Where | Meaning | Phase |
| --- | --- | --- | --- |
| `PORT`, `DB_URI`, `JWT_SECRET`, `JWT_EXPIRE`, `COOKIE_EXPIRE` | backend | Existing | 0 |
| `GOOGLE_CLIENT_ID`, `TEACHER_EMAILS`, `TEST_STUDENT_EMAILS` | backend | Existing | 1 |
| `CLIENT_URLS`, `NODE_ENV` | backend | Allowed origins; `PRODUCTION` = secure cookies, no tunnel wildcard | 0 |
| `TIMEZONE` (default `Asia/Kolkata`) | backend | Day boundary for lock / same-day rules | 5 |
| `CHECKIN_WINDOW_MIN` (6), `KEY_LIFETIME_SEC` (15), `MAX_WAVES` (5) | backend | Session defaults | 5–6 |
| `FACE_SERVICE_URL`, `FACE_SERVICE_TOKEN` | backend | Face service | 7 |
| `EVIDENCE_TTL_HOURS` (24) | backend | Retention | 5 |
| `REACT_APP_GOOGLE_CLIENT_ID`, `REACT_APP_API_URL`, `REACT_APP_GOOGLE_HOSTED_DOMAIN` | frontend | Existing | 1 |
| `API_TOKEN`, `MATCH_THRESHOLD`, `REVIEW_THRESHOLD`, `MODEL_NAME` | face-service | Face service settings | 7 |

---

## 5. Phases

---

### Phase 0 — Foundation & hardening

**Goal.** A stable base: same code runs locally and on a permanent HTTPS URL; known security bugs fixed.

**Depends on.** Nothing.

**What users get.** Nothing visible; the site works from a real URL on phones (no tunnels needed for sign-in or mic).

**Database.** None.

**API.** No new endpoints.

**Backend work.**
- `middleware/error.js`: `TokenExpireError` → `TokenExpiredError`; both JWT errors return **401** (not 400).
- `utils/jwttoken.js`: stop returning the JWT in the JSON body (cookie only).
- `app.js`: when `NODE_ENV=PRODUCTION`, drop the `*.trycloudflare.com` wildcard and the inherited seniors' Vercel origin; allow only `CLIENT_URLS`.
- `config/config.env.example`: remove the stale WebAuthn comments; add every variable from §4.4 with comments.
- Deploy backend to **Render** (web service, `npm start`, env vars from §4.4). Note: free tier sleeps after ~15 min idle → teacher opens the site a minute before class, or a free uptime pinger hits `/health`.
- Cookies in production: `secure: true`, `sameSite: "none"` (already in `utils/cookieOptions.js`).

**Frontend work.**
- Deploy to **Vercel** (`vercel.json` rewrites already exist). Set `REACT_APP_API_URL` to the Render URL.
- `package.json`: make `start:shared` work on Windows (add `cross-env`).
- Google Cloud: add the Vercel URL to Authorized JavaScript origins; move the OAuth consent screen out of *Testing* (Publish) before the pilot.

**Rules & edge cases.** Secrets never committed (`config.env`, `.env` are gitignored — keep it that way).

**Done when.**
- `npm test` (backend, 10) and `npm run test:acoustic` (12) pass.
- Hosted site: sign-in works as teacher and test student; `/acoustic-lab` opens on an Android phone over HTTPS; expired-cookie request returns 401 JSON.

---

### Phase 1 — Identity & access *(Shipped)*

**Goal.** Only real college users get in; each gets the right role.

**Depends on.** Phase 0.

**What users get.** Google sign-in button; teacher → teacher dashboard; student → student dashboard; clear error messages ("not on an active class roster").

**Database — `users`** (exists): `name`, `email` (unique), `role` (`student|teacher`), `authProvider` (`google`), `googleSubject` (unique, sparse), `deviceBinding` (Phase 3).

**API** (exists): `POST /auth/google {credential}` → sets cookie, `{user}` · `GET /islogin` → `{user}` · `GET /logout` · `GET /health`.

**Backend** (exists): `controllers/googleAuthController.js` (`googleSignIn`), `utils/signInPolicy.js`, `middleware/auth.js` (`isAuthenticated`, `authorizeRoles`).

**Frontend** (exists): `components/login/Login.jsx`, `GoogleSignInButton.jsx`, role redirects in both dashboards.

**Rules.** See §2.1. A Google account already linked to another `googleSubject` is refused.

**Done when.** 5 sign-in policy tests pass (exist); manual: teacher, test student, random Gmail (refused), off-roster college account (refused).

---

### Phase 2 — Teacher workspace: classes, rooms, rosters

**Goal.** Teachers fully manage who belongs to which class, in the new design.

**Depends on.** Phase 1.

**What users get.**
- *Teacher:* pick the class room from the standard list grouped by floor (§2.3); create / edit / archive classes; paste or upload roster CSV with a highlighted preview; add or remove one student; class detail page.
- *Student:* dashboard lists their classes.

**Database.**
- `rooms` (exists): `roomNo` (unique). Seeded with the 36 standard rooms by `scripts/seed-rooms.js`.
- `courseclasses` (exists) **+** `archived: Boolean (default false)`, `archivedAt`.
- `enrollments` (exists): `class`, `email`, `name`, `identity{loginId,batch,programmeBranch,rollNumber}`, `status (active|inactive)`, `rosterUpdatedAt`.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `GET /rooms` · `POST /rooms` | Teacher | exists |
| `GET /classes` · `POST /classes` | Teacher | exists (`GET` hides archived unless `?archived=1`) |
| `GET /classes/:classId` | Teacher (owner) | → `{courseClass}` with `activeStudentCount` |
| `PATCH /classes/:classId` | Teacher (owner) | `{title?, section?, roomId?}` → `{courseClass}` (course code is not editable) |
| `POST /classes/:classId/archive` | Teacher (owner) | `{archived?: false}` restores; otherwise archives → `{courseClass}` (archived: hidden from lists, no new sessions) |
| `POST /classes/:classId/roster/preview` · `PUT …/roster` · `GET …/roster` | Teacher (owner) | exists |
| `POST /classes/:classId/roster/students` | Teacher (owner) | `{email, name?}` → `{enrollment}` (same validation as CSV) |
| `DELETE /classes/:classId/roster/students/:email` | Teacher (owner) | → `{success}` (sets `inactive`) |
| `GET /me/classes` | Student | → `{classes:[{_id, courseCode, title, section, room}]}` (active enrollments only) |

**Backend work.** Extend `controllers/classController.js` (reuse `getOwnedClass`, `parseRosterText` from `utils/roster.js`); new routes in `routes/classRoute.js` with per-route `guards` (never a blanket `router.use`). Add `meController.js` + `routes/meRoute.js` for `/me/*`.

**Frontend work.**
- Restyle `components/teacher/classManagement.jsx` on the `src/ui/` kit (Card, Field, Button, Badge, EmptyState, Toast).
- Room picker in the class form: rooms grouped by floor (First / Second / Third); a small "Other room" option calls `POST /rooms` for rooms outside the standard list.
- Roster editor: errors listed with row numbers and highlighted; "Download sample CSV"; add-one / remove-one controls.
- New `components/teacher/ClassDetail.jsx` (`/teacher/classes/:classId`): header, roster table, sessions tab (filled in Phase 5/11).
- Student dashboard: "Your classes" card from `GET /me/classes`.

**Rules & edge cases.** Roster max 250; only `@nitjsr.ac.in`; duplicate emails rejected; removing a student who is mid-session does not delete existing records.

**Done when.** New unit tests for add/remove-one validation; existing 3 roster tests pass; manual: create room → class → roster → student signs in → sees class.

---

### Phase 3 — Trusted device (binding v2)

**Goal.** Every important student request is **signed by the private key stored on their bound phone**, so the server knows the request comes from that device.

**Depends on.** Phase 1.

**What users get.**
- *Student:* nothing new to do — the browser signs automatically. Clear status: bound / in review / not bound.
- *Teacher:* review queue shows device changes with "first seen", student name, and email.

**Database.**
- `users.deviceBinding` (exists): `fingerprint`, `publicKeyJwk`, `approvedAt`, `lastSeenAt`.
- `devicebindingrequests` (exists) **+** `reason` (`new_device|rebind`); when one request is approved, other pending requests of the same student become `superseded`.
- **New `devicechallenges`:** `user` (ref), `nonce` (32 random bytes, base64url), `purpose` (`bind|claim|face|neighbour`), `expiresAt` (**TTL index**, 60 s), `usedAt`.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `POST /device/challenge` | Student | `{purpose}` → `{challengeId, nonce, expiresAt}` |
| `POST /device-bindings/claim` | Student | `{publicKeyJwk, challengeId, signature}` → `{status: approved|review, firstBinding}` |
| `GET /device-bindings/status` | Student | exists |
| `GET /device-reviews` · `POST /device-reviews/:reviewId` | Teacher | exists (+ supersede logic) |

**Signature format.** Message = UTF-8 of `"${purpose}|${nonce}|${payloadHash}"` where `payloadHash` = SHA-256 (hex) of the canonical JSON of the request's important fields (e.g. `{sessionId, key}` for a claim). Browser: `crypto.subtle.sign({name:"ECDSA", hash:"SHA-256"}, privateKey, message)` → base64url. Server: `crypto.verify("sha256", message, {key: crypto.createPublicKey({key: jwk, format: "jwk"}), dsaEncoding: "ieee-p1363"}, signature)` — **`ieee-p1363` is required** because WebCrypto signatures are raw `r||s`, not DER.

**Backend work.**
- New `utils/deviceProof.js`: `issueChallenge(user, purpose)`, `verifyDeviceProof({user, challengeId, signature, purpose, payload})` → checks challenge belongs to user, purpose matches, not expired, not used, marks used, verifies signature against `user.deviceBinding.publicKeyJwk`. Reuse `fingerprintPublicKey` from `utils/deviceBinding.js`.
- `googleAuthController.claimDeviceBinding`: require a valid signature made with the **submitted** key (proves the browser holds it).
- `decideDeviceReview`: supersede other pending requests on approve.

**Frontend work.**
- `src/utils/deviceKey.js`: add `signChallenge({purpose, payload})` (fetch challenge → hash payload → sign with stored `privateKey` → return `{challengeId, signature}`).
- `Login.jsx`: bind flow uses the signed claim.
- New `src/api/signedRequest.js` helper used by every later signed call.

**Rules & edge cases.**
- Clearing site data / new phone = new key → device review (teacher approves). Until approved, claims are rejected with "device in review".
- First binding is auto-approved (smooth onboarding). Safe because Phase 9 face checks stop a friend's phone being used for someone else.
- A challenge works once and expires in 60 s.

**Done when.** Unit tests: valid signature accepted; tampered payload, wrong user, expired, reused challenge, DER-encoded signature all rejected; supersede logic. Manual: sign in on phone A (approved), phone B (review), approve B → A now rejected.

---

### Phase 4 — Acoustic engine (physical layer)

**Goal.** Two real phones reliably send and decode key frames at classroom distances; the tone band is chosen from measurements.

**Depends on.** Nothing (frontend only); deploys on Phase 0 hosting.

**What users get.**
- *Anyone:* improved **Sound lab**; new **Link test** page (one phone sends, another receives, counters shown).
- *Team:* a measured band decision recorded in `progress.md`.

**Database / API.** None.

**Frontend work — modules.**

| Module | Responsibility |
| --- | --- |
| `src/acoustic/fsk.js` (exists) | Make the band a **profile**: `{baseHz, spacingHz}` (tone count stays 17 — the frame layout depends on it); default stays 18 000 / 110. Add `PROFILES = {high: …, mid: …}` (e.g. mid = 16 500 Hz base). All functions take an optional profile. |
| `public/capture-worklet.js` (new) | AudioWorklet that forwards raw mic samples (Float32 chunks) to the main thread. |
| `src/acoustic/mic.js` (new) | `openMic()` → `getUserMedia({audio:{channelCount:1, echoCancellation:false, noiseSuppression:false, autoGainControl:false}})`, AudioContext, **refuse < 44 100 Hz**, report applied settings. |
| `src/acoustic/receiver.js` (new) | Ring buffer (~3 s); every ~300 ms runs `decodeFrame()` in search mode; emits `{value, margins, at}`; de-duplicates the same key. |
| `src/acoustic/transmitter.js` (new) | `encodeFrame()` → `AudioBuffer` at the context sample rate → plays N repeats with a short gap; optional **start at a given AudioContext time** (used by Phase 6); volume control. |
| `src/acoustic/wakeLock.js` (new) | Screen Wake Lock request / release / re-acquire on visibility change. |

**Screens.**
- `AcousticLab.jsx`: restyle on the UI kit; add the < 44.1 kHz refusal, a **live level meter** per test tone, 6 ms fades on lab tones.
- New `components/acousticLab/LinkTest.jsx` (`/acoustic-lab/link`): role switch **Send / Receive**, profile picker, random key or fixed key, counters (*sent / heard / decoded / wrong*), decode margins, "copy results" button.

**Rules & edge cases.** Mic and audio start only after a tap; keep the screen on; do not decode while the same phone is transmitting (ignore own key).

**Done when.**
- `npm run test:acoustic`: existing 12 pass + new tests for the alternate profile and for `receiver` on synthetic streamed audio.
- Real phones (record in `progress.md`: model, Android, Chrome, profile, distance, sent, decoded): ≥ 95 % decoded at **1 m** and **6 m**; far-corner (~20 m) number recorded; 3–5 phones sending the same frame together tested.
- **Band chosen** and written into `plan.md` (default profile updated if needed).

---

### Phase 5 — Check-in sessions (core loop, sound only)

**Goal.** A teacher starts a check-in; students whose phones hear the key and sign a claim are marked present; the rest become absent at close.

**Depends on.** Phases 2, 3, 4.

**What users get.**
- *Teacher:* **Start check-in** on a class → Live page plays K0, shows live counts and names, **Close**.
- *Student:* dashboard card "Check-in open" → **Join** → listening animation → result.

**Database.**
- **`attendancesessions`:** `class`, `teacher`, `room`, `status (open|closed|locked)`, `startedAt`, `closesAt`, `closedAt`, `lockAt` (end of the IST day), `settings{windowMin, keyLifetimeSec, maxWaves, profile, faceRequired:false}`, `headcount` (Phase 10), `stats{present, review, absent, byWave{}}`. Index `{class:1, status:1}`; only one `open` session per class.
- **`wavekeys`:** `session`, `wave` (0…), `value` (integer `0 … 15^7−1`), `validFrom`, `validUntil`. Index `{session:1, wave:1, validUntil:-1}`. Rotated when expired (new doc).
- **`attendancerecords`:** `session`, `class`, `student` (ref), `email`, `status (present|review|absent)`, `reasons[]`, `acoustic{heard, wave, heardAt, keyWave}`, `device{fingerprint, verified}`, `face{…}` (Phase 9), `decision{by, at, note}` (Phase 10), `query{…}` (Phase 10). Unique `{session:1, student:1}`.
- **`checkinevidence`:** `record`, `ip`, `userAgent`, `gps?` (optional, only after notice), `frames[]` (Phase 9), `expiresAt` (**TTL index**, `EVIDENCE_TTL_HOURS`).

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `POST /classes/:classId/sessions` | Teacher (owner) | `{windowMin?}` → `{session}` (409 if one already open; 400 if class archived) |
| `GET /sessions/:sessionId` | Teacher (owner) | → `{session, counts, records:[{student, status, wave, reasons}]}` (poll every 2 s) |
| `GET /sessions/:sessionId/beacon` | Teacher (owner) | → `{wave:0, value, validUntil, profile}` (rotates K0) |
| `POST /sessions/:sessionId/close` | Teacher (owner) | → `{session}`; creates `absent` records for roster students without a record |
| `GET /sessions/active` | Student | → `{sessions:[{_id, class, closesAt, profile}]}` for the student's active classes |
| `POST /sessions/:sessionId/claims` | Student | `{key, challengeId, signature}` → `{status, wave}` (signed payload `{sessionId, key}`) |
| `GET /sessions/:sessionId/me` | Student | → `{record}` (own status) |

**Backend work.**
- `models/attendanceSessionModels.js`, `models/waveKeyModels.js`, `models/attendanceRecordModels.js`, `models/checkinEvidenceModels.js`.
- `utils/keys.js`: `mintKey()` = `crypto.randomInt(15 ** 7)`; `currentKey(session, wave)` (rotate if expired); `findKey(session, value)` → `{wave}` if `value` matches a key of this session valid **now or in the previous lifetime window** (grace for network delay).
- `utils/attendanceDecision.js` (**pure function, unit-tested**): inputs `{heard, deviceVerified, enrollment, face, faceRequired, neighbour}` → `{status, reasons}`. Phase 5 uses only `heard` + `deviceVerified`; later phases add inputs without changing earlier behaviour.
- `controllers/sessionController.js` + `routes/sessionRoute.js` (per-route guards; teacher ownership via `getOwnedClass` pattern; student membership via active `Enrollment`).
- Claim checks in order: session open → student on active roster → `verifyDeviceProof` (Phase 3) → key belongs to this session and is fresh → record not already `present` → upsert record → write evidence (IP, UA) → update stats.
- `utils/clock.js`: IST day boundary (`lockAt`) using `TIMEZONE`.
- Auto-close: on each read/claim, if `now > closesAt` close the session (no cron needed); plus a lightweight `setInterval` sweep every minute in `index.js`.

**Frontend work.**
- `components/teacher/LiveCheckin.jsx` (`/teacher/live/:sessionId`): big **Start/Close**, timer, wake lock, polls `/beacon` and re-loads the transmitter when the key rotates (loop K0 with ~300 ms gap), counts (present / review / not yet), live name list.
- Class detail + teacher dashboard: **Start check-in** button.
- `components/student/CheckIn.jsx` (`/student/check-in/:sessionId`): state machine `idle → permissions → listening → submitting → done | failed` with clear messages (mic blocked, sample rate too low, not heard after 60 s → "move closer / ask teacher").
- Student dashboard polls `/sessions/active` every 10 s while open and shows the **Join** card.

**Rules & edge cases.**
- Keys never appear on screen or in logs.
- Expired / other-session / reused keys → claim rejected (no record change).
- Polling (not WebSockets): ~120 phones × 1 request / 2 s is light and survives free hosting.
- Teacher's phone must stay on the Live page with screen on.
- **Reception (§3.6):** before **Start**, the Live page runs a 10 s speaker self-test (reuse `AcousticLab` measurement: play the chosen band, measure own-mic margin) and prompts "set media volume to maximum"; warns below ~20 dB margin. K0 plays at full gain for the whole window. A student who joined but never heard a key gets `review (not_heard)`, not `absent`.

**Done when.** Unit tests: `attendanceDecision`, key validity windows, claim rejections (closed session, off-roster, bad signature, stale key, duplicate). Manual on the hosted URL: teacher phone + 2 student phones → both present; a key copied after expiry is rejected; close → missing roster students absent.

---

### Phase 6 — Cascade relay (multi-wave)

**Goal.** Phones that heard wave *n* re-play wave *n+1*, so the key reaches the back of a 20 m room.

**Depends on.** Phase 5.

**What users get.**
- *Student:* after "heard ✅" the phone briefly shows "Helping classmates…" while it plays the next key, then goes quiet.
- *Teacher:* live counts **by wave** (how far the sound travelled).

**Database.** `wavekeys` used for waves 1…`maxWaves`. `attendancerecords.acoustic.wave` = wave of the key heard **+ 1**.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `GET /time` | Anyone | → `{now}` (server ms; client estimates offset with 3 samples) |
| `POST /sessions/:sessionId/claims` | Student | response now adds `relay: {wave, value, validUntil, repeats, playAt[]}` unless `wave ≥ maxWaves` |

**Backend work.**
- Claim handler: after a successful claim, return the current key for `wave + 1` (mint / rotate via `utils/keys.js`).
- `playAt`: next shared slot boundaries in server time (e.g. multiples of 2 000 ms), so phones in the same wave start together.

**Frontend work.**
- `src/acoustic/clock.js`: server-time offset from `/time`.
- `CheckIn.jsx`: after success → `transmitter.playAt(serverToContextTime(playAt[i]))` for each repeat → stop receiver during own playback → muted state.
- `LiveCheckin.jsx`: per-wave bars.

**Rules & edge cases.** Each phone relays only once per session; a phone that hears several waves joins at the lowest; relay stops when a wave adds no new students or the session closes.

**Done when.** Unit test: relay key issued for the correct wave, capped at `maxWaves`. Rehearsal with 5 then 15+ phones in the real room: % reached, waves needed, seconds per wave, smearing observations recorded in `progress.md`; tune `repeats`, gap and volume.

---

### Phase 7 — Face service

**Goal.** A small, private service that (a) compares a selfie with an ID-card photo, (b) verifies check-in frames: liveness challenge performed and face matches the reference.

**Depends on.** Phase 0 (hosting) only.

**What users get.** Nothing directly; used by Phases 8 and 9.

**New folder `face-service/`** (Python 3.11, FastAPI, Uvicorn, Dockerfile).

| Piece | Choice |
| --- | --- |
| Face detection + embedding | **InsightFace** (`buffalo_s` / ArcFace, CPU, ONNX) — 512-d embeddings, cosine similarity |
| Liveness (active) | **MediaPipe Face Landmarker** on the uploaded frames: head yaw for `turn_left/right`, eye-aspect-ratio for `blink`, mouth for `smile` |
| Anti-spoof (passive, optional) | MiniFASNet (Silent-Face) score as an extra signal |
| Auth | `Authorization: Bearer ${API_TOKEN}`; never exposed to browsers |
| Hosting | Hugging Face Spaces (Docker, free CPU) or Render (Docker; check memory) |

**API (internal).**

| Method & path | Request → Response |
| --- | --- |
| `GET /health` | → `{ok, model}` |
| `POST /compare-id` | multipart `id_card`, `selfies[]` → `{face_found_id, face_found_selfie, score, decision: match|unsure|no_match}` |
| `POST /verify` | multipart `reference`, `frames[]` + JSON `challenge:[{step, frameIndex}]` → `{faces_ok, liveness:{passed, steps:[{step, ok, value}]}, match:{score, decision}, spoof_score?}` |

Decisions use two thresholds: `score ≥ MATCH_THRESHOLD` → match; `REVIEW_THRESHOLD ≤ score < MATCH_THRESHOLD` → unsure; below → no_match. More than one face or no face → `faces_ok:false`.

**Backend work.** `utils/faceClient.js` (`compareId`, `verify`, timeout 15 s, retries 1); `GET /health` of the API reports face-service reachability.

**Done when.** Service unit tests on a small labelled set (same person / different person / printed photo / screen replay); thresholds chosen and written down; backend `faceClient` mocked in Node tests.

---

### Phase 8 — Student identity enrollment (ID card + live selfie)

**Goal.** Every student has a **verified reference face** linked to their college ID before they can be marked present by face.

**Depends on.** Phases 1, 3, 7.

**What users get.**
- *Student:* first sign-in leads to a 3-step wizard: **Consent → ID card → Live selfie** → "Verified" or "Waiting for teacher".
- *Teacher:* **Reviews → Enrollments** tab: ID card + selfie side by side, roster name/roll, score → Approve / Reject (with reason).

**Database.**
- `users.enrollment`: `status (none|pending|verified|rejected)`, `idCardMedia` (ref), `referenceFaceMedia` (ref), `score`, `decidedBy`, `decidedAt`, `rejectReason`, `attempts`.
- **New `identitymedia`:** `user`, `kind (id_card|reference_face)`, `contentType`, `data (Buffer)`, `size`, `createdAt`. Max sizes from §4.1.
- **New `facechallenges`:** `user`, `purpose (enroll|checkin)`, `session?`, `steps[]` (2 random from `turn_left, turn_right, blink, smile`), `expiresAt` (TTL 90 s), `usedAt`.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `GET /enrollment/status` | Student | → `{status, rejectReason?}` |
| `POST /enrollment/id-card` | Student | multipart `image` (JPEG/PNG ≤ 600 KB after client compression) → `{ok}` |
| `POST /face/challenge` | Student | `{purpose:"enroll"}` → `{challengeId, steps}` |
| `POST /enrollment/selfie` | Student | multipart `frames[]` (3–5) + `challengeId` + device signature → `{status}` |
| `GET /enrollment-reviews` | Teacher | → students of own classes with `pending` |
| `POST /enrollment-reviews/:userId` | Teacher | `{decision: approved|rejected, reason?}` → `{status}` |
| `GET /media/:mediaId` | Teacher of that student, or the student | → image |

**Backend work.** `controllers/enrollmentController.js`, `routes/enrollmentRoute.js`, `multer` (memory storage, size limits, image MIME check); flow: store ID card → on selfie: check challenge (owner, unused, fresh) → `faceClient.compareId(idCard, frames)` + `faceClient.verify(frames[0] as temp reference, frames, steps)` for liveness → `match` + liveness passed → `verified`, store best frame as `reference_face`; `unsure` or liveness doubtful → `pending`; `no_match` → `pending` with reason (teacher decides; never auto-reject). `auditlogs` entry on teacher decision.

**Frontend work.**
- `components/student/Enroll.jsx` (`/student/enroll`): consent text → ID card capture (camera or file, auto-crop/compress to ≤ 600 KB) → selfie step with live camera, **MediaPipe Face Landmarker** (`@mediapipe/tasks-vision`) drawing prompts and auto-capturing one frame per step → upload → result.
- Student dashboard: "Identity" status card (none / pending / verified / rejected → retry).
- `components/teacher/Reviews.jsx` (`/teacher/reviews`): tabs **Devices** (moves the existing queue here) · **Enrollments**.

**Rules & edge cases.** Max 3 self-attempts, then teacher must reset; re-enrollment (new phone, appearance change) goes to review; only the student and their teachers can view images; nothing is shared with other students.

**Done when.** Unit tests: challenge ownership/expiry/single use, access control on `/media`, decision mapping from service results (mocked). Manual: verified path, unsure path → teacher approves, printed-photo attempt fails liveness.

---

### Phase 9 — Face + liveness at check-in

**Goal.** After the sound step, a quick face check proves the enrolled student is the one holding the phone.

**Depends on.** Phases 5, 7, 8.

**What users get.**
- *Student:* after "heard ✅": camera opens → 2 random prompts → "Present ✅" (≈ 5 s).
- *Teacher:* live page shows a thumbnail per student (check-in frame vs reference) and review reasons.

**Database.**
- `attendancesessions.settings.faceRequired = true` (default from now on; can be turned off per session for tests).
- `attendancerecords.face`: `status (pending|passed|unsure|failed|skipped)`, `score`, `liveness{passed, steps[]}`, `checkedAt`.
- `checkinevidence.frames[]`: JPEG buffers (≤ 60 KB each) — deleted by TTL.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `POST /face/challenge` | Student | `{purpose:"checkin", sessionId}` → `{challengeId, steps}` (only after a successful claim) |
| `POST /sessions/:sessionId/face` | Student | multipart `frames[]` + `challengeId` + device signature → `{face:{status}, record:{status, reasons}}` |
| `GET /evidence/:recordId/frames/:index` | Teacher (owner) | → image (until TTL deletion) |

**Backend work.** Session controller: on face upload → verify challenge + device proof → `faceClient.verify(referenceFace, frames, steps)` → set `record.face` → recompute status with `attendanceDecision` (adds `face`, `enrollment`, `faceRequired`) → store frames in evidence.

**Frontend work.** `CheckIn.jsx`: new `face` state after `submitting`/relay; reuse the selfie capture component from Phase 8. `LiveCheckin.jsx`: thumbnails + reason badges.

**Rules & edge cases.** Face step must start within the session window; poor light → `unsure` → review (never silent absent); a student without verified enrollment can still check in by sound but lands in `review (not_enrolled)`.

**Done when.** Unit tests: decision table §3.7 fully covered. Manual: enrolled student → present; friend holding the student's phone → review (`face_failed`); photo on another phone → liveness fails.

---

### Phase 10 — Reviews, overrides, queries, lock, retention

**Goal.** Unsure cases are resolved fairly by the teacher on the same day; records lock at midnight; personal evidence is deleted.

**Depends on.** Phases 5 (and uses reasons produced by 3, 8, 9 when present).

**What users get.**
- *Teacher:* **Reviews → Attendance** tab: each review with reason, frames, reference face, wave, device status → **Mark present / Mark absent** (+ note). **Headcount** box and **Spot-check 5** on the live page.
- *Student:* "In review" status with reason; **Raise query** (one per record, same day); sees the final decision.

**Database.**
- `attendancerecords.decision{status, by, at, note}`, `query{text, raisedAt, answeredAt}`.
- `attendancesessions.headcount`, `locked` via `status:"locked"`.
- **New `auditlogs`:** `actor`, `action (override|approve_device|reject_device|approve_enrollment|reject_enrollment|close_session)`, `target{type,id}`, `before`, `after`, `at`.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `GET /reviews?type=attendance` | Teacher | → open review records across own classes (today) |
| `POST /records/:recordId/decision` | Teacher (owner) | `{status: present|absent, note?}` → `{record}` — **only if record is `review` and session not locked** |
| `POST /records/:recordId/query` | Student (own record) | `{text}` → `{record}` — same day, once; moves an `absent` record into `review` |
| `PATCH /sessions/:sessionId/headcount` | Teacher (owner) | `{headcount}` → `{session, warning?}` (warning when present > headcount) |
| `GET /sessions/:sessionId/spot-check?n=5` | Teacher (owner) | → 5 random present students |

**Backend work.** `controllers/reviewController.js`; lock sweep in `index.js` every 10 min: sessions with `lockAt < now` → `locked`; any remaining `review` → `absent` with reason `unresolved` (configurable). TTL indexes already delete evidence/challenges; sweep also removes `gps`/IP fields if TTL not yet run.

**Frontend work.** `Reviews.jsx` third tab; review detail drawer with images; `LiveCheckin.jsx` headcount + spot-check; student query form on `CheckIn.jsx` result and `/student/attendance`.

**Rules & edge cases.** Teacher can change **only** review records (`plan.md` rule); all changes audited; after lock nothing changes.

**Done when.** Unit tests: same-day and review-only rules, lock sweep, query once-per-record. Manual: query → review → teacher decides → lock next day.

---

### Phase 11 — Attendance records & reports

**Goal.** Teachers get usable attendance output; students see their own record.

**Depends on.** Phases 5, 10.

**What users get.**
- *Teacher:* class detail **Attendance** tab: matrix (students × sessions, ✓ / ✗ / ⚠), attendance % per student, low-attendance highlight; **Export CSV** per session and per class; dashboard stats (sessions this week, average attendance, open reviews).
- *Student:* `/student/attendance`: per class %, list of sessions with status, query buttons (same day).

**Database.** No new collections; add index `{class:1, student:1}` on `attendancerecords`.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `GET /classes/:classId/attendance` | Teacher (owner) | → `{sessions[], students[], cells[][]}` |
| `GET /classes/:classId/attendance.csv` | Teacher (owner) | CSV: `email, name, roll, session dates…, percent` |
| `GET /sessions/:sessionId/export.csv` | Teacher (owner) | CSV: `email, name, roll, status, wave, reasons, decidedBy` |
| `GET /me/attendance` | Student | → `{classes:[{class, percent, sessions:[{date, status}]}]}` |

**Backend / frontend.** `controllers/reportController.js` (Mongo aggregation); `ClassDetail.jsx` Attendance tab; `StudentAttendance.jsx`; teacher dashboard stat cards.

**Done when.** Unit test for percentage + CSV escaping; manual export opened in Excel.

---

### Phase 12 — Neighbour verification (ID round)

**Goal.** Stop the remaining remote attack: a friend inside forwarding the key to an absent student. After the waves, each phone briefly plays its own slot signal and neighbours report what they heard; a present student must be heard by enough neighbours.

**Depends on.** Phases 5, 6 (and 3 for signed reports).

**What users get.**
- *Student:* after the face step, "Final check (≈ 1–2 min)" — keep the phone out and the page open.
- *Teacher:* "Neighbour check" column (heard by N phones).

**Database.**
- `attendancesessions.idRound{status, startsAt, slotMs, slots:[{student, index}]}`.
- **New `neighbourreports`:** `session`, `reporter`, `heard:[{slotIndex, margin}]`, `createdAt`.
- `attendancerecords.neighbour{heardBy, status}`.

**API.**

| Method & path | Who | Request → Response |
| --- | --- | --- |
| `GET /sessions/:sessionId/id-round` | Student | → `{startsAt, slotMs, mySlot, slotCount}` |
| `POST /sessions/:sessionId/neighbour-reports` | Student (signed) | `{heard:[{slotIndex, margin}]}` → `{ok}` |

**Backend / frontend.** Slot signal = short frame encoding a per-session random slot token (not the student id); server maps tokens → students. `CheckIn.jsx` runs the round using the Phase 4 transmitter/receiver and Phase 6 server clock. Decision adds `neighbour` input.

**Rollout.** First **record-only** (store data, don't affect status) during rehearsals/pilot to choose the threshold; then enforce (`heardBy < threshold` → `review`).

**Done when.** Rehearsal data shows inside phones heard by ≥ threshold neighbours and a phone outside the door is not; threshold recorded in `plan.md`.

---

### Phase 13 — Pilot readiness & launch

**Goal.** Run Bio Attend in a real class (70–120 students) in **shadow mode** next to a normal roll call, and measure it.

**Depends on.** All phases in the minimum pilot path.

**What users get.**
- *Student:* privacy notice + consent before first use; help page ("my phone can't hear", "camera won't open").
- *Teacher:* pilot checklist and a one-page guide.

**Database.** `users.consent{version, acceptedAt}`.

**API.** `GET /consent/current` → `{version, text}` · `POST /me/consent {version}`.

**Work.**
- `/privacy` page: what is collected (Google profile, device public key, ID card, reference face, check-in frames, IP, optional GPS), why, how long (frames/IP/GPS 24 h; ID + reference face for the term), who can see it, how to opt out (manual check by teacher), how to raise a query. Required under India's DPDP Act 2023.
- Monitoring: request logging, error alerts (Render logs), face-service health on the API `/health`.
- Pilot runbook: warm-up (open site 2 min early), teacher phone placement, volume, what to do if the sound fails (fall back to roll call), data collection sheet.
- Remove `TEST_STUDENT_EMAILS` and `REACT_APP_GOOGLE_HOSTED_DOMAIN=` override before the pilot.
- Metrics: coverage (% joined), true present / false reject / false accept vs roll call, time to finish, review count, audibility complaints, iOS count.

**Done when.** Two pilot sessions completed; results table and honest findings written in `progress.md` and the project report.

---

## 6. Security rules (apply in every phase)

1. **Server decides.** No client field like `passed`, `matched`, `present` is ever trusted.
2. **Every student action that changes attendance is signed** by the bound device key over a fresh, single-use challenge.
3. **Keys and challenges are short-lived and single-use**; keys never shown or logged.
4. **Teacher can only touch their own classes**; ownership checked on every route (`getOwnedClass` pattern).
5. **Images are private**: served only to the student and their teachers, never public URLs.
6. **Minimum data, short retention**: TTL indexes delete evidence; lock at midnight.
7. **Per-route guards** in Express (never a blanket `router.use` that shadows later routers).
8. **Uploads**: MIME + size checks, memory storage, no file paths from clients.

## 7. Threat model — what stops which proxy

| Proxy attempt | Stopped by | Phase |
| --- | --- | --- |
| Friend answers roll call | No roll call; per-student sign-in | 1 |
| Code / QR shared on WhatsApp | Key exists only as sound, lives seconds | 5 |
| Recording replayed later | One-time, expiring keys | 5 |
| Fake GPS | GPS is not the proof | — |
| Absent student signs in on friend's phone | New device → review; face mismatch | 3, 9 |
| Friend brings the absent student's phone | Face mismatch | 9 |
| Photo / video held to the camera | Random liveness challenge, server-checked | 9 |
| Wrong face enrolled | Selfie must match the college ID card; teacher reviews unsure | 8 |
| Friend inside forwards key to an outside phone | Outside phone not heard by neighbours | 12 |
| Friend's phone runs two identities | Face check per identity; headcount + spot-check | 9, 10 |
| Skilled accomplice with modified client inside the room | Not fully stopped on the web; headcount + spot-check make it visible | 10 |

## 8. Testing strategy

| Level | What | How |
| --- | --- | --- |
| Unit (Node `node:test`) | Policies, roster, device proof, keys, decision table, reviews, reports | `npm test` in `attendance-backend` |
| Codec (Node) | Encode / decode, noise, echo, profiles, receiver | `npm run test:acoustic` |
| Face service (pytest) | Match / no-match / spoof samples, thresholds | `pytest` in `face-service` |
| Manual device tests | Lab, link test, rehearsals | Results in `progress.md` measurements log |
| End-to-end | Teacher + 2–3 phones on hosted URL after phases 5, 6, 9, 10 | Checklist in each phase's *Done when* |

## 9. Worked days (how it feels)

**Student — first day.** Opens site → Google → consent → photographs ID → selfie (turn left, blink) → "Verified ✅" → sees CS301 in "Your classes".

**Teacher — normal class.** Minute 45: opens Live check-in on phone → Start → phone face-up on the desk → watches 0 → 58 present in ~2 min, 2 in review → types headcount 60 → Close. Evening: opens Reviews → one student's frames are dark but clearly them → Mark present; one shows a different face → Mark absent.

**Student — normal class.** Card "Check-in open" → Join → "Listening…" → "Heard ✅ — helping classmates…" → camera: "turn right, then blink" → "Present ✅".

**Student — phone couldn't hear.** Result "Not heard" → face passes → "In review" → raises query "phone speaker weak" → teacher approves same day.

**Cheating attempt.** Friend carries absent Ravi's phone → sound ✓, face ✗ → review with frames → teacher sees a different face → absent, audit logged.

## 10. Not in v1

- Native Android / iOS app (Play Integrity, native audio, BLE) — revisit after the web pilot.
- iOS Safari support (iOS students use the review path during the pilot).
- Multi-college / multi-department admin portal.
- Integration with the college ERP.
- Stopping a skilled in-room accomplice running a modified client (made visible, not prevented).

## 11. One-line summary

Bio Attend marks a student present only when **their own bound phone** hears a **seconds-old key played as sound inside the room** and **their live face matches their ID-verified reference** — built in 14 phases, each standing on the ones before it, with the server deciding everything and the teacher resolving only the unsure cases the same day.

---

### Keeping this file current

Update the **Shipped status** table at the end of every phase, and record real test results in `progress.md`.
