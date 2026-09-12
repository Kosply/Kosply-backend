// Command kosmon monitors and controls the Kosply servers.
//
// It runs in two versions:
//
//	Interactive (default, no args): ASCII banner, version line, then a
//	numbered menu for listing APIs, testing endpoints and managing the
//	staging/main processes.
//
//	Non-interactive: subcommands for scripts and CI, e.g.
//	kosmon list, kosmon test /api/health --env staging.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"server-monitoring/internal/api"
	"server-monitoring/internal/server"
	"server-monitoring/internal/ui"
)

// version is the CLI release shown under the ASCII banner.
const version = "0.1.0"

// usage documents the non-interactive interface.
const usage = `kosmon v%s — Kosply server monitoring CLI

Usage:
  kosmon                              launch interactive menu (default)
  kosmon list                         list all registered APIs
  kosmon test <path> [--env E] [-m M] call an endpoint (default env staging)
  kosmon start <staging|main>          start a server via PM2
  kosmon stop [staging|main]          stop one env, or every active server
  kosmon restart [staging|main]       restart one env, or every active server
  kosmon status                       show PM2 status
  kosmon switch <staging|main>        run target env, stop the other one
  kosmon version                      print version
  kosmon help                         print this help

Flags:
  --env, -e     staging|main    (test command, default staging)
  --method, -m  HTTP method    (test command, default GET)

Env:
  KOSPLY_ROOT   project root override (else auto-detected)
  NO_COLOR      set to disable colored output
`

func main() {
	args := os.Args[1:]
	if len(args) == 0 || args[0] == "menu" || args[0] == "interactive" {
		interactive()
		return
	}
	if err := dispatch(args); err != nil {
		ui.Failure(err.Error())
		os.Exit(1)
	}
}

// dispatch routes non-interactive subcommands.
func dispatch(args []string) error {
	switch args[0] {
	case "help", "-h", "--help":
		fmt.Printf(usage, version)
		return nil
	case "version", "-v", "--version":
		fmt.Println("kosmon v" + version)
		return nil
	case "list":
		return cmdList()
	case "test":
		return cmdTest(args[1:])
	case "start", "stop", "restart":
		return cmdControl(args[0], args[1:])
	case "status":
		return server.Passthrough("status")
	case "switch":
		return cmdSwitch(args[1:])
	default:
		return fmt.Errorf("unknown command %q (try: kosmon help)", args[0])
	}
}

// cmdList prints the endpoint registry as a table.
func cmdList() error {
	ui.Header("Registered APIs")
	rows := [][]string{}
	for _, e := range api.Registry() {
		rows = append(rows, []string{e.Method, e.Path, e.Description})
	}
	ui.Table([]string{"METHOD", "PATH", "DESCRIPTION"}, rows)
	return nil
}

// cmdTest calls one endpoint and prints status, duration and body.
func cmdTest(args []string) error {
	pos, flags := splitFlags(args)
	if len(pos) == 0 {
		return fmt.Errorf("usage: kosmon test <path> [--env staging|main] [--method GET]")
	}
	env := flagValue(flags, []string{"env", "e"}, "staging")
	method := flagValue(flags, []string{"method", "m"}, "GET")
	res, err := api.Call(env, method, pos[0])
	if err != nil {
		return err
	}
	printResult(res)
	return nil
}

// cmdControl wraps start/stop/restart. Start always needs an explicit
// env; stop/restart act on every active server when no env is given.
func cmdControl(action string, args []string) error {
	pos, _ := splitFlags(args)
	if action == "start" {
		if len(pos) == 0 {
			return fmt.Errorf("usage: kosmon start <staging|main>")
		}
		if err := server.Start(pos[0]); err != nil {
			return err
		}
		ui.Success(fmt.Sprintf("start %s done", strings.ToLower(pos[0])))
		return printStates()
	}
	if len(pos) > 0 {
		var err error
		if action == "stop" {
			err = server.Stop(pos[0])
		} else {
			err = server.Restart(pos[0])
		}
		if err != nil {
			return err
		}
		ui.Success(fmt.Sprintf("%s %s done", action, strings.ToLower(pos[0])))
		return printStates()
	}
	var acted []string
	var err error
	if action == "stop" {
		acted, err = server.StopActive()
	} else {
		acted, err = server.RestartActive()
	}
	if err != nil {
		return err
	}
	ui.Success(fmt.Sprintf("%s active done (%s)", action, strings.Join(acted, ", ")))
	return printStates()
}

