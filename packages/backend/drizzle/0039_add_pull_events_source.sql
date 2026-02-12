-- Add source column to pull_events for distinguishing CLI, API key, and MCP access
ALTER TABLE "pull_events" ADD COLUMN "source" text DEFAULT 'cli' NOT NULL;
