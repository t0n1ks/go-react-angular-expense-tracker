package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log"
	"math"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── Companion endpoints ──────────────────────────────────────────────────────
//
//	GET  /api/companion/state     health, mood, reason, quest, next message
//	POST /api/companion/catch     a star or a cow was caught
//	POST /api/companion/reaction  👍 / 👎 on a message type (✕ is never sent)
//
// Go owns the companion: health and mood come from companion_health.go over
// the dashboard's own figures; the AI service only words a chosen message.
// All memory is one companion_states row per user.

const companionRenderTimeout = 1500 * time.Millisecond

// companionView is the payload of every companion endpoint.
type companionView struct {
	Health  int               `json:"health"`
	Mood    string            `json:"mood"`
	Reason  healthReason      `json:"reason"`
	Basis   string            `json:"basis"`
	Quest   companionQuest    `json:"quest"`
	Message *companionMessage `json:"message"`
}

type companionQuest struct {
	Open bool `json:"open"` // asked and not yet answered: a catch is wanted
}

// localDayKey is a local day as YYYY-MM-DD.
func localDayKey(t time.Time, k cycleClock) string { return t.In(k.Loc).Format("2006-01-02") }

// loadCompanionState returns the user's row, creating it (health 100,
// baseline yesterday) on the first meeting. created reports a new row.
func loadCompanionState(uid uint, k cycleClock) (models.CompanionState, bool) {
	var st models.CompanionState
	err := database.DB.First(&st, "user_id = ?", uid).Error
	if err == nil {
		return st, false
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		log.Printf("companion: load user=%d: %v", uid, err)
	}
	st = models.CompanionState{
		UserID:     uid,
		BaseHealth: healthMax,
		BaseDay:    localDayKey(k.dayStart(k.Now).AddDate(0, 0, -1), k),
	}
	return st, true
}

func saveCompanionState(st *models.CompanionState) {
	if err := database.DB.Save(st).Error; err != nil {
		log.Printf("companion: save user=%d: %v", st.UserID, err)
	}
}

// latestTxID is the user's newest transaction id (0 when none).
func latestTxID(uid uint) uint {
	var id uint
	database.DB.Model(&models.Transaction{}).Where("user_id = ?", uid).
		Select("COALESCE(MAX(id), 0)").Scan(&id)
	return id
}

// companionCheck brings the companion up to date and builds the view. With
// deliver it also runs the reaction engine (and records what it showed).
func companionCheck(user models.User, k cycleClock, lang string, deliver bool) companionView {
	st, created := loadCompanionState(user.ID, k)
	mem := decodeMemory(st)
	sig := companionFinance(user, k)
	today := k.dayStart(k.Now)

	spend := spendPenalty(sig.Facts)
	targetOn := func(day time.Time) float64 {
		return healthTarget(spend, questPenalty(st.QuestAskedAt, st.LastCatchAt, day, k))
	}

	var msg *companionMessage
	if deliver {
		msg = runReactions(user, k, sig, &st, &mem, created)
		if msg != nil {
			if text := renderCompanionText(user, *msg, lang); text != "" {
				msg.Text = text
			}
		}
	} else if created {
		primeReactionMemory(user.ID, sig, &st)
	}

	baseDay, err := time.ParseInLocation("2006-01-02", st.BaseDay, k.Loc)
	if err != nil {
		baseDay = today.AddDate(0, 0, -1)
	}
	base, newBaseDay, current := rollHealth(st.BaseHealth, baseDay, today, k, targetOn)
	st.BaseHealth, st.BaseDay = base, localDayKey(newBaseDay, k)

	engage := questPenalty(st.QuestAskedAt, st.LastCatchAt, today, k)
	questDays := 0
	if st.LastCatchAt != nil {
		questDays = localDaysBetween(k.dayStart(*st.LastCatchAt), today, k)
	}
	reason := explainHealth(current, targetOn(today), spend, engage, sig.Facts, questDays)

	mem.encode(&st)
	saveCompanionState(&st)

	return companionView{
		Health:  int(math.Round(current)),
		Mood:    moodFor(current),
		Reason:  reason,
		Basis:   sig.Basis,
		Quest:   companionQuest{Open: questOpen(st.QuestAskedAt, st.LastCatchAt)},
		Message: msg,
	}
}

