# PROJECT_CONTEXT.md

AI-oriented reference for the go-react-angular-expense-tracker project.
Intended as a seed document for new dependent projects.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Go 1.21+, Gin, GORM, SQLite (`backend/expenses.db`) |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS, i18next, recharts |
| Auth | JWT (HS256, 24h expiry) via `golang-jwt/jwt` |
| Dev tooling | Air (Go hot reload), ESLint, `npm run dev` on :5173, backend on :8080 |

---

## Backend Architecture

### Entry point: `backend/main.go`
- Loads CORS from env `CORS_ORIGINS` (comma-sep) or defaults to `http://localhost:5173,http://localhost`
- Mounts public routes, then wraps protected routes with `AuthMiddleware`
- Calls `database.InitDB()` which runs `AutoMigrate` for all models and normalizes usernames to lowercase on startup

### Auth flow
1. `POST /api/login` → validates bcrypt password → returns `{token, user_id, username}`
2. JWT payload: `{user_id: float64, username: string, exp: unix}`
3. `middleware/auth.go` validates Bearer token, stores `userID` (float64 → cast as needed) in Gin context key `"userID"`
4. JWT secret: env `JWT_SECRET` or hardcoded fallback — **change before production**
5. `handlers/user.go` exports `GetJWTSecret()` for middleware use

### Models (GORM)

```
User
  ID, CreatedAt, UpdatedAt (gorm.Model)
  Username          string  uniqueIndex, not null  — always stored lowercase
  Password          string  bcrypt hash
  Currency          string  default=USD
  AIAdviceEnabled   bool
  AIHumorEnabled    bool
  MonthlySpendingGoal float64 default=0
  ExpectedSalary    float64 default=0
  PaydayMode        string  default=smart  (smart|fixed)
  FixedPayday       int     default=0      (1-31, 0=unset)
  ManualNextPayday  string  default=""     (YYYY-MM-DD)

Category
  ID, UserID, Name, CreatedAt, UpdatedAt

Transaction
  ID, UserID, CategoryID
  Category    Category   — GORM Preload on GET
  Amount      float64    numeric(10,2), > 0
  Description string     max 255
  Date        time.Time  parsed from "2006-01-02"
  Type        string     expense|income
  IncomeType  string     one_time|part  (income only, default=one_time)
  CreatedAt, UpdatedAt
```

No foreign-key cascade in schema. `DELETE /api/user` manually cascades (transactions → categories → user) inside a transaction.

### Handler patterns
- Extract `userID` from context first; all queries include `WHERE user_id = ?`
- Validate with `c.ShouldBindJSON()` + manual field checks
- Error shape: `{"error": "message"}` for all non-2xx
- Conflict (duplicate username): `{"error": "username_already_exists"}` 409 — checked against both SQLite and PostgreSQL error strings
- Date range end: adjusted to `end_date 23:59:59` server-side (inclusive full day)
- `DELETE /api/transactions/:id` is instant (no server-side soft delete)

### Route map

```
Public
  GET  /api/health
  POST /api/register   body: {username, password, language}  → {message, user_id, username}
  POST /api/login      body: {username, password}             → {token, user_id, username}

Protected (Authorization: Bearer <token>)
  POST   /api/categories          body: {name}
  GET    /api/categories
  PUT    /api/categories/:id      body: {name}
  DELETE /api/categories/:id

  POST   /api/transactions        body: {category_id, amount, description, date, type, income_type?}
  GET    /api/transactions        query: ?category_id=&begin_date=&end_date=
  GET    /api/transactions/:id
  PUT    /api/transactions/:id    body: (any subset of POST fields)
  DELETE /api/transactions/:id

  GET    /api/profile
  PUT    /api/profile             body: {currency, ai_advice_enabled, ai_humor_enabled,
                                         monthly_spending_goal, expected_salary,
                                         payday_mode, fixed_payday, manual_next_payday}
  DELETE /api/user

  GET    /api/summary/daily       query: ?date=YYYY-MM-DD
  GET    /api/summary/period      query: ?begin_date=&end_date=
  GET    /api/stats               query: ?begin_date=&end_date=
```

