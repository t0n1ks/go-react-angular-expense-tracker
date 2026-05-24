package middleware

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// SecurityHeaders sets defensive HTTP response headers on every reply.
// These mitigate MIME-type sniffing, clickjacking, and cross-origin data leaks.
// HSTS and CSP are intentionally omitted — they belong at the reverse-proxy
// (Nginx / Render / Vercel) layer where HTTPS is guaranteed.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("X-Permitted-Cross-Domain-Policies", "none")
		c.Next()
	}
}

// MaxBodySize rejects request bodies larger than maxBytes before any handler
// reads them, preventing memory-exhaustion attacks via oversized payloads.
// 64 KB is generous for this API (no file uploads; largest payload is the
// AI analyze request with a few hundred transactions).
func MaxBodySize(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.ContentLength > maxBytes {
			c.AbortWithStatusJSON(http.StatusRequestEntityTooLarge, gin.H{
				"error": "Request payload too large",
			})
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}
