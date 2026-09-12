// Package api owns the endpoint registry mirrored from lib/server and a
// small HTTP client used to exercise those endpoints against staging/live.
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
func Registry() []Endpoint {
	return []Endpoint{
		{Method: "GET", Path: "/", Description: "Root health (name, status, env)"},
		{Method: "GET", Path: "/api/health", Description: "Service health (uptime, timestamp)"},
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
func Call(env, method, path string) (Result, error) {
	target, err := config.TargetFor(env)
	if err != nil {
		return Result{}, err
	}
	if !strings.HasPrefix(path, "/") {
		path = "/" + path
	}
	url := target.BaseURL() + path

	req, err := http.NewRequest(strings.ToUpper(method), url, nil)
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
	return Result{
		Env:      target.Env,
		Method:   strings.ToUpper(method),
		URL:      url,
		Status:   resp.StatusCode,
		Duration: time.Since(start),
		Body:     string(body),
	}, nil
}
