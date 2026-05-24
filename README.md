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

### Transaction History — Month Accordion
The Transactions page groups history by calendar month behind collapsible accordion headers. Each header shows the localized month name (`Intl.DateTimeFormat`), transaction count, and net balance (income − expenses) so users get an at-a-glance summary without expanding. Current month starts expanded; all past months start collapsed. Timezone-safe date parsing prevents UTC-offset shifts from misassigning transactions to the wrong month.

### ML-Powered End-of-Month Forecast
The Statistics page shows a **live end-of-month balance projection** computed by the Python AI brain using `scikit-learn` LinearRegression on cumulative daily expense data. The forecast card displays:
- Projected surplus or deficit (green / red with trend icon)
- Daily spending velocity (`total_expenses_this_month / days_elapsed`)
- Financial health score bar (0–100) with colour-coded fill
- Spending tier badge ("on track", "over budget", etc.)

Clicking the card opens a **detail modal** with a natural-language summary — "At your current spending rate of $42/day, you will have $312 left over by end of month" — plus days remaining and the raw health score. When payday is configured the card switches to a "balance at payday" projection. Degrades gracefully to hidden state when the AI service is offline.

### Transaction Detail Modal (Mini-Receipt)
Clicking any transaction row or mobile card opens a **receipt-style overlay** showing the full timestamp (date + `HH:mm:ss` from GORM's `created_at`), category, formatted amount, transaction type, and the user's original description. Uses Framer Motion spring animation — slide-up on mobile, fade-scale on desktop.

### Full Finance Tracking
- Income / expense transactions with categories, amounts, dates, descriptions, and income type (full salary / partial)
- Undo-delete with a 5.5 s grace period via bottom snackbar; the actual API call is deferred until timeout
- Inline row editing on desktop; card-based editing on mobile
- Monthly spending goal with colour-coded progress bar (green → amber → red)
- Weekly pacing advisor powered by `useAIAssistant` hook: detects salary arrival, tracks spend rate vs weekly limit, fires contextual messages per session fingerprint (no duplicate nags)
- **Hearts system** — the backend awards one heart when a user stays within their daily spending limit for 60 consecutive days; max 5 hearts per account
- **Reputation score** — foundation for future gamification; incremented by positive financial behaviour

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
| Backend language | Go 1.24 |
| HTTP framework | Gin |
| ORM | GORM |
| Database (local) | SQLite (`glebarez/sqlite`, zero config) |
| Database (production) | PostgreSQL via `DATABASE_URL` env var (Neon.tech) |
| Auth | JWT · 7-day expiry · `golang-jwt/jwt/v5` |
| Frontend framework | React 19 + TypeScript |
| Build tool | Vite 7 |
| Animations | Framer Motion |
| Styling | Tailwind CSS + custom CSS (CSS variables for full theme coverage) |
| i18n | i18next + react-i18next |
| Charts | Recharts |
| Icons | Lucide React |
| HTTP client | Axios (pre-configured instance with auth interceptor in `AuthContext`) |
| AI companion service | Python · FastAPI · scikit-learn · psycopg2 ([fin-guard-ai-service](https://github.com/t0n1ks/fin-guard-ai-service)) |
| Deployment — frontend | Vercel (Vite preset) |
| Deployment — backend | Render (Docker) |
| Deployment — database | Neon.tech Serverless PostgreSQL |

---

## Architecture

### Backend (`backend/`)

```
main.go                — Gin router, global middleware (rate limiting, security headers, body size cap)
database/database.go   — GORM Open (SQLite or Postgres), AutoMigrate, username normalisation
models/                — User, Category, Transaction structs
handlers/user.go       — Register, Login, GetProfile, UpdateProfile, DeleteAccount; owns jwtSecret
handlers/category.go   — Full CRUD for categories
handlers/transaction.go — Full CRUD + daily/period summary endpoints
handlers/ai.go         — Proxy for all /api/ai/* routes → fin-guard-ai-service; language normalisation
middleware/auth.go     — JWT validation; injects userID into Gin context
middleware/ratelimit.go — Token-bucket rate limiter (per-IP for auth, per-user for AI endpoints)
middleware/security.go — Security response headers + request body size cap
```

**Route map:**

| Visibility | Method | Path | Rate limit | Handler |
|---|---|---|---|---|
| Public | POST | `/api/register` | 5 / min per IP | `RegisterUser` |
| Public | POST | `/api/login` | 10 / min per IP | `LoginUser` |
| Public | GET | `/api/health` | — | health check |
| Protected | GET/POST | `/api/categories` | — | list / create |
| Protected | PUT/DELETE | `/api/categories/:id` | — | update / delete |
| Protected | GET/POST | `/api/transactions` | — | list / create |
| Protected | GET/PUT/DELETE | `/api/transactions/:id` | — | get / update / delete |
| Protected | GET | `/api/profile` | — | user profile |
| Protected | PUT | `/api/profile` | — | update profile & settings |
| Protected | DELETE | `/api/user` | — | delete account + all data |
| Protected | GET | `/api/summary/daily` | — | daily totals |
| Protected | GET | `/api/summary/period` | — | period aggregation |
| Protected | GET | `/api/stats` | — | per-category breakdown |
| Protected | POST | `/api/ai/analyze` | 20 / min per user | full behavior analysis — scores, mood, nudge, ML forecast |
| Protected | GET | `/api/ai/next-action` | 20 / min per user | next Tamagotchi action — JOKE / FACT / ADVICE / GREETING |
| Protected | POST | `/api/ai/feedback` | — | accept / reject signal for AI apology-mode tracking |

### AI Brain (`fin-guard-ai-service`)

The Go backend proxies all `/api/ai/*` requests to a separate Python FastAPI microservice. The Go layer sends only the last **90 days** of transactions to keep the payload bounded regardless of how long the user has been active.

```
Go backend ──POST /v1/analyze-behavior──► fin-guard-ai-service
           ◄── financial_health_score, tamagotchi_mood, smart_nudge,
               predicted_end_of_month_balance (LinearRegression) ──

Go backend ──GET /v1/tamagotchi/next-action──► fin-guard-ai-service
           ◄── { type: "JOKE"|"FACT"|"ADVICE"|"GREETING", content, animation_hint } ──
```

Language is passed explicitly via query param (`?language=uk`) so the UFO always speaks in the UI's selected language, independent of browser locale or server defaults.

See the [fin-guard-ai-service README](https://github.com/t0n1ks/fin-guard-ai-service) for its own deployment guide and API contract.

### Frontend (`frontend-react/src/`)

```
context/
  AuthContext.tsx      — JWT storage, Axios instance with auth interceptor, login/logout
  SettingsContext.tsx  — Currency, goals, AI toggles; synced with /api/profile
  ThemeContext.tsx     — Light/dark toggle, persisted to localStorage
pages/
  Dashboard.tsx        — Stat cards + TamagotchiWidget + hasTxToday computation
  Transactions.tsx     — Full CRUD · month accordion grouping · desktop table · mobile cards · undo-delete
  Categories.tsx       — Grid CRUD · smart word-wrap · undo-delete
  Statistics.tsx       — Recharts pie + balance timeline + ML forecast card
  Settings.tsx         — Currency, language, 50/30/20 rule explainer, goals, delete account
components/
  TamagotchiWidget.tsx     — UFO state machine, ResizeObserver positioning, in-widget tour
  ForecastCard.tsx         — Clickable ML forecast summary card with health bar
  ForecastDetailModal.tsx  — Framer Motion modal: spending rate, days left, health score
  TransactionDetailModal.tsx — Mini-receipt modal: full timestamp, description, category, amount
  Layout.tsx           — Sidebar (desktop) + bottom nav (mobile), theme toggle
  DeleteSnackbar.tsx   — Framer Motion toast with undo + dismiss
hooks/
  useAIAssistant.ts    — Weekly pacing tiers, idle humor queue, session fingerprint dedup
utils/
  groupTransactionsByMonth.ts — Timezone-safe grouping utility (used by Transactions page)
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
# 1. Copy env template and set the required secret
cp .env.example .env
# Edit .env and set JWT_SECRET (and optionally AI_SERVICE_KEY)
# Generate a strong secret:  openssl rand -hex 32

# 2. Start all services
docker compose up --build
```

App available at `http://localhost`.

> **JWT_SECRET is mandatory.** `docker compose up` will exit immediately with a helpful error message if it is not set in `.env`.

### Backend (no Docker)

```bash
cd backend

# Install Air for hot reload (one-time)
go install github.com/air-verse/air@latest

# Copy and fill in env vars
cp ../.env.example ../.env   # or backend/.env
# Set JWT_SECRET in .env — the server refuses to start without it

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

`frontend-react/.env` is already configured for local development:

```env
VITE_API_URL=http://localhost:8080/api
```

### Python AI Service (optional)

```bash
cd ../fin-guard-ai-service

# One-time: install dependencies
pip install -r requirements.txt

# Start the service
python -m app.main    # http://localhost:8001
```

The Go backend degrades gracefully when the AI service is unreachable — it returns empty 200 responses with fallback content, so the Tamagotchi stays functional but silent.

---

## Environment Variables — Full Reference

### Backend (`.env` in repo root or `backend/`)

| Variable | Required | Notes |
|---|---|---|
| `JWT_SECRET` | **Yes** | Random 64-char string. Generate: `openssl rand -hex 32`. Server exits on startup if unset. |
| `AI_SERVICE_URL` | No | URL of fin-guard-ai-service; default `http://localhost:8001` |
| `AI_SERVICE_KEY` | No | Shared secret for Go↔Python auth; generate with `openssl rand -hex 32` |
| `DATABASE_URL` | No | Postgres connection string (e.g. `postgres://user:pass@host/db?sslmode=require`). Omit for SQLite. |
| `DB_PATH` | No | SQLite file path; default `expenses.db` (inside `backend/`) |
| `PORT` | No | Default `8080`; injected automatically on Render — do not set manually |
| `CORS_ORIGINS` | No | Comma-separated allowed origins, e.g. `https://myapp.vercel.app` |

### Frontend (`frontend-react/.env`)

| Variable | Required | Notes |
|---|---|---|
| `VITE_API_URL` | Yes | Backend URL + `/api` suffix, e.g. `https://your-app.onrender.com/api` |

---

## Security Notes

- **JWT tokens** expire after **7 days**. The client validates expiry on startup and redirects to `/login` if the stored token is expired.
- **Rate limiting** is applied at the application layer: 10 req/min per IP on `/login`, 5 req/min per IP on `/register`, and 20 req/min per authenticated user on AI endpoints.
- **Request bodies** are capped at 512 KB globally.
- **Internal error details** (database messages, stack traces) are logged server-side only and never forwarded to clients.
- **Password hashing** uses bcrypt with the default cost factor (10). Minimum password length is 6 characters.
- All database queries use GORM's parameterised queries — no raw SQL string concatenation.
- IDOR is prevented by always scoping queries with `WHERE user_id = ?` alongside the resource ID.

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
   - Optionally: `AI_SERVICE_URL`, `AI_SERVICE_KEY`
4. Note your public URL: `https://your-app.onrender.com`

> Do **not** set `PORT` — Render injects it automatically.

### 3 — Vercel (React Frontend)

1. New Project → import repo
2. **Framework Preset:** Vite, **Root Directory:** `frontend-react`
3. Add env var: `VITE_API_URL=https://your-app.onrender.com/api`
4. Deploy. `vercel.json` applies SPA rewrite rules so React Router routes load on direct access.

### 4 — fin-guard-ai-service (AI Brain, optional)

1. Deploy [fin-guard-ai-service](https://github.com/t0n1ks/fin-guard-ai-service) to Render (its own `render.yaml` is included)
2. Set `AI_SERVICE_URL=https://your-brain.onrender.com` on the Go backend
3. Set `AI_SERVICE_KEY` to the same value as `BRAIN_API_KEY` in the Python service

---

## Related Projects

| Repo | Description |
|---|---|
| [fin-guard-ai-service](https://github.com/t0n1ks/fin-guard-ai-service) | Python FastAPI microservice — financial health scoring, spending forecasting, and Tamagotchi content engine |

---

## Roadmap

- [ ] **Bank API integration** — Monobank / Plaid for automatic transaction import
- [ ] **Export** — download history as CSV or PDF report with chart screenshots
- [ ] **Push notifications** — browser push for weekly budget summary and goal alerts
- [ ] **More UFO events** — meteor showers, alien diplomats, financial horoscopes
- [ ] **Additional UFO skins** — retro rocket, flying saucer variants, seasonal themes
- [ ] **Collaborative budgets** — shared expense tracking for couples or flatmates
- [ ] **Recurring transactions** — auto-log monthly bills and subscriptions with skip/pause support
- [ ] **Custom categories with icons** — emoji or icon picker; colour labels for chart clarity
- [ ] **Mobile app** — React Native shell with native haptics and offline-first sync

---

## License

MIT — do whatever you want, just don't blame the UFO.
