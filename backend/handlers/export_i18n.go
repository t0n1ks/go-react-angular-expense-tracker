package handlers

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// PDF localisation
//
// The Go backend has no i18n loader — it cannot read the frontend's locale
// JSON. The strings below therefore MIRROR frontend-react/src/i18n/locales/
// *.json (the `transactions.*` and `category.*` namespaces). When a label is
// changed there, change it here too, or the exported PDF and the on-screen UI
// will drift apart.
//
// Supported languages match the rest of the app: en / de / ru / uk.
// ─────────────────────────────────────────────────────────────────────────────

// pdfStrings holds every chrome label the PDF renders. User-entered content
// (descriptions, custom category names) is never translated.
type pdfStrings struct {
	Title       string // transactions.history
	GeneratedOn string // transactions.pdf_generated_on
	Records     string // count label for the sub-title
	ColDate     string // transactions.col_date
	ColCategory string // transactions.col_category
	ColAmount   string // transactions.col_amount
	ColType     string // transactions.col_type
	ColDesc     string // transactions.col_description
	Income      string // transactions.type_income
	Expense     string // transactions.type_expense
	NoTx        string // transactions.no_transactions
	NoCategory  string // transactions.no_category
}

var pdfStringsMap = map[string]pdfStrings{
	"en": {
		Title:       "Transaction History",
		GeneratedOn: "Generated on",
		Records:     "Records",
		ColDate:     "Date",
		ColCategory: "Category",
		ColAmount:   "Amount",
		ColType:     "Type",
		ColDesc:     "Description",
		Income:      "Income",
		Expense:     "Expense",
		NoTx:        "No transactions yet",
		NoCategory:  "No category",
	},
	"de": {
		Title:       "Transaktionsverlauf",
		GeneratedOn: "Erstellt am",
		Records:     "Einträge",
		ColDate:     "Datum",
		ColCategory: "Kategorie",
		ColAmount:   "Betrag",
		ColType:     "Typ",
		ColDesc:     "Beschreibung",
		Income:      "Einnahme",
		Expense:     "Ausgabe",
		NoTx:        "Noch keine Transaktionen",
		NoCategory:  "Keine Kategorie",
	},
	"ru": {
		Title:       "История операций",
		GeneratedOn: "Сформировано",
		Records:     "Записей",
		ColDate:     "Дата",
		ColCategory: "Категория",
		ColAmount:   "Сумма",
		ColType:     "Тип",
		ColDesc:     "Описание",
		Income:      "Доход",
		Expense:     "Расход",
		NoTx:        "Транзакций пока нет",
		NoCategory:  "Без категории",
	},
	"uk": {
		Title:       "Історія операцій",
		GeneratedOn: "Сформовано",
		Records:     "Записів",
		ColDate:     "Дата",
		ColCategory: "Категорія",
		ColAmount:   "Сума",
		ColType:     "Тип",
		ColDesc:     "Опис",
		Income:      "Дохід",
		Expense:     "Витрата",
		NoTx:        "Транзакцій поки немає",
		NoCategory:  "Без категорії",
	},
}

// pdfCategoryNames mirrors the `category.*` i18n namespace. Only the app's
// built-in categories appear here — they are the ones the backend stamps with a
// TranslationKey. User-created categories have an empty key and are rendered
// verbatim in every language.
var pdfCategoryNames = map[string]map[string]string{
	"en": {
		"category.food":           "Food",
		"category.clothing":       "Clothes",
		"category.entertainment":  "Entertainment",
		"category.beauty":         "Beauty",
		"category.income":         "Income",
		"category.saved_money":    "Saved Money",
		"category.fixed_payments": "Fixed Payments",
	},
	"de": {
		"category.food":           "Essen",
		"category.clothing":       "Kleidung",
		"category.entertainment":  "Unterhaltung",
		"category.beauty":         "Schönheit",
		"category.income":         "Einkommen",
		"category.saved_money":    "Ersparnisse",
		"category.fixed_payments": "Feste Zahlungen",
	},
	"ru": {
		"category.food":           "Еда",
		"category.clothing":       "Одежда",
		"category.entertainment":  "Развлечения",
		"category.beauty":         "Красота",
		"category.income":         "Доход",
		"category.saved_money":    "Сбережения",
		"category.fixed_payments": "Фиксированные платежи",
	},
	"uk": {
		"category.food":           "Їжа",
		"category.clothing":       "Одяг",
		"category.entertainment":  "Розваги",
		"category.beauty":         "Краса",
		"category.income":         "Дохід",
		"category.saved_money":    "Заощадження",
		"category.fixed_payments": "Фіксовані платежі",
	},
}

