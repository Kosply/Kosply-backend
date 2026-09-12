// Package ui provides consistent terminal rendering shared by the
// interactive menu and the non-interactive commands: ASCII banner,
// section headers, tables, prompts and colored status printers.
package ui

import (
	"bufio"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strings"
	"time"
)

const (
	cReset  = "\033[0m"
	cBold   = "\033[1m"
	cDim    = "\033[2m"
	cCyan   = "\033[36m"
	cGreen  = "\033[32m"
	cYellow = "\033[33m"
	cRed    = "\033[31m"
)

// stdin is the single shared reader for all prompts. It must stay shared:
// a fresh bufio.Reader per prompt would swallow already-buffered input
// and break pasted or piped answers.
var stdin = bufio.NewReader(os.Stdin)

// colorEnabled reports whether ANSI colors may be used.
// It honors the NO_COLOR convention (https://no-color.org).
func colorEnabled() bool {
	return os.Getenv("NO_COLOR") == "" && os.Getenv("TERM") != "dumb"
}

// paint wraps s in the given ANSI code unless colors are disabled.
func paint(code, s string) string {
	if !colorEnabled() {
		return s
	}
	return code + s + cReset
}

// Bold renders bold text.
func Bold(s string) string { return paint(cBold, s) }

// Dim renders dimmed text.
func Dim(s string) string { return paint(cDim, s) }

// Success renders a green ok line.
func Success(msg string) { fmt.Println(paint(cGreen, "[ok] ") + msg) }

// Failure renders a red error line.
func Failure(msg string) { fmt.Println(paint(cRed, "[error] ") + msg) }

// Banner prints the KOSMON block-letter header with the CLI version and
// targets below it. It is always the first thing shown in interactive mode.
func Banner(version string) {
	fmt.Println(paint(cBold+cCyan, `
  ██╗  ██╗ ██████╗ ███████╗███╗   ███╗ ██████╗ ███╗   ██╗
  ██║ ██╔╝██╔═══██╗██╔════╝████╗ ████║██╔═══██╗████╗  ██║
  █████╔╝ ██║   ██║███████╗██╔████╔██║██║   ██║██╔██╗ ██║
  ██╔═██╗ ██║   ██║╚════██║██║╚██╔╝██║██║   ██║██║╚██╗██║
  ██║  ██╗╚██████╔╝███████║██║ ╚═╝ ██║╚██████╔╝██║ ╚████║
  ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝`))
	fmt.Printf("  %s\n", paint(cDim, "v"+version))
	fmt.Printf("  %s\n", paint(cDim, "staging :3001   ·   main :3000"))
}

// ClearScreen wipes the terminal so the next screen shows only the
// current menu. On non-terminals (pipes, CI) it prints a blank line
// instead of escape codes to keep captured output clean.
func ClearScreen() {
	if isCharDevice(os.Stdout) {
		fmt.Print("\033[2J\033[H")
		return
	}
	fmt.Println()
}

// Header prints a section title in the house style.
func Header(title string) {
	fmt.Printf("\n%s\n", paint(cBold, "== "+title+" =="))
}

// Table prints a bordered table with a header row. Widths are measured
// on visible text (ANSI codes stripped) so styled cells such as dimmed
// rows keep the borders aligned.
func Table(headers []string, rows [][]string) {
	widths := make([]int, len(headers))
	for i, h := range headers {
		widths[i] = len(stripAnsi(h))
	}
	for _, row := range rows {
		for i, cell := range row {
			if v := len(stripAnsi(cell)); i < len(widths) && v > widths[i] {
				widths[i] = v
			}
		}
	}
	border := func(left, mid, right string) string {
		parts := make([]string, len(widths))
		for i, w := range widths {
			parts[i] = strings.Repeat("─", w+2)
		}
		return left + strings.Join(parts, mid) + right
	}
	fmt.Println(border("┌", "┬", "┐"))
	cells := make([]string, len(headers))
	for i, h := range headers {
		cells[i] = " " + Bold(h) + strings.Repeat(" ", widths[i]-len(stripAnsi(h))+1)
	}
	fmt.Println("│" + strings.Join(cells, "│") + "│")
	fmt.Println(border("├", "┼", "┤"))
	for _, row := range rows {
		cells := make([]string, len(headers))
		for i := range headers {
			cell := ""
			if i < len(row) {
				cell = row[i]
			}
			cells[i] = " " + cell + strings.Repeat(" ", widths[i]-len(stripAnsi(cell))+1)
		}
		fmt.Println("│" + strings.Join(cells, "│") + "│")
	}
	fmt.Println(border("└", "┴", "┘"))
}

