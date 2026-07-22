package handlers

import (
	"log"
	"strings"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// defaultCategoryNameToKey maps every KNOWN default category name — in any of the
// four seed languages (EN/DE/RU/UK) — to its stable translation key. It is the
// single source of truth used to (a) tag categories the app creates itself
// (registration + salary cycle) and (b) migrate existing users' exact-match
// defaults. It intentionally lists the REAL seeded strings (e.g. "Clothing",
// "Beauty" for de, "Базовые затраты") so live data is recognised; the display
// text lives in the frontend i18n files under these keys.
var defaultCategoryNameToKey = map[string]string{
	// Food
	"Food": "category.food", "Essen": "category.food", "Еда": "category.food", "Їжа": "category.food",
	// Clothing
	"Clothing": "category.clothing", "Kleidung": "category.clothing", "Одежда": "category.clothing", "Одяг": "category.clothing",
	// Entertainment
	"Entertainment": "category.entertainment", "Unterhaltung": "category.entertainment", "Развлечения": "category.entertainment", "Розваги": "category.entertainment",
	// Beauty (de is seeded as "Beauty")
	"Beauty": "category.beauty", "Красота": "category.beauty", "Краса": "category.beauty",
	// Income
	"Income": "category.income", "Einkommen": "category.income", "Доход": "category.income", "Дохід": "category.income",
	// Fixed Payments (salary cycle)
	"Fixed Payments": "category.fixed_payments", "Fixkosten": "category.fixed_payments", "Базовые затраты": "category.fixed_payments", "Базові витрати": "category.fixed_payments",
	// Saved Money (salary cycle)
	"Saved Money": "category.saved_money", "Ersparnisse": "category.saved_money", "Сбережения": "category.saved_money", "Заощадження": "category.saved_money",
}

// defaultCategoryKey returns the translation key for a known default category
// name (in any seed language), or "" if the name is not a recognised default
// (i.e. a user-created category, which is never translated).
func defaultCategoryKey(name string) string {
	return defaultCategoryNameToKey[strings.TrimSpace(name)]
}

// MigrateDefaultCategoryKeys is a one-time, idempotent migration that stamps the
// translation key onto existing categories whose name EXACTLY matches a known
// default (in any of the four seed languages), that don't already have a key,
// and that the user hasn't modified (updated_at ≈ created_at). A default the user
// renamed no longer matches a default name and is left untouched; user-created
// categories are never keyed. It only sets the display key — it never touches
// transactions or category↔transaction links. Re-running it changes nothing.
func MigrateDefaultCategoryKeys() {
	var cats []models.Category
	if err := database.DB.
		Where("translation_key IS NULL OR translation_key = ''").
		Find(&cats).Error; err != nil {
		log.Printf("category-key migration: load error: %v", err)
		return
	}

	updated := 0
	for _, cat := range cats {
		key := defaultCategoryKey(cat.Name)
		if key == "" {
			continue // user-created or renamed default → leave verbatim
		}
		// "Hasn't modified": seeded rows have created_at == updated_at; an edited
		// category has a much later updated_at. A 5s tolerance absorbs any
		// timestamp imprecision without catching genuinely edited rows.
		if cat.UpdatedAt.Sub(cat.CreatedAt) > 5*time.Second {
			continue
		}
		if err := database.DB.Model(&models.Category{}).
			Where("id = ?", cat.ID).
			Update("translation_key", key).Error; err != nil {
			log.Printf("category-key migration: update id=%d err=%v", cat.ID, err)
			continue
		}
		updated++
	}
	if updated > 0 {
		log.Printf("category-key migration: keyed %d default category(ies)", updated)
	}
}