// monthNamesMap provides localized month names for PDF month sub-headers.
// Language codes match the convention used by /ai/next-action and /ai/analyze.
var monthNamesMap = map[string][12]string{
	"en": {"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December"},
	"de": {"Januar", "Februar", "März", "April", "Mai", "Juni",
		"Juli", "August", "September", "Oktober", "November", "Dezember"},
	"ru": {"Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
		"Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"},
	"uk": {"Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень",
		"Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"},
}

// normalizePDFLang reduces a BCP-47 tag ("de-DE") to a supported base subtag,
// falling back to English for anything the PDF has no strings for.
func normalizePDFLang(raw string) string {
	lang := strings.ToLower(strings.TrimSpace(strings.SplitN(raw, "-", 2)[0]))
	if _, ok := pdfStringsMap[lang]; !ok {
		return "en"
	}
	return lang
}

// pdfT returns the label set for a language already normalised by
// normalizePDFLang.
func pdfT(lang string) pdfStrings {
	if s, ok := pdfStringsMap[lang]; ok {
		return s
	}
	return pdfStringsMap["en"]
}

// pdfCategoryLabel mirrors frontend utils/categoryLabel.ts: a built-in category
// resolves through its translation key, a user-created one is printed exactly
// as typed. Unknown keys degrade to the stored name rather than to the raw key.
func pdfCategoryLabel(lang, translationKey, name, fallback string) string {
	if translationKey != "" {
		if translated, ok := pdfCategoryNames[lang][translationKey]; ok {
			return translated
		}
		if translated, ok := pdfCategoryNames["en"][translationKey]; ok {
			return translated
		}
	}
	if name != "" {
		return name
	}
	return fallback
}

func pdfMonthLabel(lang string, month time.Month, year int) string {
	names, ok := monthNamesMap[lang]
	if !ok {
		names = monthNamesMap["en"]
	}
	return fmt.Sprintf("%s %d", names[month-1], year)
}

// pdfDateFormat returns the Go layout matching each locale's everyday written
// date convention. English uses ISO-8601 rather than a regional MM/DD or DD/MM
// order, which would be ambiguous in a financial document.
func pdfDateFormat(lang string) string {
	switch lang {
	case "de", "ru", "uk":
		return "02.01.2006"
	default:
		return "2006-01-02"
	}
}

// pdfNumberSeparators returns the thousands and decimal separators for a
// locale. Russian and Ukrainian group with a non-breaking space so the PDF
// never wraps a number across a line.
func pdfNumberSeparators(lang string) (thousands, decimal string) {
	switch lang {
	case "de":
		return ".", ","
	case "ru", "uk":
		return " ", ","
	default:
		return ",", "."
	}
}

// pdfFormatAmount renders a monetary value with locale-appropriate grouping and
// the currency symbol in front — matching how the in-app UI displays amounts.
// Always two decimals, as befits a financial statement.
func pdfFormatAmount(lang, symbol string, amount float64) string {
	thousands, decimal := pdfNumberSeparators(lang)

	sign := ""
	if amount < 0 {
		sign = "-"
		amount = -amount
	}

	// Format to a fixed 2 decimals first, then re-group the integer part.
	raw := strconv.FormatFloat(amount, 'f', 2, 64)
	intPart, fracPart, _ := strings.Cut(raw, ".")

	var b strings.Builder
	for i, digit := range intPart {
		if i > 0 && (len(intPart)-i)%3 == 0 {
			b.WriteString(thousands)
		}
		b.WriteRune(digit)
	}

	return sign + symbol + b.String() + decimal + fracPart
}
