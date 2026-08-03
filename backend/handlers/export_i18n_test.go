package handlers

import "testing"

// TestNormalizePDFLang covers the tag shapes the frontend can send plus the
// fallback for anything unsupported.
func TestNormalizePDFLang(t *testing.T) {
	cases := map[string]string{
		"en":      "en",
		"de":      "de",
		"ru":      "ru",
		"uk":      "uk",
		"de-DE":   "de",
		"RU":      "ru",
		"  uk-UA": "uk",
		"fr":      "en", // unsupported → English
		"":        "en",
	}
	for in, want := range cases {
		if got := normalizePDFLang(in); got != want {
			t.Errorf("normalizePDFLang(%q) = %q; want %q", in, got, want)
		}
	}
}

// TestPDFStringsComplete guards against a half-finished translation: every
// supported language must fill every label, otherwise the PDF would render a
// blank heading or column title.
func TestPDFStringsComplete(t *testing.T) {
	for _, lang := range []string{"en", "de", "ru", "uk"} {
		s, ok := pdfStringsMap[lang]
		if !ok {
			t.Fatalf("pdfStringsMap missing language %q", lang)
		}
		fields := map[string]string{
			"Title": s.Title, "GeneratedOn": s.GeneratedOn, "Records": s.Records,
			"ColDate": s.ColDate, "ColCategory": s.ColCategory, "ColAmount": s.ColAmount,
			"ColType": s.ColType, "ColDesc": s.ColDesc, "Income": s.Income,
			"Expense": s.Expense, "NoTx": s.NoTx, "NoCategory": s.NoCategory,
		}
		for name, v := range fields {
			if v == "" {
				t.Errorf("pdfStringsMap[%q].%s is empty", lang, name)
			}
		}

		// The category namespace must cover the same keys in every language,
		// or a built-in category would silently fall back to English.
		if len(pdfCategoryNames[lang]) != len(pdfCategoryNames["en"]) {
			t.Errorf("pdfCategoryNames[%q] has %d keys; want %d (same as en)",
				lang, len(pdfCategoryNames[lang]), len(pdfCategoryNames["en"]))
		}
		for key := range pdfCategoryNames["en"] {
			if pdfCategoryNames[lang][key] == "" {
				t.Errorf("pdfCategoryNames[%q][%q] is missing", lang, key)
			}
		}
	}
}

// TestPDFCategoryLabel is the core product rule: built-in categories translate,
// user-created ones never do.
func TestPDFCategoryLabel(t *testing.T) {
	cases := []struct {
		name     string
		lang     string
		key      string
		catName  string
		fallback string
		want     string
	}{
		{"builtin translates to ru", "ru", "category.food", "Food", "—", "Еда"},
		{"builtin translates to de", "de", "category.fixed_payments", "Fixed Payments", "—", "Feste Zahlungen"},
		{"builtin translates to uk", "uk", "category.saved_money", "Saved Money", "—", "Заощадження"},
		{"custom stays verbatim in ru", "ru", "", "Молоко и хлеб", "—", "Молоко и хлеб"},
		{"custom stays verbatim in de", "de", "", "Kaffee-Abo", "—", "Kaffee-Abo"},
		{"custom latin name untouched in uk", "uk", "", "Netflix", "—", "Netflix"},
		{"unknown key degrades to stored name", "ru", "category.mystery", "Mystery", "—", "Mystery"},
		{"no category at all uses fallback", "ru", "", "", "Без категории", "Без категории"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := pdfCategoryLabel(tc.lang, tc.key, tc.catName, tc.fallback); got != tc.want {
				t.Errorf("pdfCategoryLabel(%q, %q, %q) = %q; want %q",
					tc.lang, tc.key, tc.catName, got, tc.want)
			}
		})
	}
}

// TestPDFFormatAmount checks locale grouping. Russian/Ukrainian group with a
// non-breaking space (U+00A0) so an amount never wraps inside the cell.
func TestPDFFormatAmount(t *testing.T) {
	const nbsp = " "
	cases := []struct {
		lang   string
		amount float64
		want   string
	}{
		{"en", 1220, "€1,220.00"},
		{"en", 1234567.5, "€1,234,567.50"},
		{"en", 0, "€0.00"},
		{"en", 999, "€999.00"},
		{"de", 1220, "€1.220,00"},
		{"de", 1234567.5, "€1.234.567,50"},
		{"ru", 1220, "€1" + nbsp + "220,00"},
		{"uk", 1234567.5, "€1" + nbsp + "234" + nbsp + "567,50"},
		{"ru", 12.3, "€12,30"},
		{"en", -45.6, "-€45.60"},
	}
	for _, tc := range cases {
		if got := pdfFormatAmount(tc.lang, "€", tc.amount); got != tc.want {
			t.Errorf("pdfFormatAmount(%q, %v) = %q; want %q", tc.lang, tc.amount, got, tc.want)
		}
	}
}

// TestPDFMonthLabel spot-checks Cyrillic and umlaut month names — the glyphs
// that would render as tofu without the embedded DejaVu font.
func TestPDFMonthLabel(t *testing.T) {
	cases := []struct {
		lang string
		want string
	}{
		{"en", "March 2026"},
		{"de", "März 2026"}, // umlaut
		{"ru", "Март 2026"}, // Cyrillic
		{"uk", "Березень 2026"},
		{"fr", "March 2026"}, // unsupported → English names
	}
	for _, tc := range cases {
		if got := pdfMonthLabel(tc.lang, 3, 2026); got != tc.want {
			t.Errorf("pdfMonthLabel(%q) = %q; want %q", tc.lang, got, tc.want)
		}
	}
}
