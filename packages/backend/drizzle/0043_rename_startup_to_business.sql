-- Rename the premium tier "startup" to "business" to align with standard SaaS
-- naming (Free → Pro → Team → Business). Renaming the enum value updates all
-- existing rows in place (any individual users already on the old "startup"
-- plan become "business"); organizations on "team" are unaffected.
ALTER TYPE "user_plan" RENAME VALUE 'startup' TO 'business';