// stripAnsi removes ANSI escape sequences so visible width can be measured.
func stripAnsi(s string) string {
	var b strings.Builder
	for i := 0; i < len(s); {
		if s[i] == 0x1b && i+1 < len(s) && s[i+1] == '[' {
			i += 2
			for i < len(s) && (s[i] < '@' || s[i] > '~') {
				i++
			}
			if i < len(s) {
				i++
			}
			continue
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// StatusColor returns the status code wrapped in a severity color:
// green for 2xx, yellow for 4xx, red for 5xx.
func StatusColor(code int) string {
	s := fmt.Sprint(code)
	switch {
	case code >= 200 && code < 300:
		return paint(cGreen, s)
	case code >= 400 && code < 500:
		return paint(cYellow, s)
	case code >= 500:
		return paint(cRed, s)
	default:
		return s
	}
}

// Prompt prints a label and reads one trimmed line from stdin.
// It reports false when stdin is closed (EOF) so callers can exit cleanly.
func Prompt(label string) (string, bool) {
	fmt.Printf("%s ", paint(cBold, label))
	line, err := stdin.ReadString('\n')
	if err != nil {
		fmt.Println()
		return "", false
	}
	return strings.TrimSpace(line), true
}

// PressEnter pauses until the user hits Enter (or stdin closes).
func PressEnter() {
	fmt.Printf("%s", paint(cDim, "Press Enter to continue..."))
	_, _ = stdin.ReadString('\n')
}

// Pause waits for a single keypress after an action screen and reports
// whether the user asked to go back (Esc/q) instead of continuing.
// Unlike PressEnter it reacts immediately: no Enter required, so Esc
// jumps straight to the previous menu. Enter (or any other key)
// returns false. On non-terminals it falls back to PressEnter.
func Pause() bool {
	if !isCharDevice(os.Stdin) {
		PressEnter()
		return false
	}
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		PressEnter()
		return false
	}
	defer tty.Close()
	saved, err := sttyState()
	if err != nil {
		PressEnter()
		return false
	}
	defer restoreStty(saved)
	if err := exec.Command("stty", "-F", "/dev/tty", "cbreak", "min", "1", "-echo").Run(); err != nil {
		PressEnter()
		return false
	}
	fmt.Printf("%s", paint(cDim, "Enter continue · Esc back"))
	b := make([]byte, 1)
	if _, err := tty.Read(b); err != nil {
		fmt.Println()
		return false
	}
	fmt.Println()
	return b[0] == 0x1b || b[0] == 'q' || b[0] == 'Q'
}

// ---------------------------------------------------------------------------
// Compact menu selector
// ---------------------------------------------------------------------------

// Option is one selectable row: a label plus a short explanation shown
// next to it so every choice is self-documenting.
type Option struct {
	Label string
	Desc  string
}

// Select renders a compact titled menu and returns the chosen index.
//
// The layout stays airy: blank lines separate the title, the options and
// the footer. Back exists only in submenus (main menu gets Exit instead)
// and is merged into the footer line to stay compact. Picking that last
// row behaves exactly like q, so callers simply treat ok=false as leave.
// On a terminal it uses arrow-key navigation; otherwise (pipes, CI) it
// falls back to numbered input so scripts keep working.
func Select(title string, opts []Option, backLabel string) (int, bool) {
	label, desc := "Back", "Return to the main menu"
	if backLabel == "exit" {
		label, desc = "Exit", "Leave the CLI"
	}
	full := make([]Option, 0, len(opts)+1)
	full = append(full, opts...)
	full = append(full, Option{Label: label, Desc: desc})

	if isCharDevice(os.Stdin) {
		if idx, ok, used := selectKeys(title, full, backLabel); used {
			return normalizeBack(idx, len(full), ok)
		}
	}
	idx, ok := selectNumbered(title, full, backLabel)
	return normalizeBack(idx, len(full), ok)
}

// normalizeBack maps the merged last row (Back/Exit) to ok=false so
// callers handle every leave path identically.
func normalizeBack(idx, total int, ok bool) (int, bool) {
	if ok && idx == total-1 {
		return 0, false
	}
	return idx, ok
}

// isCharDevice reports whether f is a terminal.
func isCharDevice(f *os.File) bool {
	fi, err := f.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

// selectNumbered is the fallback menu: same options with numbers + descs.
func selectNumbered(title string, full []Option, backLabel string) (int, bool) {
	n := len(full)
	for {
		fmt.Println()
		fmt.Println(Bold(title))
		fmt.Println()
		for i, o := range full {
			fmt.Printf("  [%d] %s  %s\n", i+1, Bold(o.Label), Dim("— "+o.Desc))
		}
		fmt.Println()
		fmt.Printf("  %s\n", Dim("0/q "+backLabel))
		raw, ok := Prompt(fmt.Sprintf("Select [0-%d]:", n))
		if !ok {
			return 0, false
		}
		if raw == "0" || strings.EqualFold(raw, "q") || strings.EqualFold(raw, backLabel) {
			return 0, false
		}
		var idx int
		if _, err := fmt.Sscanf(raw, "%d", &idx); err != nil || idx < 1 || idx > n {
			Failure(fmt.Sprintf("unknown option %q (want 0-%d)", raw, n))
			continue
		}
		return idx - 1, true
	}
}

// selectKeys is the arrow-key menu. It returns used=false when /dev/tty
// is unavailable so the caller falls back to numbered input.
func selectKeys(title string, full []Option, backLabel string) (int, bool, bool) {
	tty, err := os.OpenFile("/dev/tty", os.O_RDWR, 0)
	if err != nil {
		return 0, false, false
	}
	defer tty.Close()

	saved, err := sttyState()
	if err != nil {
		return 0, false, false
	}
	defer restoreStty(saved)
	if err := exec.Command("stty", "-F", "/dev/tty", "cbreak", "min", "1", "-echo").Run(); err != nil {
		return 0, false, false
	}

	footer := "↑/↓ move · Enter select · 1-9 jump · q " + backLabel

	fmt.Print("\033[?25l")       // hide cursor
	defer fmt.Print("\033[?25h") // show cursor again

	sel := 0
	armed := false
	baseFooter := footer
	lines := renderSelect(title, full, footer, sel)
	for {
		kind, digit := readKey(tty)
		// Leaving the CLI takes two Esc presses so a stray keypress
		// never kills the session. Submenu Back stays single-press.
		if kind == kEsc && backLabel == "exit" && !armed {
			armed = true
			footer = paint(cYellow, "Press Esc again to exit")
			moveUp(lines)
			lines = renderSelect(title, full, footer, sel)
			continue
		}
		if armed {
			armed = false
			footer = baseFooter
		}
		switch kind {
		case kUp:
			sel = (sel - 1 + len(full)) % len(full)
		case kDown:
			sel = (sel + 1) % len(full)
		case kEnter:
			moveUp(lines)
			renderSelect(title, full, footer, sel)
			fmt.Println()
			return sel, true, true
		case kBack, kEsc:
			moveUp(lines)
			return 0, false, true
		case kDigit:
			if digit >= 1 && digit <= len(full) {
				moveUp(lines)
				renderSelect(title, full, footer, digit-1)
				fmt.Println()
				return digit - 1, true, true
			}
		}
		moveUp(lines)
		lines = renderSelect(title, full, footer, sel)
	}
}

// renderSelect prints one menu block and reports how many terminal lines
// it used so the caller can redraw in place. Option rows show labels
// only; the highlighted option's description renders as a detail line
// below the list so the block stays narrow and readable.
func renderSelect(title string, full []Option, footer string, sel int) int {
	lines := []string{"", Bold(title), ""}
	for i, o := range full {
		marker := " "
		label := o.Label
		if i == sel {
			marker = ">"
			label = Bold(paint(cCyan, o.Label))
		}
		lines = append(lines, fmt.Sprintf("  %s %s", marker, label))
	}
	lines = append(lines, "", Dim("    "+full[sel].Desc), "", Dim("  "+footer))
	for _, l := range lines {
		fmt.Printf("\r\033[K%s\n", l)
	}
	return len(lines)
}

// moveUp returns the cursor to the first line of the menu block.
func moveUp(n int) { fmt.Printf("\033[%dA", n) }

// keyKind classifies one logical keypress.
type keyKind int

const (
	kNone keyKind = iota
	kUp
	kDown
	kEnter
	kBack
	kDigit
	kEsc
)

// readKey reads one logical key from the raw tty.
func readKey(tty *os.File) (keyKind, int) {
	b := make([]byte, 1)
	if _, err := tty.Read(b); err != nil {
		return kBack, 0 // closed tty behaves like Back
	}
	switch b[0] {
	case '\r', '\n':
		return kEnter, 0
	case 'q', 'Q', '0':
		return kBack, 0
	}
	if b[0] >= '1' && b[0] <= '9' {
		return kDigit, int(b[0] - '0')
	}
	if b[0] != 0x1b {
		return kNone, 0
	}
	// Possible escape sequence: wait briefly for the rest.
	_ = tty.SetReadDeadline(time.Now().Add(80 * time.Millisecond))
	seq := make([]byte, 2)
	n, _ := io.ReadFull(tty, seq)
	_ = tty.SetReadDeadline(time.Time{})
	if n == 2 && seq[0] == '[' {
		switch seq[1] {
		case 'A':
			return kUp, 0
		case 'B':
			return kDown, 0
		}
	}
	return kEsc, 0 // lone Esc needs confirmation (handled by caller)
}

// sttyState saves the current /dev/tty settings for later restore.
func sttyState() (string, error) {
	out, err := exec.Command("stty", "-F", "/dev/tty", "-g").Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// restoreStty puts /dev/tty settings back (best effort).
func restoreStty(saved string) {
	_ = exec.Command("stty", "-F", "/dev/tty", saved).Run()
}