Summary response shape:
```json
{"date":"YYYY-MM-DD","summary":[{"category":{"id":1,"name":"Food"},"total_amount":42.5}]}
```

---

## Frontend Architecture

### Provider nesting order (`main.tsx`)
```
ThemeProvider → AuthProvider → SettingsProvider → ErrorBoundary → RouterProvider
```
Order matters: SettingsContext depends on AuthContext; ErrorBoundary wraps the router.

### AuthContext (`src/context/AuthContext.tsx`)
Central auth + API layer. Every component that calls the API must use `useAuth()`.

Provides:
- `isAuthenticated`, `isLoading`, `user: {id, username}`, `token`
- `login(token, username, userId)` — writes to localStorage + state
- `logout()` — clears: `token`, `user`, `userId`, `ufo_intro_seen`, `user_settings`, `ai_shown_items`, `ai_advice_session`
- `axiosInstance` — baseURL from `VITE_API_URL` or `http://localhost:8080/api`; request interceptor reads fresh token from localStorage on every call (not from closure)

Critical: interceptor reads `localStorage.getItem('token')` each request — logout takes effect immediately without needing a context re-render.

### SettingsContext (`src/context/SettingsContext.tsx`)
Dual-layer: localStorage cache + backend sync.

Provides:
- `currency`, `aiAdviceEnabled`, `aiHumorEnabled`, `monthlySpendingGoal`, `expectedSalary`
- `paydayMode`, `fixedPayday`, `manualNextPayday`
- `saveSettings(partial)` — PUTs to `/api/profile` AND writes `user_settings` to localStorage
- `formatAmount(n)` — formats with locale + currency symbol
- Fetches profile on `isAuthenticated` change; uses `cancelled` flag to prevent stale setState

### ThemeContext
Stores `"dark"|"light"` in localStorage. Applies `"dark"` class to `document.documentElement`. Falls back to `prefers-color-scheme`.

### Page responsibilities

| Page | Key behavior |
|---|---|
| Login / Register | Auth forms; Register creates default categories via backend |
| Dashboard | Balance/income/expense summary, WeeklyBudgetCard, TamagotchiWidget + AI advice |
| Transactions | Full CRUD; 5.5s undo-delete window; desktop table + mobile cards |
| Categories | Full CRUD; 5.5s undo-delete; inline edit |
| Statistics | Recharts pie (expense by category) + area (balance timeline) |
| Settings | Currency/language/AI toggles/budget goals/payday config/delete account |

### Component highlights

**WeeklyBudgetCard**
- Payday detection: `smart` mode → finds latest `income_type=one_time` transaction as payday; `fixed` mode → uses day-of-month
- `manualNextPayday` overrides smart detection
- Pacing formula: `(monthlyBudget - spentSincePayday) / (daysRemaining / 7)`

**TamagotchiWidget + useAIAssistant**
- 4-state FSM: idle → greeting → ai_bubble → tour
- `useAIAssistant` calculates a spending tier weekly (`salary_just_in`, `pacing_over`, `pacing_warn`, `pacing_great`, `balanced`, `pacing_good`) and fires advice once per tier change (tracked in sessionStorage)
- i18n string arrays: `t(key, {returnObjects: true})` returns `string[]`; random element picked. Locale files must use arrays for all AI message keys.
- Tour applies `tour-highlight-active` CSS class to nav items; uses different selectors for desktop vs. mobile

**Delete undo pattern**
- On delete: item removed from UI, `pendingDelete` ref set, `setTimeout(commit, 5500)`
- If another delete fires before timeout: previous pending commits immediately
- On navigation: pending delete commits immediately

### State management
- No Redux/Zustand. Context for cross-page state (auth, settings, theme). `useState` + `useCallback` + `useEffect` inside pages.
- Fetch pattern: `useCallback` → `axiosInstance.get()` → `setState`. Triggered on mount and after mutations.
- Form state: after transaction create, amount/description clear but date/category persist (batch entry UX).

