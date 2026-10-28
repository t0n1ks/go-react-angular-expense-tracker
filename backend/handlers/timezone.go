package handlers

import (
	"log"
	"strings"
	"time"
	// Embed the IANA timezone database in every binary that resolves user
	// zones: slim container images (and -trimpath builds) have no zoneinfo.
	_ "time/tzdata"

	"github.com/gin-gonic/gin"

	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/database"
	"github.com/t0n1ks/go-react-angular-expense-tracker/backend/models"
)

// ── User timezone ────────────────────────────────────────────────────────────
//
// The frontend sends its IANA zone in X-User-Timezone on every request. Cycle
// boundaries are stored as UTC instants but evaluated in this zone, so moving
// country moves "today" with the user. The last zone seen is remembered on the
// profile so header-less work (background AI resync) uses the same zone; UTC is
// the final fallback.

const (
	userTimezoneHeader = "X-User-Timezone"
	userLocationKey    = "userLocation"
)

// parseTimezone validates an IANA zone name. "Local" is rejected: it would mean
// the SERVER's zone, never the user's.
func parseTimezone(name string) (*time.Location, bool) {
	name = strings.TrimSpace(name)
	if name == "" || name == "Local" || len(name) > 64 {
		return nil, false
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return nil, false
	}
	return loc, true
}

// storedUserTimezone is the zone last remembered for the user ("" if none).
func storedUserTimezone(uid uint) string {
	var u models.User
	if err := database.DB.Select("timezone").First(&u, uid).Error; err != nil {
		return ""
	}
	return u.Timezone
}

// userLocation resolves the remembered zone, falling back to UTC.
func userLocation(uid uint) *time.Location {
	if loc, ok := parseTimezone(storedUserTimezone(uid)); ok {
		return loc
	}
	return time.UTC
}

// rememberUserTimezone persists a changed zone and drops the cached cycle
// payload, whose boundaries were evaluated in the old zone.
func rememberUserTimezone(uid uint, name string) {
	if storedUserTimezone(uid) == name {
		return
	}
	if err := database.DB.Model(&models.User{}).Where("id = ?", uid).
		Update("timezone", name).Error; err != nil {
		log.Printf("remember timezone: user=%v err=%v", uid, err)
		return
	}
	InvalidateCycleCache(uid)
}

// UserTimezone resolves the request's zone (header → remembered → UTC) and
// stores it in the context. Must run after AuthMiddleware.
func UserTimezone() gin.HandlerFunc {
	return func(c *gin.Context) {
		if v, ok := c.Get("userID"); ok {
			uid := v.(uint)
			if loc, ok := parseTimezone(c.GetHeader(userTimezoneHeader)); ok {
				rememberUserTimezone(uid, loc.String())
				c.Set(userLocationKey, loc)
			} else {
				c.Set(userLocationKey, userLocation(uid))
			}
		}
		c.Next()
	}
}

// requestClock is the cycle clock for this request.
func requestClock(c *gin.Context, uid uint) cycleClock {
	if v, ok := c.Get(userLocationKey); ok {
		if loc, ok := v.(*time.Location); ok {
			return newCycleClock(time.Now(), loc)
		}
	}
	// Handler invoked without the middleware (e.g. tests): same resolution order.
	if loc, ok := parseTimezone(c.GetHeader(userTimezoneHeader)); ok {
		return newCycleClock(time.Now(), loc)
	}
	return userClock(uid)
}

// userClock is the cycle clock for work outside a request (background resync).
func userClock(uid uint) cycleClock {
	return newCycleClock(time.Now(), userLocation(uid))
}
