# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A pet project for learning Go and React — a full-stack expense tracker with a Go backend and a React frontend.

## Running the Project

**Backend** (from `backend/`):
```bash
# One-time: install Air for hot reload
go install github.com/air-verse/air@latest

# Dev with hot reload
air

# Or run directly
go run .
```
Backend runs on `http://localhost:8080`.

**React frontend** (from `frontend-react/`):
```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # TypeScript check + Vite build
npm run lint       # ESLint
```

## Architecture

### Backend (`backend/`)

Gin HTTP server with JWT-based auth and SQLite storage via GORM.

- `main.go` — router setup, CORS config (allows `:5173`), route registration
- `database/database.go` — GORM connection + `AutoMigrate` for all models; DB file is `backend/expenses.db`
- `models/` — GORM model structs: `User`, `Category`, `Transaction`
- `handlers/` — one file per resource (`user.go`, `category.go`, `transaction.go`); `user.go` owns the `jwtSecret` and exports `GetJWTSecret()` for middleware
- `middleware/auth.go` — JWT validation middleware; injects `userID` into Gin context

**Route structure:**
- Public: `POST /api/register`, `POST /api/login`
- Protected (require `Authorization: Bearer <token>`): all `/api/categories`, `/api/transactions`, `/api/summary/*`, `/api/stats`

JWT tokens expire after 24 hours. The secret is hardcoded in `handlers/user.go` — change before any real deployment.

### React Frontend (`frontend-react/`)

Vite + React 19 + TypeScript + Tailwind CSS.

- `src/context/AuthContext.tsx` — central auth state; stores token/user in `localStorage`; provides a pre-configured `axiosInstance` with the `Authorization` header interceptor. All API calls should use `axiosInstance` from `useAuth()`.
- `src/pages/` — full-page views: `Login`, `Register`, `Dashboard`, `Transactions`, `Categories`, `Statistics`
- `src/components/` — shared UI: `Layout` (sidebar/nav), `CategoryChart`, `PrivateRoute` (redirect wrapper)
- `src/App.tsx` — router setup; wraps everything in `AuthProvider`

## Git: Auto-commit and Push After Tasks

After completing any meaningful task or sub-task, automatically commit the changes to Git and push to GitHub.

- Use the **Conventional Commits** format for all commit messages, e.g.:
  - `feat: add login logic`
  - `fix: resolve api timeout`
  - `refactor: simplify auth middleware`
  - `docs: update README`
  - `chore: update dependencies`
- Commit messages must be in **English** and be descriptive and clean.
- Push to the current remote branch after every commit.
- This ensures progress is always backed up to GitHub.
