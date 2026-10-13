package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"unicode"
)

// Cloudflare Access adds this header to every request that passed its login.
// When the app is reached another way (fallback path, localhost) it's absent
// and everything works by display name only.
const cfAccessEmailHeader = "Cf-Access-Authenticated-User-Email"

// AccessEmail returns the Cloudflare Access email of the request, lowercased.
func AccessEmail(r *http.Request) string {
	return strings.ToLower(strings.TrimSpace(r.Header.Get(cfAccessEmailHeader)))
}

// NormalizeName is the identity key for display names: case-insensitive and
// ignoring all whitespace. The name is still shown as typed.
func NormalizeName(name string) string {
	return strings.ToLower(strings.Join(strings.Fields(name), ""))
}

// SuggestedName derives a display name from an email:
// "adrian.garcia@company.com" -> "Adrian Garcia".
func SuggestedName(email string) string {
	local, _, _ := strings.Cut(email, "@")
	parts := strings.FieldsFunc(local, func(r rune) bool {
		return r == '.' || r == '_' || r == '-' || r == '+' || unicode.IsDigit(r)
	})
	for i, p := range parts {
		rs := []rune(p)
		rs[0] = unicode.ToUpper(rs[0])
		parts[i] = string(rs)
	}
	if len(parts) == 0 {
		return local
	}
	return strings.Join(parts, " ")
}

// WhoAmIResponse tells the join page who Cloudflare says the user is.
type WhoAmIResponse struct {
	Email         string `json:"email,omitempty"`
	SuggestedName string `json:"suggestedName,omitempty"`
	// CurrentName is the display name this email already plays under.
	CurrentName string `json:"currentName,omitempty"`
}

// HandleWhoAmI returns the Cloudflare Access identity, or {} without one.
func HandleWhoAmI(hub *Hub) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := WhoAmIResponse{}
		if email := AccessEmail(r); email != "" {
			resp.Email = email
			resp.SuggestedName = SuggestedName(email)
			if s, ok := hub.GetSessionByEmail(email); ok {
				resp.CurrentName = s.Name
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
