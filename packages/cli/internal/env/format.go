package env

import (
	"sort"
	"strings"
)

// formatValue writes a value the way the server's .env output does (toEnvFormat in the
// backend): in double quotes, with each quote escaped, when it holds a space, a newline or a
// quote; as is otherwise. ParseServer reads it back exactly; Parse, as a file holds it.
func formatValue(value string) string {
	if strings.ContainsAny(value, " \n\"") {
		return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
	}
	return value
}

// FormatLine writes one KEY=value line of .env content.
func FormatLine(key, value string) string {
	return key + "=" + formatValue(value)
}

// FileLine writes one KEY=value line for a file someone keeps: FormatLine, or the value in
// double quotes where a file reads FormatLine's text otherwise ('x' as x, x\r as x). Parse
// reads it back as value, except where no line holds it (\r\n inside it reads as \n).
func FileLine(key, value string) string {
	line := FormatLine(key, value)
	if read, ok := ReadBack(key, value); ok && read == value || line != key+"="+value {
		return line // exact, or quoted already
	}
	// Left unquoted, so it holds no quote to escape
	return key + `="` + value + `"`
}

// Format writes secrets as .env content, one FormatLine per key in key order, like the
// server's text up to the order. pull writes it, so that push, formatting the vault again,
// reads it as the file does whatever order the server lists secrets in.
func Format(secrets map[string]string) string {
	keys := make([]string, 0, len(secrets))
	for key := range secrets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	lines := make([]string, len(keys))
	for i, key := range keys {
		lines[i] = FormatLine(key, secrets[key])
	}
	return strings.Join(lines, "\n")
}

// ReadBack returns what value becomes once written to a .env line and read again, and
// whether that line reads at all. It differs from value only where the format cannot carry
// it (an unquoted value ending with \r, one wrapped in single quotes, \r\n inside a quoted
// value, read as \n).
func ReadBack(key, value string) (string, bool) {
	parsed, err := Parse(FormatLine(key, value))
	if err != nil {
		return "", false
	}
	got, ok := parsed[key]
	return got, ok
}