// cmdSwitch moves readiness to the target environment.
func cmdSwitch(args []string) error {
	pos, _ := splitFlags(args)
	if len(pos) == 0 {
		return fmt.Errorf("usage: kosmon switch <staging|main>")
	}
	if err := server.Switch(pos[0]); err != nil {
		return err
	}
	ui.Success("switched to " + strings.ToLower(pos[0]))
	return printStates()
}

// printStates shows staging/main PM2 states in the house style.
// Rows that are not online render dimmed so the active servers pop.
func printStates() error {
	ui.Header("Server states")
	states, err := server.States()
	if err != nil {
		return err
	}
	rows := [][]string{}
	for _, t := range server.Targets() {
		row := []string{t.Env, fmt.Sprintf(":%d", t.Port), states[t.Env]}
		if states[t.Env] != "online" {
			row = []string{ui.Dim(t.Env), ui.Dim(fmt.Sprintf(":%d", t.Port)), ui.Dim(states[t.Env])}
		}
		rows = append(rows, row)
	}
	ui.Table([]string{"ENV", "PORT", "STATE"}, rows)
	return nil
}

// printResult renders one test call: status, timing and body.
// JSON bodies are indented for readability, anything else prints raw.
func printResult(res api.Result) {
	ui.Header("Test result")
	fmt.Printf("  %-8s %s %s\n", "request", res.Method, res.URL)
	fmt.Printf("  %-8s %s\n", "status", ui.StatusColor(res.Status))
	fmt.Printf("  %-8s %d ms\n", "took", res.Duration.Milliseconds())
	fmt.Println("  body:")
	body := strings.TrimSpace(res.Body)
	var pretty bytes.Buffer
	if json.Indent(&pretty, []byte(body), "    ", "  ") == nil {
		body = pretty.String()
	}
	for _, line := range strings.Split(body, "\n") {
		fmt.Println("    " + line)
	}
}

// splitFlags separates positional args from --key value / --key=value flags.
// Single-dash shorthands (-e staging) are supported as well.
// A flag without a value (or whose next token is another flag) stores "".
func splitFlags(args []string) (pos []string, flags map[string]string) {
	flags = map[string]string{}
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "--") {
			kv := strings.SplitN(strings.TrimPrefix(a, "--"), "=", 2)
			if len(kv) == 2 {
				flags[kv[0]] = kv[1]
			} else if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				flags[kv[0]] = args[i+1]
				i++
			} else {
				flags[kv[0]] = ""
			}
			continue
		}
		if strings.HasPrefix(a, "-") && len(a) == 2 {
			if i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				flags[string(a[1])] = args[i+1]
				i++
			} else {
				flags[string(a[1])] = ""
			}
			continue
		}
		pos = append(pos, a)
	}
	return pos, flags
}

// flagValue returns the first present key from names, else the default.
func flagValue(flags map[string]string, names []string, def string) string {
	for _, n := range names {
		if v, ok := flags[n]; ok && v != "" {
			return v
		}
	}
	return def
}

// ---------------------------------------------------------------------------
// Interactive mode: grouped submenus
// ---------------------------------------------------------------------------

// mainOptions is the tidy top level: lifecycle actions sit under
// "Server control" instead of cluttering the main menu.
var mainOptions = []ui.Option{
	{Label: "Server control", Desc: "Start, stop or restart a server"},
	{Label: "API testing", Desc: "List and test endpoints"},
	{Label: "PM2 status", Desc: "Show the process table"},
}

// showMenu renders one full screen: clear, banner, then the menu.
// Every screen therefore shows only the current menu — previous
// menus never linger above.
func showMenu(title string, opts []ui.Option, backLabel string) (int, bool) {
	ui.ClearScreen()
	ui.Banner(version)
	return ui.Select(title, opts, backLabel)
}

// interactive runs the menu loop: banner first, version below it, then menu.
func interactive() {
	for {
		idx, ok := showMenu("menu", mainOptions, "exit")
		if !ok {
			fmt.Println("Bye.")
			return
		}
		switch idx {
		case 0:
			submenuServer()
		case 1:
			submenuAPI()
		case 2:
			if err := server.Passthrough("status"); err != nil {
				ui.Failure(err.Error())
			}
			ui.Pause()
		}
	}
}

