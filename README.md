# Financer

**A full-stack personal finance tracker powered by a retro pixel-art UFO that watches your wallet.**

Financer combines serious budget management with a Tamagotchi-style UFO companion that reacts to your spending in real time — sharing financial wisdom, triggering animated events (cow abductions, coin showers), and gently nudging you when no transactions have been logged today.

---

## Live Demo

| Service | URL |
|---|---|
| Frontend (Vercel) | [go-react-angular-expense-tracker.vercel.app](https://go-react-angular-expense-tracker.vercel.app) |
| Backend (Render) | Auto-spins on first request — expect a 30 s cold start |

---

## What Makes It Different

Most expense trackers are spreadsheets with a UI. Financer is a spreadsheet with a personality.

The **UFO Tamagotchi Widget** runs an organic state machine that cycles through idle hover, animated events, and context-aware speech bubbles — all self-contained inside a pixel-grid mini-screen on the Dashboard. The UFO knows whether you logged a transaction today, adjusts its position dynamically based on measured bubble height via `ResizeObserver`, and fires facts, jokes, or "I'm hungry for data" messages at randomised 15–20 s intervals. No global overlay, no separate component — the whole world fits inside the widget.

---

## Key Features

### UFO Tamagotchi Widget
- **State machine** with four modes: `idle`, `greeting`, `ai_bubble`, `tour` — stale-closure-safe via `modeRef` / `messageRef` pattern
- **Organic idle animations:** 50% quiet hover with pixel moon, 17% cow abduction beam event, 17% coin shower, 16% random fact bubble — each triggered by a randomised 15–20 s timer
- **Dynamic UFO positioning on mobile:** `ResizeObserver` measures actual bubble height, then computes `ufoCenter = BUBBLE_TOP_PAD + bubbleH + UFO_GAP + UFO_HALF_H` — the UFO always clears the bubble regardless of text length
- **Mood logic:** when no transactions are recorded today, the UFO switches to a "hungry for data" message pool 35% of the time
- **In-widget guided tour:** highlights sidebar nav items via `classList.add('tour-highlight-active')` without leaving the widget; first-login greeting persisted in `localStorage`
- **128+ localised content entries** — humor, financial facts, actionable tips, and hungry messages

### Full Finance Tracking
- Income / expense transactions with categories, amounts, dates, descriptions, and income type (full salary / partial)
- Undo-delete with a 5.5 s grace period via bottom snackbar; the actual API call is deferred until timeout
- Inline row editing on desktop; card-based editing on mobile
- Monthly spending goal with colour-coded progress bar (green → amber → red)
- Weekly pacing advisor powered by `useAIAssistant` hook: detects salary arrival, tracks spend rate vs weekly limit, fires contextual messages per session fingerprint (no duplicate nags)

### Multi-language (i18n)
Full **EN / DE / RU / UK** support — UI strings, UFO content pool, financial tips, error messages, tour steps. Language switcher in Settings persists across sessions. All arrays in locale files are typesafe via `{ returnObjects: true }`.

### Progressive Web App
- `manifest.json` with `"display": "standalone"` for home-screen installation
- iOS-specific meta: `apple-mobile-web-app-capable`, `black-translucent` status bar, `apple-touch-icon`, `viewport-fit=cover`
- `overscroll-behavior-y: contain` — eliminates pull-to-refresh rubber-band in PWA mode
- Haptic feedback via `navigator.vibrate(10)` on transaction add, transaction delete, and category delete

### Smart UX Details
- **50/30/20 Rule explainer** — click the ⓘ icon next to "Apply Rule" → compact popup with outside-click dismiss, localised in all 4 languages
- **Category name wrapping** — `overflow-wrap: break-word; hyphens: auto; font-size: clamp()` handles long German compound nouns without truncation
- **Toast centering** — `x: '-50%'` passed to Framer Motion's `style` prop merges with the `y` spring animation into a single composite transform; no CSS `transform` conflict on mobile
- **Light / Dark theme** with CSS variable switching persisted to `localStorage`, respects `prefers-color-scheme` on first visit
- **Delete account flow** — GDPR-style confirmation modal; requires typing the username before deletion is allowed

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend language | Go 1.21 |
| HTTP framework | Gin |
| ORM | GORM |
| Database (local) | SQLite (`glebarez/sqlite`, zero config) |
| Database (production) | PostgreSQL via `DATABASE_URL` env var (Neon.tech) |
| Auth | JWT · 24 h expiry · `golang-jwt/jwt` |
| Frontend framework | React 19 + TypeScript |
| Build tool | Vite 7 |
| Animations | Framer Motion |
| Styling | Tailwind CSS + custom CSS (CSS variables for full theme coverage) |
| i18n | i18next + react-i18next |
| Charts | Recharts |
| Icons | Lucide React |
| HTTP client | Axios (pre-configured instance with auth interceptor in `AuthContext`) |
| Deployment — frontend | Vercel (Vite preset) |
| Deployment — backend | Render (Docker) |
| Deployment — database | Neon.tech Serverless PostgreSQL |

---

## Architecture

### Backend (`backend/`)

```
main.go                — Gin router, CORS config, route registration
database/database.go   — GORM Open (SQLite or Postgres), AutoMigrate, username normalisation
models/                — User, Category, Transaction structs
handlers/user.go       — Register, Login, GetProfile, UpdateProfile, DeleteAccount; owns jwtSecret
handlers/category.go   — Full CRUD for categories
handlers/transaction.go — Full CRUD + daily/period summary endpoints
middleware/auth.go     — JWT validation; injects userID into Gin context
```

**Route map:**

| Visibility | Method | Path | Handler |
|---|---|---|---|
| Public | POST | `/api/register` | `RegisterUser` |
| Public | POST | `/api/login` | `LoginUser` |
| Public | GET | `/api/health` | health check |
| Protected | GET/POST | `/api/categories` | list / create |
| Protected | PUT/DELETE | `/api/categories/:id` | update / delete |
| Protected | GET/POST | `/api/transactions` | list / create |
| Protected | GET/PUT/DELETE | `/api/transactions/:id` | get / update / delete |
| Protected | GET | `/api/profile` | user profile |
| Protected | PUT | `/api/profile` | update profile & settings |
| Protected | DELETE | `/api/user` | delete account + all data |
| Protected | GET | `/api/summary/daily` | daily totals |
| Protected | GET | `/api/summary/period` | period aggregation |
| Protected | GET | `/api/stats` | per-category breakdown |

### Frontend (`frontend-react/src/`)

```
context/
  AuthContext.tsx      — JWT storage, Axios instance with auth interceptor, login/logout
  SettingsContext.tsx  — Currency, goals, AI toggles; synced with /api/profile
  ThemeContext.tsx     — Light/dark toggle, persisted to localStorage
pages/
  Dashboard.tsx        — Stat cards + TamagotchiWidget + hasTxToday computation
  Transactions.tsx     — Full CRUD · desktop table · mobile cards · undo-delete
  Categories.tsx       — Grid CRUD · smart word-wrap · undo-delete
  Statistics.tsx       — Recharts pie + period selector
  Settings.tsx         — Currency, language, 50/30/20 rule explainer, goals, delete account
components/
  TamagotchiWidget.tsx — UFO state machine, ResizeObserver positioning, in-widget tour
  TamagotchiWidget.css — Pixel-grid dark screen, CSS animations, responsive sizing
  Layout.tsx           — Sidebar (desktop) + bottom nav (mobile), theme toggle
  DeleteSnackbar.tsx   — Framer Motion toast with undo + dismiss
hooks/
  useAIAssistant.ts    — Weekly pacing tiers, idle humor queue, session fingerprint dedup
i18n/locales/          — en.json · de.json · ru.json · uk.json (128+ entries each)
```

---

## Getting Started

### Prerequisites

- Go 1.21+
- Node.js 18+
- PostgreSQL — optional; SQLite is used automatically when `DATABASE_URL` is not set

### Quick start with Docker

```bash
docker compose up --build
```

App available at `http://localhost`. The SQLite database is persisted in a named Docker volume.

```bash
# Set a real JWT secret
JWT_SECRET=my-secure-secret docker compose up --build
```

### Backend (no Docker)

```bash
cd backend

# Install Air for hot reload (one-time)
go install github.com/air-verse/air@latest

air          # hot reload
# or
go run .     # direct
```

Server starts on `http://localhost:8080`.

### Frontend

```bash
cd frontend-react
npm install
npm run dev      # http://localhost:5173
npm run build    # TypeScript check + Vite production build
npm run lint     # ESLint
```

Create `frontend-react/.env.local`:

```env
VITE_API_URL=http://localhost:8080/api
```

### Environment Variables — Full Reference

| Service | Variable | Notes |
|---|---|---|
| Backend | `DATABASE_URL` | Postgres connection string; omit for SQLite |
| Backend | `JWT_SECRET` | Any random 64-char string — generate with `openssl rand -hex 32` |
| Backend | `PORT` | Default `8080`; injected automatically on Render |
| Backend | `CORS_ORIGINS` | Comma-separated allowed origins, e.g. `https://myapp.vercel.app` |
| Backend | `DB_PATH` | SQLite file path; default `expenses.db` |
| Frontend | `VITE_API_URL` | Backend URL + `/api` suffix |

---

## Production Deployment

The production stack runs on three free tiers: Vercel + Render + Neon.tech.

### 1 — Neon.tech (PostgreSQL)

1. Sign up → create a project → copy the connection string:
   `postgres://user:pass@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`
2. GORM `AutoMigrate` creates all tables on first boot — no manual schema needed.

### 2 — Render (Go Backend)

1. New → Web Service → connect GitHub repo
2. **Root Directory:** `backend`, **Runtime:** Docker
3. Add environment variables: `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`
4. Note your public URL: `https://your-app.onrender.com`

> Do **not** set `PORT` — Render injects it automatically.

### 3 — Vercel (React Frontend)

1. New Project → import repo
2. **Framework Preset:** Vite, **Root Directory:** `frontend-react`
3. Add env var: `VITE_API_URL=https://your-app.onrender.com/api`
4. Deploy. `vercel.json` applies SPA rewrite rules so React Router routes load on direct access.

---

## Roadmap

- [ ] **Bank API integration** — Monobank / Plaid for automatic transaction import
- [ ] **Export** — download history as CSV or PDF report with chart screenshots
- [ ] **Push notifications** — browser push for weekly budget summary and goal alerts
- [ ] **More UFO events** — meteor showers, alien diplomats, financial horoscopes
- [ ] **Additional UFO skins** — retro rocket, flying saucer variants, seasonal themes (Halloween accountant, Christmas budget elf)
- [ ] **Collaborative budgets** — shared expense tracking for couples or flatmates with real-time sync
- [ ] **AI spending predictions** — trend-based monthly forecast using past transaction patterns
- [ ] **Recurring transactions** — auto-log monthly bills and subscriptions with skip/pause support
- [ ] **Custom categories with icons** — emoji or icon picker; colour labels for chart clarity
- [ ] **Mobile app** — React Native shell with native haptics and offline-first sync

---

## License

MIT — do whatever you want, just don't blame the UFO.
