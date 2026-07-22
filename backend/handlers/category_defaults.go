package handlers

import "strings"

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
