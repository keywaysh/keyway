package api

import (
	"context"
	"fmt"
)

// TrialInfo contains trial status information
type TrialInfo struct {
	Status            string  `json:"status"` // "none", "active", "expired", "converted"
	DaysRemaining     *int    `json:"days_remaining"`
	EndsAt            *string `json:"ends_at"`
	TrialDurationDays int     `json:"trial_duration_days"`
}

// OrganizationInfo contains information about an organization
type OrganizationInfo struct {
	ID            string    `json:"id"`
	Login         string    `json:"login"`
	DisplayName   string    `json:"display_name"`
	AvatarURL     string    `json:"avatar_url"`
	Plan          string    `json:"plan"`
	EffectivePlan string    `json:"effective_plan"`
	MemberCount   int       `json:"member_count"`
	VaultCount    int       `json:"vault_count"`
	Trial         TrialInfo `json:"trial"`
	Role          string    `json:"role"`
}

// StartTrialResponse is the response from starting a trial
type StartTrialResponse struct {
	Message   string `json:"message"`
	TrialEnds string `json:"trial_ends"`
}

// GetOrganization retrieves information about an organization
func (c *Client) GetOrganization(ctx context.Context, orgLogin string) (*OrganizationInfo, error) {
	path := fmt.Sprintf("/v1/orgs/%s", orgLogin)
	var wrapper struct {
		Data OrganizationInfo `json:"data"`
	}
	err := c.do(ctx, "GET", path, nil, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.Data, nil
}

// StartOrganizationTrial starts a trial for an organization
func (c *Client) StartOrganizationTrial(ctx context.Context, orgLogin string) (*StartTrialResponse, error) {
	path := fmt.Sprintf("/v1/orgs/%s/trial/start", orgLogin)
	var wrapper struct {
		Data StartTrialResponse `json:"data"`
	}
	// Send empty object as body (backend expects JSON)
	err := c.do(ctx, "POST", path, struct{}{}, &wrapper)
	if err != nil {
		return nil, err
	}
	return &wrapper.Data, nil
}

// CanStartTrial checks if an organization can start a trial
func (c *Client) CanStartTrial(ctx context.Context, orgLogin string) (bool, int, error) {
	org, err := c.GetOrganization(ctx, orgLogin)
	if err != nil {
		return false, 0, err
	}

	// Can start trial if status is "none" and effective plan is "free"
	canStart := org.Trial.Status == "none" && org.EffectivePlan == "free"
	return canStart, org.Trial.TrialDurationDays, nil
}
