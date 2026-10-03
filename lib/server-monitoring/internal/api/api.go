// Package api owns the endpoint registry mirrored from lib/server and a
// small HTTP client used to exercise those endpoints against staging/main.
package api

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"server-monitoring/internal/config"
)

// callTimeout bounds every test request so the CLI never hangs.
const callTimeout = 10 * time.Second

// maxBody caps how much response body is kept for display (1 MiB).
const maxBody = 1 << 20

// Endpoint describes one HTTP route of the Kosply server.
type Endpoint struct {
	Method      string
	Path        string
	Description string
}

// Registry returns every known API route. It must be kept in sync with
// lib/server/routes (add new modules here when the server grows).
//
// Only GET routes are listed because kosmon can only issue GET|HEAD|DELETE|
// OPTIONS and cannot attach a bearer token. Routes marked "needs JWT" are kept
// for discoverability: calling them without a token returns 401, which is the
// correct behaviour and is itself worth confirming. The previous registry
// listed 11 of the server's routes, so `kosmon list` was missing most of the
// API, and 5 of the 11 it did list were permanently unusable (literal ":id"
// placeholders, or JWT-gated).
func Registry() []Endpoint {
	return []Endpoint{
		{Method: "GET", Path: "/", Description: "Root health (name, status, env)"},
		{Method: "GET", Path: "/api/health", Description: "Service health (uptime, timestamp)"},

		// Public catalog.
		{Method: "GET", Path: "/api/products", Description: "Public catalog (q?, limit?)"},
		{Method: "GET", Path: "/api/models", Description: "Active AI models (public)"},
		{Method: "GET", Path: "/api/users/:id", Description: "Public profile (needs a real id)"},
		{Method: "GET", Path: "/api/analytics/seller", Description: "Seller catalog analytics (needs JWT: 401 here)"},
		{Method: "GET", Path: "/api/analytics/products/:id", Description: "Per-product analytics (needs JWT: 401 here)"},

		// Authenticated reads.
		{Method: "GET", Path: "/api/users/me", Description: "Own profile (needs JWT: 401 here)"},
		{Method: "GET", Path: "/api/notifications", Description: "Own notification inbox (needs JWT)"},
		{Method: "GET", Path: "/api/notifications/preferences", Description: "Notification toggles (needs JWT)"},
		{Method: "GET", Path: "/api/conversations", Description: "COD inbox (needs JWT)"},
		{Method: "GET", Path: "/api/conversations/:id", Description: "One COD room (needs JWT + membership)"},
		{Method: "GET", Path: "/api/conversations/:id/messages", Description: "Room history (needs JWT + membership)"},
		{Method: "GET", Path: "/api/conversations/:id/wait", Description: "Long-poll for new messages (needs JWT)"},
		{Method: "GET", Path: "/api/conversations/:id/stream", Description: "SSE message stream (needs JWT)"},
		{Method: "GET", Path: "/api/verifications/me", Description: "Own KTM application status (needs JWT)"},
		{Method: "GET", Path: "/api/verifications", Description: "All applications (needs ADMIN: 403 here)"},
		{Method: "GET", Path: "/api/reports", Description: "Fraud report queue (needs ADMIN: 403 here)"},
		{Method: "GET", Path: "/api/support/tickets", Description: "Support tickets (needs ADMIN for all: 403 here)"},
		{Method: "GET", Path: "/api/support/tickets/:id", Description: "One ticket (needs JWT)"},
		{Method: "GET", Path: "/api/ai/conversations", Description: "Own AI session list (needs JWT)"},
		{Method: "GET", Path: "/api/ai/history/:id", Description: "AI transcript (needs JWT + ownership)"},
		{Method: "GET", Path: "/api/ai/wait/:id", Description: "Long-poll a pending AI approval (needs JWT)"},

		// Internal machine API. Every route requires the x-internal-key header,
		// so an anonymous call must return 401 -- that assertion is enforced in
		// the server test suite, not here.
		{Method: "GET", Path: "/api/internal/products/search?q=", Description: "Catalog search (agent; needs x-internal-key: 401 here)"},
		{Method: "GET", Path: "/api/internal/users/:id", Description: "User + role lookup (agent; needs x-internal-key: 401 here)"},
	}
}

// Result carries the outcome of one test call.
type Result struct {
	Env      string
	Method   string
	URL      string
	Status   int
	Duration time.Duration
	Body     string
}

// Call performs a single HTTP request against the given environment.
// Transport errors are returned; HTTP error statuses are NOT errors so
// callers can still inspect the status code and body while testing.
// Only bodyless methods are supported (kosmon is a health-check tool;
// use curl/Postman for POST/PUT with payloads).
func Call(env, method, path string) (Result, error) {
	target, err := config.TargetFor(env)
	if err != nil {
		return Result{}, err
	}
	m := strings.ToUpper(strings.TrimSpace(method))
	switch m {
	case http.MethodGet, http.MethodHead, http.MethodDelete, http.MethodOptions:
		// supported
	default:
		return Result{}, fmt.Errorf("unsupported method %q (want GET|HEAD|DELETE|OPTIONS)", method)
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	url := target.BaseURL() + path

	req, err := http.NewRequest(m, url, nil)
	if err != nil {
		return Result{}, fmt.Errorf("build request: %w", err)
	}

	client := &http.Client{Timeout: callTimeout}
	start := time.Now()
	resp, err := client.Do(req)
	if err != nil {
		return Result{}, fmt.Errorf("call %s: %w", url, err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, maxBody))
	result := Result{
		Env:      target.Env,
		Method:   m,
		URL:      url,
		Status:   resp.StatusCode,
		Duration: time.Since(start),
		Body:     string(body),
	}
	// A 4xx/5xx is a failed test, not a transport detail. `kosmon test` used to
	// exit 0 on a 500, which made `kosmon test X && <deploy>` a no-op gate: the
	// only non-zero exit was "connection refused".
	if resp.StatusCode >= 400 {
		return result, fmt.Errorf("%s %s -> HTTP %d", m, path, resp.StatusCode)
	}
	return result, nil
}
