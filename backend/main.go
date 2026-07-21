package main

import (
	"log"
	"os"
	"strings"
	"time"

	"github.com/gin-contrib/cors"
	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"golang.org/x/time/rate"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/handlers"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/middleware"
)

func main() {
	// Load .env from repo root or backend/ — silently ignored if neither exists.
	_ = godotenv.Load("../.env", ".env")

	handlers.InitJWTSecret()
	database.Connect()
	go handlers.WarmUpBrain()
	handlers.StartBrainRepoller()

	router := gin.Default()

	// ── Global middleware ────────────────────────────────────────────────────
	router.Use(middleware.SecurityHeaders())
	// 512 KB body limit — generous for this API (no file uploads).
	// The /ai/analyze endpoint can carry a few hundred transactions; 512 KB
	// provides headroom while blocking oversized abuse payloads.
	router.Use(middleware.MaxBodySize(512 * 1024))

	// ── CORS ─────────────────────────────────────────────────────────────────
	allowOrigins := []string{"http://localhost:5173", "http://localhost"}
	if raw := os.Getenv("CORS_ORIGINS"); raw != "" {
		allowOrigins = strings.Split(raw, ",")
	}
	router.Use(cors.New(cors.Config{
		AllowOrigins:     allowOrigins,
		AllowMethods:     []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length", "Content-Disposition"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	// ── Public routes ─────────────────────────────────────────────────────────
	router.GET("/api/health", func(c *gin.Context) {
		c.JSON(200, gin.H{"status": "ok"})
	})

	// Strict rate limits on auth endpoints to mitigate brute-force and account
	// enumeration.  Token bucket: 10 req/min for login, 5 req/min for register,
	// both with a burst of up to 5 to absorb brief legitimate bursts.
	router.POST("/api/register",
		middleware.PerIP(rate.Every(12*time.Second), 5),
		handlers.RegisterUser,
	)
	router.POST("/api/login",
		middleware.PerIP(rate.Every(6*time.Second), 5),
		handlers.LoginUser,
	)

	// ── Protected routes ──────────────────────────────────────────────────────
	protected := router.Group("/api")
	protected.Use(middleware.AuthMiddleware())
	{
		protected.POST("/categories", handlers.CreateCategory)
		protected.GET("/categories", handlers.GetCategories)
		protected.PUT("/categories/:id", handlers.UpdateCategory)
		protected.DELETE("/categories/:id", handlers.DeleteCategory)

		protected.POST("/transactions", handlers.CreateTransaction)
		protected.GET("/transactions", handlers.GetTransactions)
		protected.GET("/transactions/:id", handlers.GetTransactionByID)
		protected.PUT("/transactions/:id", handlers.UpdateTransaction)
		protected.DELETE("/transactions/:id", handlers.DeleteTransaction)

		protected.GET("/profile", handlers.GetProfile)
		protected.PUT("/profile", handlers.UpdateProfile)
		protected.DELETE("/user", handlers.DeleteAccount)

		protected.GET("/summary/daily", handlers.GetDailySummary)
		protected.GET("/summary/period", handlers.GetPeriodSummary)
		protected.GET("/stats", handlers.GetPeriodSummary)

		// AI endpoints — per-user rate limit to protect the Python service.
		// 20 calls per minute per user (burst of 5) is far more than any
		// legitimate session needs; the frontend calls /analyze at most once per
		// page load and /next-action every 15–20 seconds.
		protected.POST("/ai/analyze",
			middleware.PerUser(rate.Every(3*time.Second), 5),
			handlers.AnalyzeBehavior,
		)
		protected.GET("/ai/next-action",
			middleware.PerUser(rate.Every(3*time.Second), 5),
			handlers.GetNextAction,
		)
		protected.GET("/ai/content",
			middleware.PerUser(rate.Every(3*time.Second), 5),
			handlers.GetCategorizedContent,
		)
		protected.POST("/ai/feedback", handlers.SendFeedback)
		protected.GET("/ai/status", handlers.GetAIServiceStatus)

		protected.GET("/transactions/export/pdf", handlers.ExportTransactionsPDF)

		protected.POST("/salary-cycle", handlers.StartSalaryCycle)
		protected.GET("/salary-cycle/current", handlers.GetCurrentSalaryCycle)
		protected.PATCH("/salary-cycle/current", handlers.UpdateCycleNextPayday)
		protected.DELETE("/salary-cycle/:id", handlers.DeleteSalaryCycle)
		protected.GET("/salary-cycle/history", handlers.GetSalaryCycleHistory)
		protected.POST("/salary-cycle/stop", handlers.StopSalaryCycle)
		protected.POST("/salary-cycle/resume", handlers.ResumeSalaryCycle)
		protected.POST("/salary-cycle/income", handlers.AddCycleIncome)
		protected.GET("/salary-cycle/savings-history", handlers.GetSavingsHistory)
		protected.POST("/salary-cycle/savings", handlers.AddSavingsManual)

		// Server-authoritative monthly budget for users without a salary cycle.
		protected.GET("/budget/current", handlers.GetCurrentBudget)
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Fatal(router.Run(":" + port))
}
