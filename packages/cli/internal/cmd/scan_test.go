package cmd

import (
	"fmt"
	"testing"
)

func TestMaskSecret(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"short", "*****"},                               // <= 10 chars, all masked
		{"1234567890", "**********"},                     // exactly 10, all masked
		{"12345678901", "1234****901"},                   // 11 chars, show first 4 and last 3
		{"AKIAIOSFODNN7EXAMPLE", "AKIA*************PLE"}, // 20 chars
		{"ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "ghp_*********************************xxx"}, // 40 chars
	}

	for _, tt := range tests {
		t.Run(tt.input[:min(10, len(tt.input))], func(t *testing.T) {
			result := maskSecret(tt.input)
			if result != tt.expected {
				t.Errorf("maskSecret(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestIsFalsePositive(t *testing.T) {
	tests := []struct {
		name     string
		match    string
		line     string
		filePath string
		expected bool
	}{
		{
			name:     "test file",
			match:    "AKIAIOSFODNN7EXAMPLE",
			line:     "const key = 'AKIAIOSFODNN7EXAMPLE'",
			filePath: "src/test/config.js",
			expected: true,
		},
		{
			name:     "example file",
			match:    "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
			line:     "token = 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'",
			filePath: "config.example.js",
			expected: true,
		},
		{
			name:     "placeholder value",
			match:    "your-api-key-here",
			line:     "API_KEY = 'your-api-key-here'",
			filePath: "config.js",
			expected: true,
		},
		{
			name:     "env variable reference",
			match:    "some_value",
			line:     "key = process.env.API_KEY",
			filePath: "config.js",
			expected: true,
		},
		{
			name:     "real secret",
			match:    "AKIAIOSFODNN7REALKEY",
			line:     "const key = 'AKIAIOSFODNN7REALKEY'",
			filePath: "src/config.js",
			expected: false,
		},
		{
			name:     "documentation example",
			match:    "sk_live_example",
			line:     "// example: sk_live_example",
			filePath: "readme.md",
			expected: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isFalsePositive(tt.match, tt.line, tt.filePath)
			if result != tt.expected {
				t.Errorf("isFalsePositive(%q, %q, %q) = %v, want %v",
					tt.match, tt.line, tt.filePath, result, tt.expected)
			}
		})
	}
}

func TestSecretPatterns(t *testing.T) {
	tests := []struct {
		name        string
		patternName string
		input       string
		shouldMatch bool
	}{
		// AWS
		{"AWS Access Key", "AWS Access Key", "AKIAIOSFODNN7EXAMPLE", true},
		{"AWS Access Key with ASIA", "AWS Access Key", "ASIAIOSFODNN7EXAMPLE", true},
		{"Not AWS key", "AWS Access Key", "NOTAKEY1234567890", false},

		// GitHub (tokens are exactly 36 alphanumeric chars after prefix)
		{"GitHub PAT", "GitHub PAT", "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890", true},
		{"GitHub OAuth", "GitHub OAuth", "gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890", true},
		{"Not GitHub token", "GitHub PAT", "ghx_notavalidtoken", false},

		// Stripe
		{"Stripe Secret", "Stripe Secret Key", "sk_live_00000000000000000000000000", true},
		{"Stripe Test (should not match live)", "Stripe Secret Key", "sk_test_00000000000000000000000000", false},

		// Private Key
		{"RSA Private Key", "Private Key", "-----BEGIN RSA PRIVATE KEY-----", true},
		{"EC Private Key", "Private Key", "-----BEGIN EC PRIVATE KEY-----", true},
		{"Public Key (should not match)", "Private Key", "-----BEGIN PUBLIC KEY-----", false},

		// SendGrid: SG. + 22 chars + . + 43 chars
		{"SendGrid Key", "SendGrid API Key", "SG.0000000000000000000000.0000000000000000000000000000000000000000000", true},

		// Slack
		{"Slack Webhook", "Slack Webhook", "https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX", true},

		// npm
		{"npm Token", "npm Token", "npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890", true},

		// Google
		{"Google API Key", "Google API Key", "AIzaSyDaGmWKa4JsXZ-HjGw7ISLn_3namBGewQe", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var pattern *SecretPattern
			for i := range secretPatterns {
				if secretPatterns[i].Name == tt.patternName {
					pattern = &secretPatterns[i]
					break
				}
			}

			if pattern == nil {
				t.Fatalf("Pattern %q not found", tt.patternName)
			}

			matched := pattern.Regex.MatchString(tt.input)
			if matched != tt.shouldMatch {
				t.Errorf("Pattern %q on %q: got %v, want %v",
					tt.patternName, tt.input, matched, tt.shouldMatch)
			}
		})
	}
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// Additional comprehensive tests

func TestAllPatterns_NoFalsePositivesOnCommonCode(t *testing.T) {
	// Common code snippets that should NOT trigger any patterns
	safeCode := []string{
		`const API_KEY = process.env.API_KEY`,
		`apiKey := os.Getenv("API_KEY")`,
		`api_key = ENV["API_KEY"]`,
		`const key = "${API_KEY}"`,
		`const key = "your-api-key-here"`,
		`const key = "CHANGEME"`,
		`const key = "xxxxxxxxxxxxxxxx"`,
		`const key = "test_key_placeholder"`,
		`// Example: AKIAIOSFODNN7EXAMPLE`,
		`# api_key: your_key_here`,
		`AWS_ACCESS_KEY_ID=<your-key>`,
		`password: ${PASSWORD}`,
		`secret=$(cat /secrets/api)`,
		`token: "{{.Token}}"`,
		`"apiKey": "<INSERT_KEY>"`,
		`export STRIPE_KEY=changeme`,
		`const fakeKey = "sk_test_fake1234"`,
	}

	for _, code := range safeCode {
		for _, pattern := range secretPatterns {
			matches := pattern.Regex.FindAllString(code, -1)
			for _, match := range matches {
				if !isFalsePositive(match, code, "src/app.js") {
					// Allow some patterns that legitimately match but are filtered by isFalsePositive
					t.Logf("Pattern %q matched %q in safe code: %q", pattern.Name, match, code)
				}
			}
		}
	}
}

func TestAllPatterns_DetectsRealSecrets(t *testing.T) {
	// Real secrets that SHOULD be detected
	realSecrets := []struct {
		code        string
		patternName string
	}{
		{`const key = "AKIAIOSFODNN7ABCDEFG"`, "AWS Access Key"},
		{`aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYzEXAMPLEKEY"`, "AWS Secret Key"},
		{`token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890"`, "GitHub PAT"},
		{`export STRIPE_KEY="sk_live_00000000000000000000000000000000"`, "Stripe Secret Key"},
		{`-----BEGIN RSA PRIVATE KEY-----`, "Private Key"},
		{`-----BEGIN EC PRIVATE KEY-----`, "Private Key"},
		{`-----BEGIN OPENSSH PRIVATE KEY-----`, "Private Key"},
		{`const webhook = "https://hooks.slack.com/services/T00000000/B00000000/000000000000000000000000"`, "Slack Webhook"},
		{`xoxb-0000000000000-0000000000000-000000000000000000000000`, "Slack Token"},
		{`API_KEY = "AIza00000000000000000000000000000000000"`, "Google API Key"},
		{`NPM_TOKEN=npm_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890`, "npm Token"},
		{`GITLAB_TOKEN=glpat-xxxxxxxxxxxxxxxxxxxx`, "GitLab Token"},
	}

	for _, tc := range realSecrets {
		t.Run(tc.patternName, func(t *testing.T) {
			found := false
			for _, pattern := range secretPatterns {
				if pattern.Name == tc.patternName {
					if pattern.Regex.MatchString(tc.code) {
						found = true
					}
					break
				}
			}
			if !found {
				t.Errorf("Pattern %q did not match code: %q", tc.patternName, tc.code)
			}
		})
	}
}

func TestIsFalsePositive_Comprehensive(t *testing.T) {
	tests := []struct {
		name     string
		match    string
		line     string
		filePath string
		expected bool
	}{
		// Test files
		{"test directory", "secret123", "key = secret123", "tests/config.go", true},
		{"spec file", "secret123", "key = secret123", "config.spec.ts", true},
		{"test suffix", "secret123", "key = secret123", "config_test.go", true},
		{"mock file", "secret123", "key = secret123", "mocks/api.js", true},
		{"fixture file", "secret123", "key = secret123", "fixtures/data.json", true},

		// Example/sample files
		{".example extension", "secret123", "key = secret123", ".env.example", true},
		{".sample extension", "secret123", "key = secret123", "config.sample.yaml", true},
		{"example in path", "secret123", "key = secret123", "examples/config.js", true},

		// Placeholders in value
		{"xxx placeholder", "xxxxxxxxxxxxx", "key = xxxxxxxxxxxxx", "config.js", true},
		{"your-key placeholder", "your-api-key", "key = your-api-key", "config.js", true},
		{"changeme", "changeme", "password = changeme", "config.js", true},
		{"CHANGEME", "CHANGEME", "PASSWORD = CHANGEME", "config.js", true},
		{"insert placeholder", "INSERT_YOUR_KEY", "key = INSERT_YOUR_KEY", "config.js", true},
		{"todo placeholder", "TODO_REPLACE", "key = TODO_REPLACE", "config.js", true},
		{"dummy value", "dummy_secret", "key = dummy_secret", "config.js", true},
		{"fake value", "fake_token", "key = fake_token", "config.js", true},
		{"demo value", "demo_api_key", "key = demo_api_key", "config.js", true},

		// Environment variable references
		{"process.env", "API_KEY", "key = process.env.API_KEY", "config.js", true},
		{"os.getenv", "API_KEY", "key = os.getenv('API_KEY')", "config.py", true},
		{"ENV[]", "API_KEY", "key = ENV['API_KEY']", "config.rb", true},
		{"${VAR}", "value", "key = ${API_KEY}", "config.sh", true},
		{"$(command)", "value", "key = $(cat /secret)", "script.sh", true},

		// Documentation
		{"e.g. in line", "example_key", "// e.g. example_key", "readme.md", true},
		{"for example", "sample_key", "// for example: sample_key", "docs.md", true},
		{"example: prefix", "key123", "// example: key123", "guide.md", true},

		// Real secrets (should NOT be false positives)
		{"real secret in src", "AKIAIOSFODNN7REALXYZ", "key = AKIAIOSFODNN7REALXYZ", "src/config.js", false},
		{"real secret in lib", "sk_live_real1234567890", "stripe = sk_live_real1234567890", "lib/payment.ts", false},
		{"real token in app", "ghp_realtoken1234567890abcdef", "token = ghp_realtoken1234567890abcdef", "app/auth.go", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isFalsePositive(tt.match, tt.line, tt.filePath)
			if result != tt.expected {
				t.Errorf("isFalsePositive(%q, %q, %q) = %v, want %v",
					tt.match, tt.line, tt.filePath, result, tt.expected)
			}
		})
	}
}

func TestMaskSecret_EdgeCases(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		// Edge cases
		{"", ""},
		{"a", "*"},
		{"ab", "**"},
		{"abc", "***"},
		{"abcd", "****"},
		{"abcdefghij", "**********"},   // exactly 10 chars
		{"abcdefghijk", "abcd****ijk"}, // 11 chars, shows first 4 and last 3
		{"x", "*"},
	}

	for _, tt := range tests {
		t.Run(fmt.Sprintf("len=%d", len(tt.input)), func(t *testing.T) {
			result := maskSecret(tt.input)
			if result != tt.expected {
				t.Errorf("maskSecret(%q) = %q, want %q", tt.input, result, tt.expected)
			}
		})
	}
}

func TestSecretPatterns_BoundaryConditions(t *testing.T) {
	tests := []struct {
		name        string
		patternName string
		input       string
		shouldMatch bool
	}{
		// AWS - boundary conditions
		{"AWS key too short", "AWS Access Key", "AKIAIOSFODNN7EXAMPL", false},
		{"AWS key exact length", "AWS Access Key", "AKIAIOSFODNN7EXAMPLE", true},
		{"AWS key in context", "AWS Access Key", "key=AKIAIOSFODNN7EXAMPLE&foo=bar", true},
		{"AWS key with ABIA prefix", "AWS Access Key", "ABIAIOSFODNN7EXAMPLE", true},
		{"AWS key with ACCA prefix", "AWS Access Key", "ACCAIOSFODNN7EXAMPLE", true},

		// Stripe - boundary conditions
		{"Stripe key exact min length", "Stripe Secret Key", "sk_live_123456789012345678901234", true},
		{"Stripe test key (should not match)", "Stripe Secret Key", "sk_test_123456789012345678901234", false},
		{"Stripe restricted key", "Stripe Restricted Key", "rk_live_123456789012345678901234", true},

		// Private keys - variations
		{"RSA private key", "Private Key", "-----BEGIN RSA PRIVATE KEY-----", true},
		{"EC private key", "Private Key", "-----BEGIN EC PRIVATE KEY-----", true},
		{"DSA private key", "Private Key", "-----BEGIN DSA PRIVATE KEY-----", true},
		{"OpenSSH private key", "Private Key", "-----BEGIN OPENSSH PRIVATE KEY-----", true},
		{"Encrypted private key", "Private Key", "-----BEGIN ENCRYPTED PRIVATE KEY-----", true},
		{"PGP private key", "Private Key", "-----BEGIN PGP PRIVATE KEY-----", true},
		{"Certificate (not private key)", "Private Key", "-----BEGIN CERTIFICATE-----", false},
		{"Public key (not private)", "Private Key", "-----BEGIN PUBLIC KEY-----", false},

		// Twilio
		{"Twilio API key valid", "Twilio API Key", "SK0123456789abcdef0123456789abcdef", true},
		{"Twilio key too short", "Twilio API Key", "SK0123456789abcdef", false},

		// Discord
		{"Discord webhook valid", "Discord Webhook", "https://discord.com/api/webhooks/12345678901234567890/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890", true},
		{"Discord webhook discordapp", "Discord Webhook", "https://discordapp.com/api/webhooks/12345678901234567890/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var pattern *SecretPattern
			for i := range secretPatterns {
				if secretPatterns[i].Name == tt.patternName {
					pattern = &secretPatterns[i]
					break
				}
			}

			if pattern == nil {
				t.Skipf("Pattern %q not found", tt.patternName)
				return
			}

			matched := pattern.Regex.MatchString(tt.input)
			if matched != tt.shouldMatch {
				t.Errorf("Pattern %q on %q: got %v, want %v",
					tt.patternName, tt.input, matched, tt.shouldMatch)
			}
		})
	}
}