// pacedBand is the pace band to remember: judged only when there is a budget,
// outside the grace days and while not overspent; otherwise unchanged.
func pacedBand(sig financeSignals, prev string) string {
	f := sig.Facts
	if !f.Active || f.inGrace() || f.Overspent {
		return prev
	}
	return paceBand(f.paceRatio(), prev)
}

// primeReactionMemory: on the first meeting nothing in the past is news —
// remember the current band, overspent state and newest transaction silently.
func primeReactionMemory(uid uint, sig financeSignals, st *models.CompanionState) {
	st.Band = pacedBand(sig, "good")
	st.Overspent = sig.Facts.Overspent
	st.LastTxID = latestTxID(uid)
}

// runReactions collects what is true now, picks at most one message and
// records it. The memory always advances (band, overspent, newest tx).
func runReactions(user models.User, k cycleClock, sig financeSignals, st *models.CompanionState, mem *companionMemory, created bool) *companionMessage {
	if created {
		primeReactionMemory(user.ID, sig, st)
	}
	since := k.Now.AddDate(0, 0, -baselineWindowDays)
	txs := loadWindowTransactions(user.ID, cycleWindow{Start: since}, k)

	var newTxs, history []windowTx
	maxID := st.LastTxID
	for _, t := range txs {
		if t.ID > st.LastTxID {
			newTxs = append(newTxs, t)
		} else {
			history = append(history, t)
		}
		maxID = max(maxID, t.ID)
	}
	sortNewestFirst(newTxs)

	cats := map[uint]models.Category{}
	var catRows []models.Category
	database.DB.Where("user_id = ?", user.ID).Find(&catRows)
	for _, c := range catRows {
		cats[c.ID] = c
	}

	in := reactionInput{
		Now: k.Now, K: k, Sig: sig,
		PrevBand:     st.Band,
		Band:         pacedBand(sig, st.Band),
		WasOverspent: st.Overspent,
		NewTxs:       newTxs,
		Baselines:    categoryBaselines(history, sig.FixedCatID, sig.PoolCatID),
		Categories:   cats,
		QuestDue:     questDue(st.LastCatchAt, st.CreatedAt, st.QuestAskedAt, k.Now),
		Memory:       *mem,
	}
	if created {
		in.QuestDue = false // the first meeting starts the week
	}
	if sig.Facts.Active {
		if d, ok := heavyWeekday(history, sig.FixedCatID, sig.PoolCatID, k); ok {
			in.HeavyDay = &d
		}
	}

	dayKey := localDayKey(k.Now, k)
	if st.DayKey != dayKey {
		st.DayKey, st.DayCount = dayKey, 0
	}
	chosen := chooseByRules(collectCandidates(in), *mem, gateState{DayCount: st.DayCount, LastMsgAt: st.LastMsgAt}, k.Now)

	// The memory advances whether or not a message was shown.
	st.Band, st.Overspent = in.Band, sig.Facts.Overspent
	st.LastTxID = max(maxID, latestTxID(user.ID))
	if chosen == nil {
		return nil
	}
	now := k.Now
	mem.Fired[chosen.Type] = now.Unix()
	st.DayCount++
	st.LastMsgAt = &now
	if chosen.Type == "quest_ask" {
		st.QuestAskedAt = &now
	}
	m := chosen.toMessage(now)
	if sig.Calibrating {
		// The forecast is still collecting data: wording may say so (Stage D's
		// week-one variants). A flag for the words only — numbers are unchanged.
		m.Slots["calibrating"] = true
	}
	return &m
}

func sortNewestFirst(txs []windowTx) {
	for i := 1; i < len(txs); i++ {
		for j := i; j > 0 && txs[j].ID > txs[j-1].ID; j-- {
			txs[j], txs[j-1] = txs[j-1], txs[j]
		}
	}
}

