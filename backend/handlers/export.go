package handlers

import (
	"bytes"
	_ "embed"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-pdf/fpdf"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

//go:embed assets/fonts/DejaVuSans.ttf
var dejaVuSansFont []byte

var (
	fontOnce   sync.Once
	fontDir    string
	fontDirErr error
)

// initFontDir extracts the embedded TTF to a temp directory exactly once per
// process. fpdf.AddUTF8Font requires a real filesystem path.
func initFontDir() (string, error) {
	fontOnce.Do(func() {
		dir, err := os.MkdirTemp("", "pdf-font-*")
		if err != nil {
			fontDirErr = err
			return
		}
		if err := os.WriteFile(filepath.Join(dir, "DejaVuSans.ttf"), dejaVuSansFont, 0600); err != nil {
			os.RemoveAll(dir)
			fontDirErr = err
			return
		}
		fontDir = dir
	})
	return fontDir, fontDirErr
}

const (
	pdfLMargin = 12.0
	pdfTMargin = 15.0
	pdfRMargin = 12.0
	pdfBMargin = 15.0
	pdfLineH   = 6.5

	// A4 landscape: 297mm total, minus margins = 273mm usable.
	pdfTableW = 297.0 - pdfLMargin - pdfRMargin

	// Column widths (must sum to pdfTableW = 273mm).
	pdfWDate = 24.0
	pdfWCat  = 48.0
	pdfWAmt  = 28.0
	pdfWType = 22.0
	pdfWDesc = pdfTableW - pdfWDate - pdfWCat - pdfWAmt - pdfWType // 151mm

	// Month sub-header row is slightly taller than a data row.
	pdfMonthH = pdfLineH + 1.5
)

// Localised labels, month names, category names and number/date formatting all
// live in export_i18n.go.

type pdfMonthGroup struct {
	year  int
	month time.Month
	txs   []models.Transaction
}

// groupTxsByMonth groups a date-desc–sorted slice into consecutive month buckets.
func groupTxsByMonth(txs []models.Transaction) []pdfMonthGroup {
	var groups []pdfMonthGroup
	var lastKey string
	for _, tx := range txs {
		y, m, _ := tx.Date.Date()
		key := fmt.Sprintf("%04d-%02d", y, int(m))
		if key != lastKey {
			lastKey = key
			groups = append(groups, pdfMonthGroup{year: y, month: m})
		}
		groups[len(groups)-1].txs = append(groups[len(groups)-1].txs, tx)
	}
	return groups
}

func pdfCurrencySymbol(c string) string {
	switch c {
	case "USD":
		return "$"
	case "EUR":
		return "€"
	case "UAH":
		return "₴"
	default:
		return c + " "
	}
}

// pdfDrawColumnHeader draws the blue-gray column title row and resets the
// font to 9 pt so SplitLines calls that follow use the correct glyph widths.
//
// German and Russian headers are noticeably longer than the English ones
// ("Beschreibung", "Категория"), so the header row is set 1 pt smaller than the
// document default to keep every label on one line inside its column.
func pdfDrawColumnHeader(pdf *fpdf.Fpdf, s pdfStrings) {
	pdf.SetFont("DejaVu", "", 8)
	pdf.SetFillColor(220, 224, 235)
	pdf.SetTextColor(30, 30, 30)
	pdf.SetXY(pdfLMargin, pdf.GetY())
	pdf.CellFormat(pdfWDate, pdfLineH, s.ColDate, "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWCat, pdfLineH, s.ColCategory, "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWAmt, pdfLineH, s.ColAmount, "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWType, pdfLineH, s.ColType, "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWDesc, pdfLineH, s.ColDesc, "1", 1, "CM", true, 0, "")
	// Restore the data-row size so the SplitLines() calls that follow measure
	// description text with the correct glyph widths.
	pdf.SetFont("DejaVu", "", 9)
}

// pdfDrawMonthSubHeader draws a dark full-width row with the localised month
// name in white. It changes the font to 10 pt; callers must reset to 9 pt.
func pdfDrawMonthSubHeader(pdf *fpdf.Fpdf, label string) {
	pdf.SetFont("DejaVu", "", 10)
	pdf.SetFillColor(55, 65, 81)    // #374151 — dark slate
	pdf.SetTextColor(255, 255, 255) // white text
	pdf.SetXY(pdfLMargin, pdf.GetY())
	pdf.CellFormat(pdfTableW, pdfMonthH, "  "+label, "1", 1, "LM", true, 0, "")
}

// pdfDrawDataRow renders one transaction row with correct multi-line behaviour.
//
// The description column is drawn line-by-line with segmented borders so that
// internal horizontal rules never appear between wrapped lines:
//
//	single line  → border "1"  (all four sides)
//	first line   → border "TLR" (top + sides, no bottom)
//	middle lines → border "LR"  (sides only)
//	last line    → border "BLR" (bottom + sides, no top)
//
// Adjacent single-value cells (Date, Category, Amount, Type) receive the full
// rowH so their outer borders always align with the description cell's borders.
// Their text is vertically centred via the "M" alignment flag in CellFormat.
//
// Pre-conditions:
//   - Current font is 9 pt (so CellFormat uses the right metrics).
//   - descLines is non-empty (at least one []byte element).
//   - The caller has already handled the page break.
//
// txDirection maps a transaction type to its localised export display label and
// whether it is an inflow (income-like → green). Deposits to the savings pool
// are inflows; withdrawals are outflows. This must check the explicit type
// rather than assume the whole savings-pool category is an expense — otherwise
// a positive top-up (savings_deposit) is mislabeled as an expense.
func txDirection(t string, s pdfStrings) (label string, isIncome bool) {
	switch t {
	case "income", "savings_deposit":
		return s.Income, true
	case "savings_withdrawal":
		return s.Expense, false
	default: // "expense" and anything unknown
		return s.Expense, false
	}
}

func pdfDrawDataRow(pdf *fpdf.Fpdf, date, cat, amt, txTypeLabel string, isIncome bool, fill bool, descLines [][]byte) {
	nLines := len(descLines)
	rowH := float64(nLines) * pdfLineH

	x := pdfLMargin
	y := pdf.GetY()

	// ── Row background (alternating white / light blue-grey) ──────────────────
	if fill {
		pdf.SetFillColor(244, 246, 251)
	} else {
		pdf.SetFillColor(255, 255, 255)
	}

	// ── Date — single tall cell, text vertically centred ─────────────────────
	pdf.SetTextColor(40, 40, 40)
	pdf.SetXY(x, y)
	pdf.CellFormat(pdfWDate, rowH, date, "1", 0, "LM", true, 0, "")

	// ── Category ──────────────────────────────────────────────────────────────
	pdf.SetXY(x+pdfWDate, y)
	pdf.CellFormat(pdfWCat, rowH, cat, "1", 0, "LM", true, 0, "")

	// ── Amount & Type — coloured by transaction direction ─────────────────────
	if isIncome {
		pdf.SetTextColor(15, 128, 56)
	} else {
		pdf.SetTextColor(185, 28, 28)
	}
	pdf.SetXY(x+pdfWDate+pdfWCat, y)
	pdf.CellFormat(pdfWAmt, rowH, amt, "1", 0, "RM", true, 0, "")

	pdf.SetXY(x+pdfWDate+pdfWCat+pdfWAmt, y)
	pdf.CellFormat(pdfWType, rowH, txTypeLabel, "1", 0, "CM", true, 0, "")

	// ── Description — per-line cells with segmented borders ───────────────────
	// Drawing each line individually eliminates the unwanted internal horizontal
	// rules that MultiCell("1",...) would produce for wrapped text.
	pdf.SetTextColor(40, 40, 40)
	descX := x + pdfWDate + pdfWCat + pdfWAmt + pdfWType
	for i, lineBytes := range descLines {
		var border string
		switch {
		case nLines == 1:
			border = "1"
		case i == 0:
			border = "TLR"
		case i == nLines-1:
			border = "BLR"
		default:
			border = "LR"
		}
		pdf.SetXY(descX, y+float64(i)*pdfLineH)
		pdf.CellFormat(pdfWDesc, pdfLineH, string(lineBytes), border, 0, "LT", true, 0, "")
	}

	// Advance the cursor to the next row position.
	pdf.SetXY(pdfLMargin, y+rowH)
}

// ExportTransactionsPDF generates a PDF of all user transactions, grouped by
// calendar month, and streams it as a browser file-attachment download.
//
// Query params:
//
//	language — BCP-47 language tag; base subtag used for month names (en/de/ru/uk).
func ExportTransactionsPDF(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

	// Normalise language — same convention as normalizeLangForBrain. Every
	// piece of PDF chrome is rendered in this language.
	lang := normalizePDFLang(c.Query("language"))

	var user models.User
	if err := database.DB.First(&user, uid).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	var txs []models.Transaction
	if err := database.DB.Preload("Category").
		Where("user_id = ?", uid).
		Order("date desc").
		Find(&txs).Error; err != nil {
		log.Printf("export pdf: user=%v fetch err=%v", uid, err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch transactions"})
		return
	}

	data, err := renderTransactionsPDF(txs, user.Currency, lang)
	if err != nil {
		log.Printf("export pdf: render err=%v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "PDF generation failed"})
		return
	}

	c.Header("Content-Disposition", `attachment; filename="transactions.pdf"`)
	c.Header("Cache-Control", "no-cache, no-store")
	c.Data(http.StatusOK, "application/pdf", data)
}

// renderTransactionsPDF draws the whole document and returns the PDF bytes.
//
// Kept separate from the HTTP handler so the layout can be exercised directly
// in tests (no DB, no Gin context) — which is how the Cyrillic/umlaut rendering
// is verified.
//
// txs must be sorted date-descending; lang must already be normalised.
func renderTransactionsPDF(txs []models.Transaction, currency, lang string) ([]byte, error) {
	s := pdfT(lang)
	dateLayout := pdfDateFormat(lang)

	dir, err := initFontDir()
	if err != nil {
		return nil, err
	}

	pdf := fpdf.New("L", "mm", "A4", dir)
	pdf.SetMargins(pdfLMargin, pdfTMargin, pdfRMargin)
	pdf.SetAutoPageBreak(false, pdfBMargin)
	pdf.AddUTF8Font("DejaVu", "", "DejaVuSans.ttf")
	pdf.AddPage()

	_, pageH := pdf.GetPageSize()
	sym := pdfCurrencySymbol(currency)

	// ── Document title ────────────────────────────────────────────────────────
	pdf.SetFont("DejaVu", "", 16)
	pdf.SetTextColor(20, 20, 20)
	pdf.SetXY(pdfLMargin, pdfTMargin)
	pdf.Cell(pdfTableW, 9, s.Title)
	pdf.Ln(9)

	pdf.SetFont("DejaVu", "", 9)
	pdf.SetTextColor(120, 120, 120)
	pdf.Cell(pdfTableW, 6, fmt.Sprintf("%s %s  ·  %s: %d",
		s.GeneratedOn, time.Now().Format(dateLayout), s.Records, len(txs)))
	pdf.Ln(9)

	// ── Column header (first page) ────────────────────────────────────────────
	pdfDrawColumnHeader(pdf, s) // also resets font to 9 pt

	if len(txs) == 0 {
		pdf.SetFont("DejaVu", "", 10)
		pdf.SetTextColor(140, 140, 140)
		pdf.SetXY(pdfLMargin, pdf.GetY()+6)
		pdf.Cell(pdfTableW, pdfLineH, s.NoTx)
	}

	// ── Month groups ──────────────────────────────────────────────────────────
	for _, g := range groupTxsByMonth(txs) {
		// Ensure the month sub-header fits before drawing it.
		if pdf.GetY()+pdfMonthH > pageH-pdfBMargin {
			pdf.AddPage()
			pdfDrawColumnHeader(pdf, s)
		}
		pdfDrawMonthSubHeader(pdf, pdfMonthLabel(lang, g.month, g.year))
		// pdfDrawMonthSubHeader leaves the font at 10 pt — reset for data rows.
		pdf.SetFont("DejaVu", "", 9)

		// Each month section restarts the alternating row fill from white so
		// groups are visually self-contained.
		altRow := false

		for _, tx := range g.txs {
			// SplitLines requires the font to already be set to the correct size.
			descLines := pdf.SplitLines([]byte(tx.Description), pdfWDesc)
			if len(descLines) == 0 {
				descLines = [][]byte{{}}
			}
			rowH := float64(len(descLines)) * pdfLineH

			// Page break — entire row drawn on the new page, never split mid-row.
			if pdf.GetY()+rowH > pageH-pdfBMargin {
				pdf.AddPage()
				pdfDrawColumnHeader(pdf, s) // resets font to 9 pt
				altRow = false
			}

			// Built-in categories translate through their key; user-created
			// ones are printed verbatim in every language.
			cat := pdfCategoryLabel(lang, tx.Category.TranslationKey, tx.Category.Name, s.NoCategory)
			typeLabel, isIncome := txDirection(tx.Type, s)

			pdfDrawDataRow(
				pdf,
				tx.Date.Format(dateLayout),
				cat,
				pdfFormatAmount(lang, sym, tx.Amount),
				typeLabel,
				isIncome,
				altRow,
				descLines,
			)
			altRow = !altRow
		}
	}

	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