### localStorage keys (do not collide in dependent projects)

| Key | Owner | Content |
|---|---|---|
| `token` | AuthContext | JWT string |
| `user` | AuthContext | `{id, username}` JSON |
| `userId` | AuthContext | numeric string |
| `user_settings` | SettingsContext | profile fields JSON |
| `theme` | ThemeContext | `"dark"` or `"light"` |
| `ufo_intro_seen` | TamagotchiWidget | bool string |
| `ai_shown_items` | useAIAssistant | tier tracking JSON |
| `ai_advice_session` | useAIAssistant | session ID |
| `i18nextLng` | i18next | locale string |

---

## Critical Nuances

1. **UserID type mismatch**: JWT stores `user_id` as float64 in Go's `MapClaims`. Cast with `uint(userID.(float64))` in handlers.

2. **Income type ↔ payday detection coupling**: Frontend payday detection assumes a "salary received" event is a transaction with `type=income` AND `income_type=one_time`. If a user marks a salary as `part`, payday detection silently breaks.

3. **No soft deletes**: Transactions and categories are hard-deleted. Undo is purely client-side (5.5s delay before API call). If the app crashes during the window, data is not deleted — no data loss risk.

4. **GORM `Preload("Category")` on transactions**: GET /transactions returns nested category object. If a category was deleted and a transaction still references it (shouldn't happen — UI prevents orphaning), the category field will be empty.

5. **Register creates default categories**: Backend `POST /api/register` inserts seed categories for the new user. The `language` field in the request body controls which locale strings are used for category names.

6. **CORS credentials**: `AllowCredentials: true` is set. Any new frontend origin must be added to `CORS_ORIGINS` env or the default list in `main.go`.

7. **Date-only fields**: All dates are transmitted as `YYYY-MM-DD` strings. Backend parses with Go's `"2006-01-02"` format. Frontend must not send ISO 8601 timestamps.

8. **safeParseDate utility**: `WeeklyBudgetCard` (and any component consuming dates from API) must guard against null/undefined before calling `new Date()`. Use the `safeParseDate` pattern from that component.

9. **i18n namespace**: All translations live in `public/locales/{lang}/translation.json`. AI message keys must be arrays. Components use `useTranslation()` with no explicit namespace (default).

10. **Mobile layout breakpoint**: Desktop sidebar at `md:` (768px). Below that, bottom nav. Transactions switch from table to card layout at the same breakpoint. Any new page should follow this pattern.

---

## Environment Variables

| Var | Default | Where used |
|---|---|---|
| `JWT_SECRET` | `supersecretkey_change_me_in_production` | Backend — change in prod |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost` | Backend |
| `VITE_API_URL` | `http://localhost:8080/api` | Frontend axiosInstance |

---

## Key File Index

```
backend/
  main.go                    — router, CORS, route registration
  database/database.go       — DB init, AutoMigrate, username normalization
  middleware/auth.go         — JWT validation, injects userID into context
  handlers/user.go           — register, login, profile, delete account, GetJWTSecret()
  handlers/category.go       — category CRUD
  handlers/transaction.go    — transaction CRUD + summary endpoints

frontend-react/src/
  main.tsx                   — provider nesting, router definition
  context/AuthContext.tsx    — auth state, axiosInstance, login/logout
  context/SettingsContext.tsx — user prefs, formatAmount, backend sync
  context/ThemeContext.tsx   — dark/light toggle
  components/Layout.tsx      — sidebar + mobile nav shell
  components/WeeklyBudgetCard.tsx — payday-aware budget pacing
  components/TamagotchiWidget.tsx — AI companion FSM + tour
  hooks/useAIAssistant.ts    — spending tier calc, advice dispatch
  pages/Dashboard.tsx        — main stats + AI integration point
  pages/Transactions.tsx     — CRUD + undo + responsive layout
  pages/Settings.tsx         — all user profile fields
```