// renderCompanionText asks the AI service to word a message (Stage D pool).
// "" when it is offline, slow or has no variant: the client then uses its
// own four-language fallback for the same type and numbers.
func renderCompanionText(user models.User, m companionMessage, lang string) string {
	if atomic.LoadInt32(&brainStatus) != 1 {
		return ""
	}
	lang = normalizeLangForBrain(lang)
	body, _ := json.Marshal(map[string]any{
		"user_id": user.ID, "type": m.Type, "tone": m.Tone, "slots": localizedSlots(m.Slots, lang),
		"language": lang, "currency": user.Currency,
	})
	ctx, cancel := context.WithTimeout(context.Background(), companionRenderTimeout)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, getBrainBaseURL()+"/v1/companion/render", bytes.NewReader(body))
	if err != nil {
		return ""
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Brain-API-Key", os.Getenv("AI_SERVICE_KEY"))
	resp, err := brainClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var out struct {
		Text *string `json:"text"`
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&out) != nil || out.Text == nil {
		return ""
	}
	return strings.TrimSpace(*out.Text)
}

// localizedSlots names a built-in category in the message's language (the AI
// service words the message but does not know the app's category names); a
// user-created category keeps the name as typed.
func localizedSlots(slots map[string]any, lang string) map[string]any {
	key, _ := slots["category_key"].(string)
	if key == "" {
		return slots
	}
	out := make(map[string]any, len(slots))
	for k, v := range slots {
		out[k] = v
	}
	name, _ := slots["category"].(string)
	out["category"] = pdfCategoryLabel(lang, key, name, name)
	return out
}

// companionUser resolves the authenticated user, writing the error response.
func companionUser(c *gin.Context) (models.User, bool) {
	userID, exists := c.Get("userID")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "User not authenticated"})
		return models.User{}, false
	}
	var user models.User
	if err := database.DB.First(&user, userID.(uint)).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return models.User{}, false
	}
	return user, true
}

// GetCompanionState — GET /api/companion/state?language=xx
func GetCompanionState(c *gin.Context) {
	user, ok := companionUser(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, companionCheck(user, requestClock(c, user.ID), c.Query("language"), true))
}

// CatchCompanionEntity — POST /api/companion/catch {"kind": "star"|"cow"}
// Closes the weekly quest; health starts recovering the same day.
func CatchCompanionEntity(c *gin.Context) {
	user, ok := companionUser(c)
	if !ok {
		return
	}
	var body struct {
		Kind string `json:"kind"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || (body.Kind != "star" && body.Kind != "cow") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "kind must be star or cow"})
		return
	}
	k := requestClock(c, user.ID)
	st, created := loadCompanionState(user.ID, k)
	now := k.Now
	st.LastCatchAt = &now
	if created {
		primeReactionMemory(user.ID, companionFinance(user, k), &st)
	}
	saveCompanionState(&st)
	c.JSON(http.StatusOK, companionCheck(user, k, "", false))
}

// ReactToCompanionMessage — POST /api/companion/reaction
// {"type": "<message type>", "reaction": "liked"|"disliked"}
// Only explicit votes exist: closing a message (✕) is not a reaction and is
// never sent. Votes only tune how often a type is shown — never health.
func ReactToCompanionMessage(c *gin.Context) {
	user, ok := companionUser(c)
	if !ok {
		return
	}
	var body struct {
		Type     string `json:"type"`
		Reaction string `json:"reaction"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid body"})
		return
	}
	if _, known := companionRules[body.Type]; !known || (body.Reaction != "liked" && body.Reaction != "disliked") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown message type or reaction"})
		return
	}
	k := requestClock(c, user.ID)
	st, created := loadCompanionState(user.ID, k)
	if created {
		primeReactionMemory(user.ID, companionFinance(user, k), &st)
	}
	mem := decodeMemory(st)
	v := mem.Reactions[body.Type]
	if body.Reaction == "liked" {
		v.Liked++
	} else {
		v.Disliked++
	}
	mem.Reactions[body.Type] = v
	mem.encode(&st)
	saveCompanionState(&st)
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
}

// companionContext is the coarse good|warn|over hint for the AI service's
// joke/fact pacing, from the same signals as the companion ("" = no budget).
func companionContext(uid uint) string {
	var user models.User
	if err := database.DB.First(&user, uid).Error; err != nil {
		return ""
	}
	f := companionFinance(user, userClock(uid)).Facts
	switch {
	case !f.Active:
		return ""
	case f.Overspent:
		return "over"
	case f.inGrace():
		return "good"
	default:
		return paceBand(f.paceRatio(), "")
	}
}
