# Expense Tracker

A full-stack personal finance tracker built with **Go** and **React**. Track your income and expenses, organize them by category, visualize spending trends — with an interactive onboarding tour, multi-language support, and a seamless dark/light theme.

## Quick Start (Local — Docker)

The recommended way to run the full stack locally. No Go or Node.js installation required.

```bash
docker compose up --build
```

The app will be available at **http://localhost**.

> The SQLite database is persisted in a named Docker volume (`db-data`) and survives container restarts.

### Environment variables (local)

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *(insecure default)* | Secret used to sign JWT tokens. **Always set this in production.** |
| `DB_PATH` | `expenses.db` | Path to the SQLite file inside the container. |
| `CORS_ORIGINS` | `http://localhost,http://localhost:5173` | Comma-separated list of allowed CORS origins. |

```bash
JWT_SECRET=my-secure-secret docker compose up --build
```

---

## Production Deployment

The production stack uses three free-tier services:

| Layer | Service | Cost |
|-------|---------|------|
| Frontend | [Vercel](https://vercel.com) Hobby | $0/mo |
| Backend | [Render](https://render.com) Web Service | $0/mo (sleeps after 15 min inactivity) |
| Database | [Neon.tech](https://neon.tech) Serverless Postgres | $0/mo (free tier) |

### Step 1 — Neon.tech (PostgreSQL)

1. Sign up at **neon.tech** → create a new project.
2. Copy the **connection string** — it looks like:
   `postgres://user:password@ep-xxx.us-east-1.aws.neon.tech/neondb?sslmode=require`
3. *(Optional)* Paste `schema.sql` (repo root) into the Neon SQL console to pre-create tables.
   GORM `AutoMigrate` also creates all tables automatically on first backend boot.

### Step 2 — Render (Go Backend)

1. Go to **render.com** → New → **Web Service**.
2. Connect your GitHub repository.
3. Set the following:
   - **Root Directory**: `backend`
   - **Runtime**: Docker
4. Add these **Environment Variables** in the Render dashboard:

| Variable | Value |
|----------|-------|
| `DATABASE_URL` | Your Neon connection string |
| `JWT_SECRET` | Any random 64-character string |
| `CORS_ORIGINS` | Your Vercel app URL (e.g. `https://myapp.vercel.app`) |

> **Do not set `PORT`** — Render injects it automatically. The backend reads it via `os.Getenv("PORT")`.

5. Deploy. Note your public backend URL: `https://your-app.onrender.com`.

### Step 3 — Vercel (React Frontend)

1. Go to **vercel.com** → New Project → import your GitHub repository.
2. Set:
   - **Framework Preset**: Vite
   - **Root Directory**: `frontend-react`
3. Add this **Environment Variable**:

| Variable | Value |
|----------|-------|
| `VITE_API_URL` | `https://your-app.onrender.com/api` |

4. Deploy. Vercel detects `vercel.json` in `frontend-react/` and applies SPA rewrite rules
   so React Router routes like `/dashboard` load correctly on direct access.

### Production environment variables — full reference

| Service | Variable | Notes |
|---------|----------|-------|
| Render | `DATABASE_URL` | Neon postgres connection string (include `?sslmode=require`) |
| Render | `JWT_SECRET` | Random 64-char secret — generate with `openssl rand -hex 32` |
| Render | `CORS_ORIGINS` | Exact Vercel URL, e.g. `https://myapp.vercel.app` |
| Render | `PORT` | **Do not set** — injected automatically by Render |
| Vercel | `VITE_API_URL` | Render backend URL + `/api` suffix |

---

## Features

- **Authentication** — JWT-based register / login with protected routes
- **Transactions** — Create, edit (inline), and delete income/expense records
- **Categories** — Manage custom categories; deletion is blocked if transactions exist
- **Statistics** — Pie charts and period summaries powered by Recharts
- **Internationalization** — EN / DE / RU / UK language switcher (persisted to localStorage)
- **Theme System** — Seamless dark/light mode with Fintech-inspired palettes; respects `prefers-color-scheme` on first visit
- **Interactive Onboarding** — UFO-guided tour visits each nav item via `getBoundingClientRect()`, shows contextual speech bubbles, auto-advances, and fires once on first visit (restartable via the `?` button)
- **Responsive Dashboard** — Personalized welcome widget with adaptive layouts for mobile, tablet, and desktop

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Go 1.24, Gin, GORM, PostgreSQL (prod) / SQLite (local) |
| Auth | JWT (24h expiry) |
| Frontend | React 19, TypeScript, Vite |
| Animations | Framer Motion |
| State / Context | React Context API (Auth, Theme, Tour) |
| Styling | Tailwind CSS v4, CSS custom properties |
| i18n | react-i18next (EN / DE / RU / UK) |
| Charts | Recharts |
| Containerization | Docker, Docker Compose (local dev) |

## Local Development (without Docker)

### Prerequisites

- Go 1.24+
- Node.js 22+
- [Air](https://github.com/air-verse/air) (optional, for backend hot reload)

### Backend

```bash
cd backend
go run .
# Server starts on http://localhost:8080
```

Or with hot reload:

```bash
cd backend
air
```

### Frontend

```bash
cd frontend-react
npm install
npm run dev
# App starts on http://localhost:5173
```

Copy `.env.example` to `.env.local` and set `VITE_API_URL=http://localhost:8080/api` for local dev.

## Project Structure

```
.
├── backend/
│   ├── database/       # GORM connection + AutoMigrate (SQLite / PostgreSQL)
│   ├── handlers/       # Route handlers (users, categories, transactions, stats)
│   ├── middleware/     # JWT auth middleware
│   ├── models/         # GORM model structs
│   ├── main.go         # Router setup + CORS config
│   └── Dockerfile
├── frontend-react/
│   ├── src/
│   │   ├── components/ # Layout, GuidedTour, CategoryChart, LanguageSwitcher, PrivateRoute
│   │   ├── context/    # AuthContext (axios + token), ThemeContext, TourContext
│   │   ├── i18n/       # i18next config + EN/DE/RU/UK locale files
│   │   └── pages/      # Login, Register, Dashboard, Transactions, Categories, Statistics, Settings
│   ├── vercel.json     # SPA rewrite rules for Vercel
│   ├── .env.example    # Required environment variables
│   ├── nginx.conf      # Reverse-proxies /api/ to the backend (Docker only)
│   └── Dockerfile
├── schema.sql          # PostgreSQL schema for Neon.tech console
└── docker-compose.yml
```

## API Overview

All routes except `/api/register`, `/api/login`, and `/api/health` require `Authorization: Bearer <token>`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Health check (used by Docker) |
| POST | `/api/register` | Create account |
| POST | `/api/login` | Obtain JWT |
| GET/POST | `/api/categories` | List / create categories |
| PUT/DELETE | `/api/categories/:id` | Update / delete category |
| GET/POST | `/api/transactions` | List / create transactions |
| GET/PUT/DELETE | `/api/transactions/:id` | Get / update / delete transaction |
| GET | `/api/summary/daily` | Daily income vs expense totals |
| GET | `/api/summary/period` | Aggregated totals for a date range |
| GET | `/api/stats` | Per-category breakdown for a period |

## License

MIT
