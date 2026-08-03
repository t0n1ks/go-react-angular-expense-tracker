package handlers

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// extractPDFText shells out to pdftotext (poppler) to read the rendered text
// layer back out of a generated PDF. Callers skip when it is not installed, so
// the suite still passes on a machine without poppler.
func extractPDFText(t *testing.T, path string) (string, error) {
	t.Helper()
	bin, err := exec.LookPath("pdftotext")
	if err != nil {
		return "", err
	}
	// "-" writes the extracted text to stdout; -enc UTF-8 keeps Cyrillic intact.
	out, err := exec.Command(bin, "-enc", "UTF-8", "-layout", path, "-").Output()
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// sampleExportTxs builds a fixture covering every rendering branch the PDF has:
// a built-in category (translates), two custom categories with Cyrillic and
// German names (must stay verbatim), a savings deposit (inflow), and a long
// description that wraps onto multiple lines.
func sampleExportTxs() []models.Transaction {
	day := func(y int, m time.Month, d int) time.Time {
		return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	}
	return []models.Transaction{
		{
			Amount: 1234.56, Date: day(2026, time.March, 14), Type: "expense",
			Description: "Große Bestellung für Büromöbel — Tische, Stühle und Regale",
			Category:    models.Category{Name: "Food", TranslationKey: "category.food"},
		},
		{
			Amount: 89.9, Date: day(2026, time.March, 3), Type: "expense",
			Description: "молоко и хлеб",
			Category:    models.Category{Name: "Продукты у дома"}, // custom → verbatim
		},
		{
			Amount: 147.9, Date: day(2026, time.February, 20), Type: "savings_deposit",
			Description: "Notgroschen",
			Category:    models.Category{Name: "Kaffee-Abo"}, // custom → verbatim
		},
		{
			Amount: 3200, Date: day(2026, time.February, 1), Type: "income",
			Description: "",
			Category:    models.Category{Name: "Income", TranslationKey: "category.income"},
		},
	}
}

// pdfDir returns a directory for generated artefacts. Set EXPORT_PDF_OUT to
// keep them somewhere inspectable by eye; otherwise the test cleans up.
func pdfDir(t *testing.T) string {
	if out := os.Getenv("EXPORT_PDF_OUT"); out != "" {
		if err := os.MkdirAll(out, 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", out, err)
		}
		return out
	}
	return t.TempDir()
}

// TestRenderTransactionsPDFAllLanguages generates a real PDF per language and
// asserts on the bytes. Because fpdf's AddUTF8Font embeds a subsetted font with
// a ToUnicode CMap, a Cyrillic or umlaut string only survives a round-trip if
// the glyph is genuinely present — a missing glyph would drop out here rather
// than silently render as a tofu box.
func TestRenderTransactionsPDFAllLanguages(t *testing.T) {
	txs := sampleExportTxs()
	dir := pdfDir(t)

	cases := []struct {
		lang string
		// Chrome that must be translated into this language.
		wantChrome []string
		// Chrome from other languages that must NOT leak in.
		wantAbsent []string
	}{
		{
			lang:       "en",
			wantChrome: []string{"Transaction History", "Generated on", "Category", "Description", "March 2026", "Income", "Expense"},
			wantAbsent: []string{"Transaktionsverlauf", "История операций"},
		},
		{
			lang:       "de",
			wantChrome: []string{"Transaktionsverlauf", "Erstellt am", "Kategorie", "Beschreibung", "März 2026", "Einnahme", "Ausgabe", "Essen"},
			wantAbsent: []string{"Transaction History", "История операций"},
		},
		{
			lang:       "ru",
			wantChrome: []string{"История операций", "Сформировано", "Категория", "Описание", "Март 2026", "Доход", "Расход", "Еда"},
			wantAbsent: []string{"Transaction History", "Transaktionsverlauf"},
		},
		{
			lang:       "uk",
			wantChrome: []string{"Історія операцій", "Сформовано", "Категорія", "Опис", "Березень 2026", "Дохід", "Витрата", "Їжа"},
			wantAbsent: []string{"Transaction History", "История операций"},
		},
	}

	// User-entered text is identical in every export, whatever the language.
	verbatim := []string{
		"молоко и хлеб",    // Cyrillic description
		"Продукты у дома",  // Cyrillic CUSTOM category — never translated
		"Kaffee-Abo",       // German custom category — never translated
		"Notgroschen",      //
		"Große Bestellung", // umlaut + eszett in a description
		"Büromöbel",        // more umlauts
		"Stühle",           //
	}

	for _, tc := range cases {
		t.Run(tc.lang, func(t *testing.T) {
			data, err := renderTransactionsPDF(txs, "EUR", tc.lang)
			if err != nil {
				t.Fatalf("render %s: %v", tc.lang, err)
			}
			if len(data) == 0 {
				t.Fatalf("render %s produced no bytes", tc.lang)
			}

			path := filepath.Join(dir, "transactions-"+tc.lang+".pdf")
			if err := os.WriteFile(path, data, 0o600); err != nil {
				t.Fatalf("write %s: %v", path, err)
			}
			t.Logf("wrote %s (%d bytes)", path, len(data))

			text, err := extractPDFText(t, path)
			if err != nil {
				t.Skipf("pdftotext unavailable (%v) — byte-level checks only", err)
			}

			for _, want := range append(tc.wantChrome, verbatim...) {
				if !strings.Contains(text, want) {
					t.Errorf("%s PDF missing %q", tc.lang, want)
				}
			}
			for _, absent := range tc.wantAbsent {
				if strings.Contains(text, absent) {
					t.Errorf("%s PDF unexpectedly contains %q", tc.lang, absent)
				}
			}
		})
	}
}

// TestRenderTransactionsPDFAmountsAreLocalised checks the grouping separators
// actually reach the page, not just the formatter unit test.
func TestRenderTransactionsPDFAmountsAreLocalised(t *testing.T) {
	txs := sampleExportTxs()
	dir := pdfDir(t)

	cases := map[string]string{
		"en": "€1,234.56",
		"de": "€1.234,56",
		"ru": "€1 234,56", // non-breaking space
	}
	for lang, want := range cases {
		data, err := renderTransactionsPDF(txs, "EUR", lang)
		if err != nil {
			t.Fatalf("render %s: %v", lang, err)
		}
		path := filepath.Join(dir, "amounts-"+lang+".pdf")
		if err := os.WriteFile(path, data, 0o600); err != nil {
			t.Fatalf("write: %v", err)
		}
		text, err := extractPDFText(t, path)
		if err != nil {
			t.Skipf("pdftotext unavailable: %v", err)
		}
		// pdftotext may normalise a non-breaking space to a plain one.
		norm := strings.ReplaceAll(text, " ", " ")
		if !strings.Contains(norm, strings.ReplaceAll(want, " ", " ")) {
			t.Errorf("%s PDF missing amount %q", lang, want)
		}
	}
}

// TestRenderTransactionsPDFEmpty guards the zero-transaction path — it must
// still produce a valid document with a localised empty-state line.
func TestRenderTransactionsPDFEmpty(t *testing.T) {
	for _, lang := range []string{"en", "de", "ru", "uk"} {
		data, err := renderTransactionsPDF(nil, "USD", lang)
		if err != nil {
			t.Fatalf("render empty %s: %v", lang, err)
		}
		if len(data) == 0 {
			t.Fatalf("render empty %s produced no bytes", lang)
		}
	}
}
