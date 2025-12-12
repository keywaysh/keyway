import { Resend } from 'resend';
import { config } from '../config';
import { logger } from './sharedLogger';

const resend = config.email.enabled ? new Resend(config.email.resendApiKey) : null;

interface WelcomeEmailParams {
  to: string;
  username: string;
}

export async function sendWelcomeEmail({ to, username }: WelcomeEmailParams): Promise<void> {
  if (!resend) {
    logger.debug({ to }, 'Skipping welcome email (Resend not configured)');
    return;
  }

  try {
    await resend.emails.send({
      from: config.email.fromAddress,
      replyTo: config.email.replyToAddress,
      to,
      subject: 'Welcome to Keyway!',
      html: getWelcomeEmailHtml(username),
      text: getWelcomeEmailText(username),
    });
    logger.info({ to }, 'Welcome email sent');
  } catch (error) {
    // Don't fail the signup if email fails
    logger.error({ to, error: error instanceof Error ? error.message : 'Unknown error' }, 'Failed to send welcome email');
  }
}

function getWelcomeEmailHtml(username: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a202c; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <img src="https://keyway.sh/logo.svg" alt="Keyway" width="48" height="48" style="margin-bottom: 16px;">
    <h1 style="font-size: 24px; font-weight: 600; margin: 0;">Welcome to Keyway!</h1>
  </div>

  <p>Hey ${username},</p>

  <p>Thanks for signing up for Keyway!</p>

  <p>We just launched, and I'm thrilled to have you on board. Keyway gives you GitHub-native secrets management — if you have repo access, you get secret access.</p>

  <div style="background: #f7fafc; border-radius: 8px; padding: 20px; margin: 24px 0;">
    <p style="margin: 0 0 12px 0; font-weight: 600;">Getting started takes 30 seconds:</p>
    <pre style="background: #1a202c; color: #e2e8f0; padding: 16px; border-radius: 6px; overflow-x: auto; font-size: 14px; margin: 0;">keyway init
keyway push</pre>
  </div>

  <p>That's it! Your team can now pull secrets with just <code style="background: #edf2f7; padding: 2px 6px; border-radius: 4px;">keyway pull</code>.</p>

  <p>You can also manage your secrets from the dashboard:</p>
  <p style="margin-top: 16px;">
    <a href="https://keyway.sh/dashboard" style="display: inline-block; background: #667eea; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">Open Dashboard</a>
  </p>

  <p style="margin-top: 32px;">Since we're just getting started, I'd love your feedback. What's working? What's not? Just reply to this email — I read every message.</p>

  <p style="margin-top: 24px;">
    Cheers,<br>
    Nicolas
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">

  <p style="color: #a0aec0; font-size: 12px; text-align: center;">
    Keyway - GitHub-native secrets management<br>
    <a href="https://keyway.sh" style="color: #a0aec0;">keyway.sh</a> · <a href="https://docs.keyway.sh" style="color: #a0aec0;">docs.keyway.sh</a>
  </p>
</body>
</html>
`;
}

function getWelcomeEmailText(username: string): string {
  return `
Welcome to Keyway!

Hey ${username},

Thanks for signing up for Keyway!

We just launched, and I'm thrilled to have you on board. Keyway gives you GitHub-native secrets management — if you have repo access, you get secret access.

Getting started takes 30 seconds:

  keyway init
  keyway push

That's it! Your team can now pull secrets with "keyway pull".

You can also manage your secrets from the dashboard:
https://keyway.sh/dashboard

Since we're just getting started, I'd love your feedback. What's working? What's not? Just reply to this email — I read every message.

Cheers,
Nicolas

---
Keyway - GitHub-native secrets management
https://keyway.sh | https://docs.keyway.sh
`;
}
