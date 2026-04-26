# Expense Tracker

A full-stack personal finance tracker built with **Go** and **React**. Track your income and expenses, organize them by category, visualize spending trends — with an interactive onboarding tour, multi-language support, and a seamless dark/light theme.

## Quick Start

The recommended way to run the full stack. No Go or Node.js installation required.

```bash
docker compose up --build
```

The app will be available at **http://localhost**.

> The SQLite database is persisted in a named Docker volume (`db-data`) and survives container restarts.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | *(insecure default)* | Secret used to sign JWT tokens. **Always set this in production.** |
| `DB_PATH` | `expenses.db` | Path to the SQLite file inside the container. |
| `CORS_ORIGINS` | `http://localhost,http://localhost:5173` | Comma-separated list of allowed CORS origins. |

Example with a custom secret:

```bash
JWT_SECRET=my-secure-secret docker compose up --build
```

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
| Backend | Go 1.24, Gin, GORM, SQLite |
| Auth | JWT (24h expiry) |
| Frontend | React 19, TypeScript, Vite |
| Animations | Framer Motion |
| State / Context | React Context API (Auth, Theme, Tour) |
| Styling | Tailwind CSS v4, CSS custom properties |
| i18n | react-i18next (EN / DE / RU / UK) |
| Charts | Recharts |
| Containerization | Docker, Docker Compose |

## Local Development

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

## Project Structure

```
.
├── backend/
│   ├── database/       # GORM connection + AutoMigrate
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
│   ├── nginx.conf      # Reverse-proxies /api/ to the backend container
│   └── Dockerfile
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
