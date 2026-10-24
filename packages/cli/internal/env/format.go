package env

import "strings"

// FormatValue writes a value the way the server's .env output does (toEnvFormat in the
// backend): in double quotes, with each quote escaped, when it holds a space, a newline or a
// quote; as is otherwise. ParseServer reads it back exactly; Parse, as a file holds it.
func FormatValue(value string) string {
	if strings.ContainsAny(value, " \n\"") {
		return `"` + strings.ReplaceAll(value, `"`, `\"`) + `"`
	}
	return value
}

// FormatLine writes one KEY=value line of .env content.
func FormatLine(key, value string) string {
	return key + "=" + FormatValue(value)
}

// ReadBack returns what value becomes once written to a .env line and read again, and
// whether that line reads at all. It differs from value only where the format cannot carry
// it (an unquoted value ending with \r, or one wrapped in single quotes).
func ReadBack(key, value string) (string, bool) {
	parsed, err := Parse(FormatLine(key, value))
	if err != nil {
		return "", false
	}
	got, ok := parsed[key]
	return got, ok
}
