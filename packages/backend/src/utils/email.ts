import { Resend } from "resend";
import { config } from "../config";
import { logger } from "./sharedLogger";
import type { SecurityAlertType } from "../db/schema";

const resend = config.email.enabled ? new Resend(config.email.resendApiKey) : null;

interface WelcomeEmailParams {
  to: string;
  username: string;
}

export async function sendWelcomeEmail({ to, username }: WelcomeEmailParams): Promise<void> {
  if (!resend) {
    logger.debug({ to }, "Skipping welcome email (Resend not configured)");
    return;
  }

  try {
    await resend.emails.send({
      from: config.email.fromAddress,
      replyTo: config.email.replyToAddress,
      to,
      subject: "Welcome to Keyway!",
      html: getWelcomeEmailHtml(username),
      text: getWelcomeEmailText(username),
    });
    logger.info({ to }, "Welcome email sent");
  } catch (error) {
    // Don't fail the signup if email fails
    logger.error(
      { to, error: error instanceof Error ? error.message : "Unknown error" },
      "Failed to send welcome email"
    );
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
    <a href="${config.app.dashboardUrl}" style="display: inline-block; background: #667eea; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">Open Dashboard</a>
  </p>

  <p style="margin-top: 32px;">Since we're just getting started, I'd love your feedback. What's working? What's not? Just reply to this email — I read every message.</p>

  <p style="margin-top: 24px;">
    Cheers,<br>
    Nicolas
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">

  <p style="color: #a0aec0; font-size: 12px; text-align: center;">
    Keyway - GitHub-native secrets management<br>
    <a href="${config.app.frontendUrl}" style="color: #a0aec0;">${new URL(config.app.frontendUrl).hostname}</a> · <a href="${config.app.docsUrl}" style="color: #a0aec0;">${new URL(config.app.docsUrl).hostname}</a>
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
${config.app.dashboardUrl}

Since we're just getting started, I'd love your feedback. What's working? What's not? Just reply to this email — I read every message.

Cheers,
Nicolas

---
Keyway - GitHub-native secrets management
${config.app.frontendUrl} | ${config.app.docsUrl}
`;
}

// ============================================
// Security Alert Emails
// ============================================

interface SecurityAlertEmailParams {
  to: string;
  username: string;
  alertType: SecurityAlertType;
  message: string;
  vaultName: string;
  ip: string;
  location: { country: string | null; city: string | null };
}

const ALERT_CONFIG: Record<
  SecurityAlertType,
  { emoji: string; title: string; severity: "critical" | "warning" }
> = {
  impossible_travel: { emoji: "🚨", title: "Impossible Travel Detected", severity: "critical" },
  weird_user_agent: { emoji: "🚨", title: "Suspicious Client Detected", severity: "critical" },
  rate_anomaly: { emoji: "🚨", title: "Unusual Activity Detected", severity: "critical" },
  new_device: { emoji: "🔔", title: "New Device Access", severity: "warning" },
  new_location: { emoji: "🔔", title: "New Location Access", severity: "warning" },
};

export async function sendSecurityAlertEmail(params: SecurityAlertEmailParams): Promise<void> {
  if (!resend) {
    logger.debug(
      { to: params.to, alertType: params.alertType },
      "Skipping security alert email (Resend not configured)"
    );
    return;
  }

  const alertConfig = ALERT_CONFIG[params.alertType];
  const subject = `${alertConfig.emoji} ${alertConfig.title} - ${params.vaultName}`;

  try {
    await resend.emails.send({
      from: config.email.fromAddress,
      replyTo: config.email.replyToAddress,
      to: params.to,
      subject,
      html: getSecurityAlertEmailHtml(params),
      text: getSecurityAlertEmailText(params),
    });
    logger.info(
      { to: params.to, alertType: params.alertType, vault: params.vaultName },
      "Security alert email sent"
    );
  } catch (error) {
    logger.error(
      {
        to: params.to,
        alertType: params.alertType,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Failed to send security alert email"
    );
  }
}

function getSecurityAlertEmailHtml(params: SecurityAlertEmailParams): string {
  const alertConfig = ALERT_CONFIG[params.alertType];
  const locationStr =
    [params.location.city, params.location.country].filter(Boolean).join(", ") || "Unknown";
  const severityColor = alertConfig.severity === "critical" ? "#e53e3e" : "#dd6b20";
  const severityBg = alertConfig.severity === "critical" ? "#fed7d7" : "#feebc8";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a202c; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="background: ${severityBg}; border-left: 4px solid ${severityColor}; padding: 16px 20px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
    <h1 style="font-size: 20px; font-weight: 600; margin: 0 0 8px 0; color: ${severityColor};">
      ${alertConfig.emoji} ${alertConfig.title}
    </h1>
    <p style="margin: 0; color: #4a5568;">${params.message}</p>
  </div>

  <p>Hey ${params.username},</p>

  <p>We detected unusual activity on your Keyway vault. Here are the details:</p>

  <div style="background: #f7fafc; border-radius: 8px; padding: 20px; margin: 24px 0;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; color: #718096; width: 120px;">Vault</td>
        <td style="padding: 8px 0; font-weight: 500;">${params.vaultName}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #718096;">IP Address</td>
        <td style="padding: 8px 0; font-family: monospace;">${params.ip}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #718096;">Location</td>
        <td style="padding: 8px 0;">${locationStr}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; color: #718096;">Time</td>
        <td style="padding: 8px 0;">${new Date().toUTCString()}</td>
      </tr>
    </table>
  </div>

  <p><strong>If this was you:</strong> No action needed. This alert helps you stay aware of access patterns.</p>

  <p><strong>If this wasn't you:</strong> Your credentials may be compromised. We recommend:</p>
  <ol style="padding-left: 20px;">
    <li>Rotate your GitHub personal access token immediately</li>
    <li>Review your vault's access history in the dashboard</li>
    <li>Consider rotating any secrets that may have been exposed</li>
  </ol>

  <p style="margin-top: 24px;">
    <a href="${config.app.dashboardUrl}/security#alerts" style="display: inline-block; background: #667eea; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">View Security Alerts</a>
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">

  <p style="color: #a0aec0; font-size: 12px; text-align: center;">
    Keyway - GitHub-native secrets management<br>
    <a href="${config.app.frontendUrl}" style="color: #a0aec0;">${new URL(config.app.frontendUrl).hostname}</a> · <a href="${config.app.docsUrl}" style="color: #a0aec0;">${new URL(config.app.docsUrl).hostname}</a>
  </p>
</body>
</html>
`;
}

function getSecurityAlertEmailText(params: SecurityAlertEmailParams): string {
  const alertConfig = ALERT_CONFIG[params.alertType];
  const locationStr =
    [params.location.city, params.location.country].filter(Boolean).join(", ") || "Unknown";

  return `
${alertConfig.emoji} ${alertConfig.title}

${params.message}

Hey ${params.username},

We detected unusual activity on your Keyway vault. Here are the details:

  Vault: ${params.vaultName}
  IP Address: ${params.ip}
  Location: ${locationStr}
  Time: ${new Date().toUTCString()}

If this was you: No action needed. This alert helps you stay aware of access patterns.

If this wasn't you: Your credentials may be compromised. We recommend:
1. Rotate your GitHub personal access token immediately
2. Review your vault's access history in the dashboard
3. Consider rotating any secrets that may have been exposed

View your security alerts:
${config.app.dashboardUrl}/security#alerts

---
Keyway - GitHub-native secrets management
${config.app.frontendUrl} | ${config.app.docsUrl}
`;
}

// ============================================
// Trial Emails
// ============================================

interface TrialStartedEmailParams {
  to: string;
  username: string;
  orgName: string;
  trialDays: number;
  trialEndsAt: Date;
}

export async function sendTrialStartedEmail(params: TrialStartedEmailParams): Promise<void> {
  if (!resend) {
    logger.debug(
      { to: params.to, org: params.orgName },
      "Skipping trial started email (Resend not configured)"
    );
    return;
  }

  const subject = `Your Team trial has started for ${params.orgName}`;

  try {
    await resend.emails.send({
      from: config.email.fromAddress,
      replyTo: config.email.replyToAddress,
      to: params.to,
      subject,
      html: getTrialStartedEmailHtml(params),
      text: getTrialStartedEmailText(params),
    });
    logger.info({ to: params.to, org: params.orgName }, "Trial started email sent");
  } catch (error) {
    logger.error(
      {
        to: params.to,
        org: params.orgName,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      "Failed to send trial started email"
    );
  }
}

function getTrialStartedEmailHtml(params: TrialStartedEmailParams): string {
  const formattedDate = params.trialEndsAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a202c; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
  <div style="text-align: center; margin-bottom: 32px;">
    <h1 style="font-size: 24px; font-weight: 600; margin: 0;">Your Team trial has started!</h1>
  </div>

  <p>Hey ${params.username},</p>

  <p>You've started a <strong>${params.trialDays}-day Team trial</strong> for <strong>${params.orgName}</strong>!</p>

  <div style="background: #f7fafc; border-radius: 8px; padding: 20px; margin: 24px 0;">
    <p style="margin: 0 0 12px 0; font-weight: 600;">Your trial includes:</p>
    <ul style="margin: 0; padding-left: 20px; color: #4a5568;">
      <li>Unlimited private repositories</li>
      <li>Unlimited environments per vault</li>
      <li>Unlimited secrets</li>
      <li>Unlimited provider integrations (Vercel, Netlify, etc.)</li>
      <li>Organization-wide permissions</li>
      <li>Activity audit logs</li>
    </ul>
  </div>

  <p>Your trial ends on <strong>${formattedDate}</strong>. You can upgrade anytime from your billing page.</p>

  <p style="margin-top: 24px;">
    <a href="${config.app.dashboardUrl}/orgs/${params.orgName}/billing" style="display: inline-block; background: #667eea; color: white; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 500;">Open Dashboard</a>
  </p>

  <p style="margin-top: 32px;">Questions? Just reply to this email — I'm happy to help.</p>

  <p style="margin-top: 24px;">
    Cheers,<br>
    Nicolas
  </p>

  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 32px 0;">

  <p style="color: #a0aec0; font-size: 12px; text-align: center;">
    Keyway - GitHub-native secrets management<br>
    <a href="${config.app.frontendUrl}" style="color: #a0aec0;">${new URL(config.app.frontendUrl).hostname}</a> · <a href="${config.app.docsUrl}" style="color: #a0aec0;">${new URL(config.app.docsUrl).hostname}</a>
  </p>
</body>
</html>
`;
}

function getTrialStartedEmailText(params: TrialStartedEmailParams): string {
  const formattedDate = params.trialEndsAt.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  return `
Your Team trial has started!

Hey ${params.username},

You've started a ${params.trialDays}-day Team trial for ${params.orgName}!

Your trial includes:
- Unlimited private repositories
- Unlimited environments per vault
- Unlimited secrets
- Unlimited provider integrations (Vercel, Netlify, etc.)
- Organization-wide permissions
- Activity audit logs

Your trial ends on ${formattedDate}. You can upgrade anytime from your billing page.

Open your dashboard:
${config.app.dashboardUrl}/orgs/${params.orgName}/billing

Questions? Just reply to this email — I'm happy to help.

Cheers,
Nicolas

---
Keyway - GitHub-native secrets management
${config.app.frontendUrl} | ${config.app.docsUrl}
`;
}
