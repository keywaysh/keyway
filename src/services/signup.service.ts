/**
 * Signup Service
 *
 * Handles all new user signup tasks in a single, testable place.
 * This prevents the common bug of forgetting to send welcome emails
 * or track signup events in new auth flows.
 */

import { trackEvent, identifyUser, AnalyticsEvents } from "../utils/analytics";

export type SignupSource = "cli" | "web" | "github_app_install" | "direct" | string;
export type SignupMethod =
  | "device_flow"
  | "device_flow_chained"
  | "web_oauth"
  | "github_app_install";

export interface NewUserSignupParams {
  user: {
    id: string;
    username: string;
    email: string | null;
    plan: string;
    createdAt: Date;
  };
  signupSource: SignupSource;
  method: SignupMethod;
}

/**
 * Handle all tasks for a new user signup:
 * - Track USER_CREATED event
 * - Identify user in analytics
 * - Send welcome email (fire-and-forget)
 *
 * IMPORTANT: Call exactly once per new user (when isNewUser is true).
 * Multiple calls will send multiple emails and duplicate analytics events.
 */
export async function handleNewUserSignup({
  user,
  signupSource,
  method,
}: NewUserSignupParams): Promise<void> {
  // Track user creation event
  trackEvent(user.id, AnalyticsEvents.USER_CREATED, {
    username: user.username,
    signupSource,
    method,
  });

  // Identify user in analytics platform
  identifyUser(user.id, {
    username: user.username,
    plan: user.plan,
    signupSource,
    signupTimestamp: user.createdAt.toISOString(),
  });

  // Send welcome email (fire and forget)
  // Dynamic import to avoid loading email config at module level
  if (user.email) {
    const { sendWelcomeEmail } = await import("../utils/email");
    sendWelcomeEmail({ to: user.email, username: user.username });
  }
}
