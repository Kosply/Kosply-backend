// Package server controls the staging/main processes through PM2.
// All PM2 invocations run from the project root so the relative script
// path in ecosystem.config.js keeps resolving.
package server

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"server-monitoring/internal/config"
)

// Target re-exports config.Target: environments are defined once in
// config so names, ports and modes cannot drift between packages.
type Target = config.Target

// Targets delegates to config.Targets.
func Targets() []Target { return config.Targets() }

// TargetFor delegates to config.TargetFor.
func TargetFor(env string) (Target, error) { return config.TargetFor(env) }

// pm2Bin locates the pm2 executable or explains how to install it.
func pm2Bin() (string, error) {
	path, err := exec.LookPath("pm2")
	if err != nil {
		return "", fmt.Errorf("pm2 is not installed (run: npm i -g pm2)")
	}
	return path, nil
}

// ProjectRoot finds the Kosply-backend root by honoring KOSPLY_ROOT first,
// then walking up from the working directory until ecosystem.config.js
// is found.
func ProjectRoot() (string, error) {
	if root := os.Getenv("KOSPLY_ROOT"); root != "" {
		if _, err := os.Stat(filepath.Join(root, "ecosystem.config.js")); err == nil {
			return root, nil
		}
		return "", fmt.Errorf("KOSPLY_ROOT=%s has no ecosystem.config.js", root)
	}
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for i := 0; i < 8; i++ {
		if _, err := os.Stat(filepath.Join(dir, "ecosystem.config.js")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("ecosystem.config.js not found (set KOSPLY_ROOT or run from the project)")
}

// runPM2 executes pm2 from the project root and returns combined output.
func runPM2(args ...string) (string, error) {
	bin, err := pm2Bin()
	if err != nil {
		return "", err
	}
	root, err := ProjectRoot()
	if err != nil {
		return "", err
	}
	cmd := exec.Command(bin, args...)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out)), fmt.Errorf("pm2 %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out)), nil
}

// Passthrough runs pm2 with inherited stdio for full-screen output
// such as `pm2 status` and `pm2 logs`.
func Passthrough(args ...string) error {
	bin, err := pm2Bin()
	if err != nil {
		return err
	}
	root, err := ProjectRoot()
	if err != nil {
		return err
	}
	cmd := exec.Command(bin, args...)
	cmd.Dir = root
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

// pmEntry mirrors the fields of `pm2 jlist` needed for state detection.
type pmEntry struct {
	Name   string `json:"name"`
	PM2Env struct {
		Status string `json:"status"`
	} `json:"pm2_env"`
}

// missingStates returns every managed env mapped to "missing".
func missingStates() map[string]string {
	states := make(map[string]string, len(Targets()))
	for _, t := range Targets() {
		states[t.Env] = "missing"
	}
	return states
}

// envNames returns managed env names for error messages, e.g. "staging|main".
func envNames() string {
	names := make([]string, 0, len(Targets()))
	for _, t := range Targets() {
		names = append(names, t.Env)
	}
	return strings.Join(names, "|")
}

// States maps every managed env to its PM2 status
// (online|stopped|stopping|missing). A missing pm2 yields an error.
func States() (map[string]string, error) {
	out, _ := runPM2("jlist")
	// `pm2 jlist` can exit non-zero on an empty daemon *and* exit zero while
	// printing nothing (wrapper scripts, a redirected PM2_HOME, non-TTY progress
	// output). The empty check used to sit inside the error branch, so a clean
	// but empty pm2 hard-failed every start/restart/switch.
	if strings.TrimSpace(out) == "" || strings.TrimSpace(out) == "[]" {
		return missingStates(), nil
	}
	var entries []pmEntry
	if err := json.Unmarshal([]byte(out), &entries); err != nil {
		return nil, fmt.Errorf("parse pm2 jlist: %w", err)
	}
	states := missingStates()
	// In cluster mode one PM2 name has N entries. Taking the *last* match made
	// the verdict purely positional: 3 of 4 workers errored still reported
	// "online" as long as the healthy one came last, so `switch`/`restart` acted
	// on a false "healthy". Report the worst status seen.
	for _, t := range Targets() {
		for _, e := range entries {
			if e.Name != t.PM2Name {
				continue
			}
			if worstState(states[t.Env], e.PM2Env.Status) != states[t.Env] {
				states[t.Env] = worstState(states[t.Env], e.PM2Env.Status)
			}
		}
	}
	return states, nil
}

// severity orders PM2 statuses so a cluster is judged by its worst worker.
func severity(status string) int {
	switch status {
	case "errored", "launching", "stopping", "crashed":
		return 3
	case "stopped":
		return 2
	case "online":
		return 1
	default: // "missing" and anything unknown
		return 0
	}
}

// worstState returns whichever of the two states is less healthy.
func worstState(current, candidate string) string {
	if current == "missing" {
		return candidate
	}
	if severity(candidate) > severity(current) {
		return candidate
	}
	return current
}

// ensureRunning starts the target when absent, restarts it when present.
// A registered-but-stopped process must be restarted (not started),
// otherwise `pm2 start --only` fails with "already exists".
// A process that is *already online* is left alone: `switch` used to restart a
// perfectly healthy staging, dropping in-flight requests for no reason.
// `startOrRestart` is used so an edited ecosystem.config.js is actually applied
// (`pm2 restart <name>` reuses PM2's stored config and silently ignores env
// edits), with --update-env so the operator's shell environment reaches it.
func ensureRunning(t Target) error {
	states, err := States()
	if err != nil {
		return err
	}
	if states[t.Env] == "missing" {
		_, err = runPM2("start", "ecosystem.config.js", "--only", t.PM2Name, "--update-env")
		return err
	}
	if states[t.Env] == "online" {
		return nil
	}
	_, err = runPM2("startOrRestart", "ecosystem.config.js", "--only", t.PM2Name, "--update-env")
	return err
}

// Start ensures the given environment is running.
func Start(env string) error {
	t, err := TargetFor(env)
	if err != nil {
		return err
	}
	return ensureRunning(t)
}

// Stop halts the given environment (no-op when already down).
func Stop(env string) error {
	t, err := TargetFor(env)
	if err != nil {
		return err
	}
	states, err := States()
	if err != nil {
		return err
	}
	if states[t.Env] == "missing" {
		return fmt.Errorf("%s is not registered in PM2", t.PM2Name)
	}
	_, err = runPM2("stop", t.PM2Name)
	return err
}

// Restart force-restarts the given environment.
//
// Unlike ensureRunning this is the explicit operator command, so it must always
// bounce the process -- including when it is already online, which is the point
// of a restart. It goes through `startOrRestart ecosystem.config.js` with
// `--update-env` for the same reason as ensureRunning: `pm2 restart <name>`
// replays PM2's stored config, so a new connection pool size, worker count or
// env edit in ecosystem.config.js / config/env.js was silently discarded and
// the operator had no way to apply it.
func Restart(env string) error {
	t, err := TargetFor(env)
	if err != nil {
		return err
	}
	states, err := States()
	if err != nil {
		return err
	}
	if states[t.Env] == "missing" {
		return fmt.Errorf("%s is not registered in PM2", t.PM2Name)
	}
	_, err = runPM2("startOrRestart", "ecosystem.config.js", "--only", t.PM2Name, "--update-env")
	return err
}

// ActiveEnvs returns the environments currently online in PM2.
func ActiveEnvs() ([]Target, error) {
	states, err := States()
	if err != nil {
		return nil, err
	}
	var active []Target
	for _, t := range Targets() {
		if states[t.Env] == "online" {
			active = append(active, t)
		}
	}
	return active, nil
}

// StopActive stops every online environment without asking which.
// It errors when nothing runs so "did nothing" never looks like success.
func StopActive() ([]string, error) {
	active, err := ActiveEnvs()
	if err != nil {
		return nil, err
	}
	if len(active) == 0 {
		return nil, fmt.Errorf("no active server (%s are all down)", envNames())
	}
	stopped := make([]string, 0, len(active))
	for _, t := range active {
		if _, err := runPM2("stop", t.PM2Name); err != nil {
			return stopped, fmt.Errorf("stop %s: %w", t.Env, err)
		}
		stopped = append(stopped, t.Env)
	}
	return stopped, nil
}

// RestartActive restarts every online environment without asking which.
func RestartActive() ([]string, error) {
	active, err := ActiveEnvs()
	if err != nil {
		return nil, err
	}
	if len(active) == 0 {
		return nil, fmt.Errorf("no active server (%s are all down)", envNames())
	}
	restarted := make([]string, 0, len(active))
	for _, t := range active {
		if _, err := runPM2("restart", t.PM2Name); err != nil {
			return restarted, fmt.Errorf("restart %s: %w", t.Env, err)
		}
		restarted = append(restarted, t.Env)
	}
	return restarted, nil
}

// Switch moves traffic readiness to the target environment: it ensures
// the target is running, then stops the other one.
func Switch(env string) error {
	t, err := TargetFor(env)
	if err != nil {
		return err
	}
	if err := ensureRunning(t); err != nil {
		return fmt.Errorf("start %s: %w", t.Env, err)
	}
	states, err := States()
	if err != nil {
		return err
	}
	for _, other := range Targets() {
		if other.Env == t.Env {
			continue
		}
		if states[other.Env] == "online" {
			if _, err := runPM2("stop", other.PM2Name); err != nil {
				return fmt.Errorf("stop %s: %w", other.Env, err)
			}
		}
	}
	return nil
}
