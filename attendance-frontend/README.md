# MarkMePresent — website

React single-page app for MarkMePresent. Project overview: [root README](../README.md); setup and hosting: [docs/setup.md](../docs/setup.md).

## Commands

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm start` | Dev server at http://localhost:3000 |
| `npm run start:shared` | Dev server on the LAN with a same-origin API proxy, for phone / tunnel testing |
| `npm run build` | Production build into `build/` (`CI=true` makes lint warnings fail it, as on Vercel) |
| `npm run test:acoustic` | Sound codec tests (Node's test runner) |

## Where things live

| Path | What |
| --- | --- |
| `src/ui/` | Shared UI kit: buttons, cards, badges, sheets, confirm, skeletons, app shell with the phone tab bar |
| `src/components/` | Pages: home, login, privacy, help, student and teacher screens, sound lab |
| `src/acoustic/` | The FSK sound codec and check-in audio |
| `src/face/` | Live face check (AWS Amplify UI liveness) |
| `public/tone-detector-worklet.js` | AudioWorklet that listens for tones in real time |
| `vercel.json` | Rewrites `/api/*` to the Render API and other paths to `index.html` |
