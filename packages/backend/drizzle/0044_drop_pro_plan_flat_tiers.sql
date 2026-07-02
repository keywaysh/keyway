-- Flat-tier pricing: plans are now free / team / business (the 'pro' tier is
-- removed). Going forward, paid plans are sold org-only.
--
-- Remap policy: an account (user or org) WITH a Stripe customer is never
-- divorced from a paid tier ('pro' folds into 'team'); winding down legacy
-- personal subscriptions is handled separately in code. Accounts WITHOUT a
-- Stripe customer never paid: personal accounts go to 'free', and residual
-- org 'pro' rows go to 'free' too ('pro' was never a legitimate org tier).
-- Org team/business plans granted manually (no Stripe, no trial) are
-- deliberately kept.

-- 1) Remap data while 'pro' still exists in the enum
UPDATE "organizations" SET "plan" = 'team' WHERE "plan" = 'pro' AND "stripe_customer_id" IS NOT NULL;--> statement-breakpoint
UPDATE "organizations" SET "plan" = 'free' WHERE "plan" = 'pro';--> statement-breakpoint
UPDATE "users" SET "plan" = 'free' WHERE "plan" != 'free' AND "stripe_customer_id" IS NULL;--> statement-breakpoint
UPDATE "users" SET "plan" = 'team' WHERE "plan" = 'pro' AND "stripe_customer_id" IS NOT NULL;--> statement-breakpoint

-- 2) Lapsed trials (ended, never converted, no Stripe customer) previously kept
--    their granted plan in the DB even though the effective plan was 'free';
--    align the stored plan with reality.
UPDATE "organizations"
SET "plan" = 'free'
WHERE "plan" != 'free'
  AND "stripe_customer_id" IS NULL
  AND "trial_converted_at" IS NULL
  AND "trial_ends_at" IS NOT NULL
  AND "trial_ends_at" < now();--> statement-breakpoint

-- 3) Rebuild the enum without 'pro' (Postgres cannot drop an enum value in place)
ALTER TYPE "user_plan" RENAME TO "user_plan_old";--> statement-breakpoint
CREATE TYPE "user_plan" AS ENUM ('free', 'team', 'business');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "plan" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "plan" TYPE "user_plan" USING "plan"::text::"user_plan";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" TYPE "user_plan" USING "plan"::text::"user_plan";--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
DROP TYPE "user_plan_old";
