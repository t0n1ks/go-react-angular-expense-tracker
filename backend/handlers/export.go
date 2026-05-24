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

// initFontDir writes the embedded TTF to a temp directory exactly once per
// process lifetime. fpdf.AddUTF8Font requires a filesystem path.
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

	// A4 landscape usable width: 297 - lMargin - rMargin = 273mm
	pdfWDate = 24.0
	pdfWCat  = 48.0
	pdfWAmt  = 28.0
	pdfWType = 22.0
	pdfWDesc = 273.0 - pdfWDate - pdfWCat - pdfWAmt - pdfWType // 151mm
)

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

func pdfDrawTableHeader(pdf *fpdf.Fpdf) {
	pdf.SetFont("DejaVu", "", 9)
	pdf.SetFillColor(220, 224, 235)
	pdf.SetTextColor(30, 30, 30)
	pdf.SetXY(pdfLMargin, pdf.GetY())
	pdf.CellFormat(pdfWDate, pdfLineH, "Date",        "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWCat,  pdfLineH, "Category",    "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWAmt,  pdfLineH, "Amount",      "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWType, pdfLineH, "Type",        "1", 0, "CM", true, 0, "")
	pdf.CellFormat(pdfWDesc, pdfLineH, "Description", "1", 1, "CM", true, 0, "")
}

// ExportTransactionsPDF generates a PDF of all user transactions and streams
// it as an attachment download. Cyrillic is handled via embedded DejaVu Sans.
func ExportTransactionsPDF(c *gin.Context) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return
	}
	uid := userID.(uint)

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

	dir, err := initFontDir()
	if err != nil {
		log.Printf("export pdf: font init err=%v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "PDF generation failed"})
		return
	}

	pdf := fpdf.New("L", "mm", "A4", dir)
	pdf.SetMargins(pdfLMargin, pdfTMargin, pdfRMargin)
	pdf.SetAutoPageBreak(false, pdfBMargin)
	pdf.AddUTF8Font("DejaVu", "", "DejaVuSans.ttf")
	pdf.AddPage()

	_, pageH := pdf.GetPageSize()
	sym := pdfCurrencySymbol(user.Currency)

	// ── Title ─────────────────────────────────────────────────────────────────
	pdf.SetFont("DejaVu", "", 16)
	pdf.SetTextColor(20, 20, 20)
	pdf.SetXY(pdfLMargin, pdfTMargin)
	pdf.Cell(273, 9, "Transaction History")
	pdf.Ln(9)

	pdf.SetFont("DejaVu", "", 9)
	pdf.SetTextColor(120, 120, 120)
	pdf.Cell(273, 6, fmt.Sprintf("Generated: %s  ·  %d transactions", time.Now().Format("2006-01-02"), len(txs)))
	pdf.Ln(9)

	// ── Table header ──────────────────────────────────────────────────────────
	pdfDrawTableHeader(pdf)

	altRow := false

	for _, tx := range txs {
		date := tx.Date.Format("2006-01-02")
		cat := tx.Category.Name
		if cat == "" {
			cat = "—"
		}
		amt := fmt.Sprintf("%s%.2f", sym, tx.Amount)
		txTypeLabel := "Expense"
		if tx.Type == "income" {
			txTypeLabel = "Income"
		}
		desc := tx.Description

		// Row height — driven by how many lines the description needs
		descLines := pdf.SplitLines([]byte(desc), pdfWDesc)
		nLines := max(len(descLines), 1)
		rowH := float64(nLines) * pdfLineH

		// Manual page break before drawing the row
		if pdf.GetY()+rowH > pageH-pdfBMargin {
			pdf.AddPage()
			pdfDrawTableHeader(pdf)
			altRow = false
		}

		x := pdfLMargin
		y := pdf.GetY()

		// Alternating row background
		if altRow {
			pdf.SetFillColor(244, 246, 251)
		} else {
			pdf.SetFillColor(255, 255, 255)
		}

		// Date
		pdf.SetTextColor(40, 40, 40)
		pdf.SetFont("DejaVu", "", 9)
		pdf.SetXY(x, y)
		pdf.CellFormat(pdfWDate, rowH, date, "1", 0, "LM", true, 0, "")

		// Category
		pdf.SetXY(x+pdfWDate, y)
		pdf.CellFormat(pdfWCat, rowH, cat, "1", 0, "LM", true, 0, "")

		// Amount — colored by type
		if tx.Type == "income" {
			pdf.SetTextColor(15, 128, 56)
		} else {
			pdf.SetTextColor(185, 28, 28)
		}
		pdf.SetXY(x+pdfWDate+pdfWCat, y)
		pdf.CellFormat(pdfWAmt, rowH, amt, "1", 0, "RM", true, 0, "")

		// Type label — same color as amount
		pdf.SetXY(x+pdfWDate+pdfWCat+pdfWAmt, y)
		pdf.CellFormat(pdfWType, rowH, txTypeLabel, "1", 0, "CM", true, 0, "")

		// Description — back to dark, MultiCell handles wrapping
		pdf.SetTextColor(40, 40, 40)
		pdf.SetXY(x+pdfWDate+pdfWCat+pdfWAmt+pdfWType, y)
		pdf.MultiCell(pdfWDesc, pdfLineH, desc, "1", "LT", true)

		pdf.SetXY(pdfLMargin, y+rowH)
		altRow = !altRow
	}

	// ── Stream as attachment ───────────────────────────────────────────────────
	var buf bytes.Buffer
	if err := pdf.Output(&buf); err != nil {
		log.Printf("export pdf: output err=%v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "PDF generation failed"})
		return
	}

	c.Header("Content-Disposition", `attachment; filename="transactions.pdf"`)
	c.Header("Cache-Control", "no-cache, no-store")
	c.Data(http.StatusOK, "application/pdf", buf.Bytes())
}
