<div align="center">

<img src="attendance-frontend/public/logo.svg" width="72" alt="MarkMePresent logo" />

# MarkMePresent

**Classroom attendance that checks the student is really in the room: a near-silent sound key passed between phones, plus a live face check.**

Capstone project · NIT Jamshedpur · live at [markmepresent.vercel.app](https://markmepresent.vercel.app/)

![Node](https://img.shields.io/badge/node-%3E%3D22-339933?logo=node.js&logoColor=white)
![React](https://img.shields.io/badge/react-19-61dafb?logo=react&logoColor=white)
![MongoDB](https://img.shields.io/badge/mongodb-atlas-47A248?logo=mongodb&logoColor=white)

</div>

## Why

Roll calls and QR codes are easy to fake: a friend answers "present", or a code gets photographed and shared. MarkMePresent asks for two things a friend cannot easily give: the student's phone must **hear a short, near-silent sound key** that only carries inside the classroom, and the student must pass a **live face check** against the photo enrolled from their college ID. It is a website; nothing to install.

## How a check-in works

1. **The teacher starts a check-in** for the class. Their phone plays a one-time key as near-ultrasonic tones; the key changes every few seconds.
2. **Students tap Join.** Each phone listens, decodes the key and sends it with a proof signed by a private key that lives only in that browser (one phone per student).
3. **Phones that heard it pass it on** in short relay waves, so the back rows are covered too.
4. **A live face check** (AWS Rekognition liveness + face match) confirms the right person is holding the phone.
5. **Results:** present, review (the teacher decides) or absent. Students can raise a query; everything locks at 09:00 the next morning.

## Features

- **Google sign-in** with the college domain; teachers come from an allow-list, students from class rosters.
- **Identity enrollment**: college ID photo + selfie + live face check, reviewed by the teacher when unsure.
- **Trusted device**: one phone per student; a new phone needs the teacher's approval or a fresh face check.
- **Live check-in screen** for the teacher: head count, who is in, spot-check, close.
- **Reviews and queries**: borderline results and student disputes in one queue, with bulk decisions.
- **Reports**: per-class attendance by roll number, present / total and percentage, 75% flags, CSV export; per-student history.
- **Evening digest email** to teachers, automatic lock and data retention jobs.
- **Privacy notice** (`/privacy`) and **Help** (`/help`) pages, plus a sound lab to test a phone's speaker and microphone.

## Tech stack

| Layer | Uses |
| --- | --- |
| Website | React 19 (Create React App), React Router, Axios, Feather icons; hosted on Vercel |
| API | Node.js 22, Express, MongoDB Atlas + Mongoose; hosted on Render |
| Sound | Web Audio API + AudioWorklet, custom FSK codec (no audio libraries) |
| Face | AWS Rekognition Face Liveness (Amplify UI) and CompareFaces |
| Device proof | WebCrypto P-256 keys kept in the browser |
| Email / jobs | Brevo HTTP API; GitHub Actions cron for the scheduled jobs |
| Tests | Node's built-in test runner |

## Repository layout

```text
attendance-frontend/   React website: pages, UI kit (src/ui), sound codec (src/acoustic), face check (src/face)
attendance-backend/    Express API: auth, classes, devices, check-ins, face, reviews, reports, jobs
docs/setup.md          Local setup, configuration, hosting, outside services, monitoring, troubleshooting
FEATURES.md            Every feature, flow, data model, API and the phased build plan
progress.md            Current status, open items, measurements and build log
.github/workflows/     Scheduled jobs (lock, retention, digest)
```

## Quick start

```bash
cd attendance-backend && npm install && npm start      # API on :4000 (needs config/config.env)
cd attendance-frontend && npm install && npm start     # website on :3000
```

The full walkthrough (configuration, seeding rooms, phone testing over HTTPS, deployment) is in **[docs/setup.md](docs/setup.md)**.

## Tests

```bash
cd attendance-backend && npm test                 # backend unit tests
cd attendance-frontend && npm run test:acoustic   # sound codec tests
cd attendance-frontend && CI=true npm run build   # production build (lint warnings fail it)
```

## Status

Phases 0–11 are shipped and tested on real phones, with the redesign, the performance pass, the privacy notice and help pages. Neighbour verification (Phase 12) and the live class pilot (rest of Phase 13) are on hold. Details in [progress.md](progress.md).
