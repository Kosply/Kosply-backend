// Package config is the single source of truth for managed environments.
// Both the HTTP test client (api) and process control (server) resolve
// names, ports and URLs here so staging/live can never drift apart.
package config

import (
	"fmt"
	"strings"
)

// Target describes one managed environment.
type Target struct {
	Env     string
	PM2Name string
	Port    int
	Mode    string
	Desc    string
}

// BaseURL returns the local HTTP address of the target.
func (t Target) BaseURL() string { return fmt.Sprintf("http://localhost:%d", t.Port) }

// Blurb is the one-line menu explanation, e.g. "Playground on :3001".
func (t Target) Blurb() string { return fmt.Sprintf("%s on :%d", t.Desc, t.Port) }

// Targets returns the managed environments in display order.
func Targets() []Target {
	return []Target{
		{Env: "staging", PM2Name: "kosply-server-staging", Port: 3001, Mode: "fork", Desc: "Playground"},
		{Env: "live", PM2Name: "kosply-server-live", Port: 3000, Mode: "cluster", Desc: "Real users"},
	}
}

// TargetFor resolves an environment name (case-insensitive) to its target.
// Unknown names return an error listing the valid choices.
func TargetFor(env string) (Target, error) {
	name := strings.ToLower(strings.TrimSpace(env))
	for _, t := range Targets() {
		if t.Env == name {
			return t, nil
		}
	}
	return Target{}, fmt.Errorf("unknown env %q (want staging|live)", env)
}