// submenuAPI groups endpoint discovery and testing. Only its own items
// are shown; Back returns to the main menu.
func submenuAPI() {
	opts := []ui.Option{
		{Label: "List all APIs", Desc: "Show every registered endpoint"},
		{Label: "Test an API", Desc: "Call an endpoint on staging/main"},
	}
	for {
		idx, ok := showMenu("api testing", opts, "back")
		if !ok {
			return
		}
		var err error
		if idx == 0 {
			err = cmdList()
		} else {
			err = menuTest()
		}
		if err != nil {
			ui.Failure(err.Error())
		}
		if ui.Pause() {
			return
		}
	}
}

// submenuServer groups everything about servers: lifecycle, switching
// and states. There is no separate Environment submenu anymore.
func submenuServer() {
	opts := []ui.Option{
		{Label: "Start server", Desc: "Pick an env to bring online"},
		{Label: "Stop server", Desc: "Stop every active server"},
		{Label: "Restart server", Desc: "Restart every active server"},
		{Label: "Switch environment", Desc: "Run one env, stop the other"},
		{Label: "Show states", Desc: "Staging/main PM2 states"},
	}
	for {
		idx, ok := showMenu("server control", opts, "back")
		if !ok {
			return
		}
		var err error
		switch idx {
		case 0:
			err = menuStart()
		case 1:
			err = menuStopActive()
		case 2:
			err = menuRestartActive()
		case 3:
			err = menuSwitch()
		case 4:
			err = printStates()
		}
		if err != nil {
			ui.Failure(err.Error())
		}
		if ui.Pause() {
			return
		}
	}
}

// menuStart brings one chosen environment online (start keeps asking
// which env because it creates new processes).
func menuStart() error {
	env, err := chooseEnv()
	if err != nil {
		return err
	}
	if err := server.Start(env); err != nil {
		return err
	}
	ui.Success("start " + env + " done")
	return printStates()
}

// menuStopActive stops whatever is online without asking first.
func menuStopActive() error {
	stopped, err := server.StopActive()
	if err != nil {
		return err
	}
	ui.Success("stop active done (" + strings.Join(stopped, ", ") + ")")
	return printStates()
}

// menuRestartActive restarts whatever is online without asking first.
func menuRestartActive() error {
	restarted, err := server.RestartActive()
	if err != nil {
		return err
	}
	ui.Success("restart active done (" + strings.Join(restarted, ", ") + ")")
	return printStates()
}

// menuTest prompts for env + endpoint, then calls it.
func menuTest() error {
	env, err := chooseEnv()
	if err != nil {
		return err
	}
	registry := api.Registry()
	opts := make([]ui.Option, 0, len(registry)+1)
	for _, e := range registry {
		opts = append(opts, ui.Option{Label: e.Method + " " + e.Path, Desc: e.Description})
	}
	opts = append(opts, ui.Option{Label: "Custom path", Desc: "Type any path manually"})
	idx, ok := showMenu("pick endpoint — "+env, opts, "back")
	if !ok {
		return fmt.Errorf("cancelled")
	}
	path := ""
	if idx == len(registry) {
		custom, ok := ui.Prompt("Custom path (e.g. /api/health):")
		if !ok || custom == "" {
			return fmt.Errorf("cancelled")
		}
		path = custom
	} else {
		path = registry[idx].Path
	}
	res, err := api.Call(env, "GET", path)
	if err != nil {
		return err
	}
	printResult(res)
	return nil
}

// menuSwitch prompts for the target env and moves readiness to it.
func menuSwitch() error {
	env, err := chooseEnv()
	if err != nil {
		return err
	}
	if err := server.Switch(env); err != nil {
		return err
	}
	ui.Success("switched to " + env)
	return printStates()
}

// chooseEnv prompts for an environment through the same arrow menu.
// Options derive from server.Targets so new envs appear automatically.
func chooseEnv() (string, error) {
	targets := server.Targets()
	opts := make([]ui.Option, 0, len(targets))
	for _, t := range targets {
		opts = append(opts, ui.Option{Label: t.Env, Desc: t.Blurb()})
	}
	idx, ok := showMenu("pick environment", opts, "back")
	if !ok {
		return "", fmt.Errorf("cancelled")
	}
	return targets[idx].Env, nil
}
