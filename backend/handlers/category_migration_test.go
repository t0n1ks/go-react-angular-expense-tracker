package handlers

import (
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// The migration keys exact-match unmodified defaults (any language), and leaves
// renamed defaults, user categories, and edited categories untouched. It never
// touches transactions, and it's idempotent.
func TestCategoryKeyMigration(t *testing.T) {
	setupFlowDB(t)
	u := models.User{Username: "catmig", Password: "x"}
	database.DB.Create(&u)

	now := time.Now()
	mk := func(name string, updated time.Time) *models.Category {
		c := models.Category{UserID: u.ID, Name: name, CreatedAt: now, UpdatedAt: updated}
		database.DB.Create(&c)
		return &c
	}
	food := mk("Еда", now)                     // seeded default (ru) → key
	fixed := mk("Fixkosten", now)              // salary-cycle default (de) → key
	renamed := mk("Продукты", now)             // renamed default → NO key
	userCat := mk("Groceries", now)            // user category → NO key
	edited := mk("Food", now.Add(time.Minute)) // default name but modified → NO key

	// A transaction linked to the default, to prove links/data are untouched.
	database.DB.Create(&models.Transaction{
		UserID: u.ID, CategoryID: food.ID, Amount: 10, Type: "expense",
		Date: now, CreatedAt: now, UpdatedAt: now,
	})

	MigrateDefaultCategoryKeys()

	reload := func(c *models.Category) models.Category {
		var out models.Category
		database.DB.First(&out, c.ID)
		return out
	}
	if k := reload(food).TranslationKey; k != "category.food" {
		t.Errorf("food: want category.food, got %q", k)
	}
	if k := reload(fixed).TranslationKey; k != "category.fixed_payments" {
		t.Errorf("fixed: want category.fixed_payments, got %q", k)
	}
	if k := reload(renamed).TranslationKey; k != "" {
		t.Errorf("renamed default must not be keyed, got %q", k)
	}
	if k := reload(userCat).TranslationKey; k != "" {
		t.Errorf("user category must not be keyed, got %q", k)
	}
	if k := reload(edited).TranslationKey; k != "" {
		t.Errorf("edited category must not be keyed, got %q", k)
	}

	// Transaction ↔ category link untouched.
	var txCount int64
	database.DB.Model(&models.Transaction{}).Where("category_id = ?", food.ID).Count(&txCount)
	if txCount != 1 {
		t.Errorf("transaction link changed: count=%d", txCount)
	}

	// Idempotent: a second run changes nothing more (food already keyed).
	MigrateDefaultCategoryKeys()
	if k := reload(food).TranslationKey; k != "category.food" {
		t.Errorf("idempotency: food key changed to %q", k)
	}
}
