package version

import "testing"

func TestLatestStableCLIVersion(t *testing.T) {
	tests := []struct {
		name     string
		releases []githubRelease
		want     string
		wantErr  bool
	}{
		{
			name: "skips prereleases and other packages",
			releases: []githubRelease{
				{TagName: "cli/v0.7.0-rc.1", Prerelease: true},
				{TagName: "mcp/v1.2.0"},
				{TagName: "cli/v0.6.0"},
			},
			want: "v0.6.0",
		},
		{
			name: "skips prerelease tags not flagged as prerelease",
			releases: []githubRelease{
				{TagName: "cli/v0.7.0-rc.1"},
				{TagName: "cli/v0.6.0"},
			},
			want: "v0.6.0",
		},
		{
			name: "only prereleases",
			releases: []githubRelease{
				{TagName: "cli/v0.6.0-rc.1", Prerelease: true},
				{TagName: "mcp/v1.2.0"},
			},
			wantErr: true,
		},
		{
			name:     "no releases",
			releases: nil,
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := latestStableCLIVersion(tt.releases)
			if (err != nil) != tt.wantErr {
				t.Fatalf("latestStableCLIVersion() error = %v, wantErr %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Errorf("latestStableCLIVersion() = %q, want %q", got, tt.want)
			}
		})
	}
}
