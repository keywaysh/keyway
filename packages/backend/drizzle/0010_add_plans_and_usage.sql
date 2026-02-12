-- Migration: Add pricing plans and usage tracking
-- This migration adds support for:
-- 1. User plans (free, pro, team)
-- 2. Billing status and Stripe customer ID (for future billing integration)
-- 3. Vault visibility tracking (public vs private)
-- 4. Usage metrics table for caching computed usage

-- Create plan enum
CREATE TYPE user_plan AS ENUM ('free', 'pro', 'team');

-- Create billing status enum
CREATE TYPE billing_status AS ENUM ('active', 'past_due', 'canceled', 'trialing');

-- Add plan and billing columns to users table
ALTER TABLE users
  ADD COLUMN plan user_plan NOT NULL DEFAULT 'free',
  ADD COLUMN billing_status billing_status DEFAULT 'active',
  ADD COLUMN stripe_customer_id TEXT;

-- Add is_private column to vaults table
-- This is populated from GitHub repo metadata during vault creation
ALTER TABLE vaults
  ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT false;

-- Create usage_metrics table for caching computed usage
-- This is derived data, recomputed on demand
CREATE TABLE usage_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  total_public_repos INTEGER NOT NULL DEFAULT 0,
  total_private_repos INTEGER NOT NULL DEFAULT 0,
  last_computed TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Index for fast lookup by user
CREATE INDEX idx_usage_metrics_user_id ON usage_metrics(user_id);

-- Index for fast filtering of private vaults per owner
CREATE INDEX idx_vaults_owner_private ON vaults(owner_id, is_private);
