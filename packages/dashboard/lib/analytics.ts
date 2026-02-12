/**
 * PostHog analytics helper for client-side event tracking
 */

declare global {
  interface Window {
    posthog?: {
      capture: (event: string, properties?: Record<string, unknown>) => void;
      identify: (distinctId: string, properties?: Record<string, unknown>) => void;
    };
  }
}

/**
 * Analytics event names for consistent tracking across the site
 */
export const AnalyticsEvents = {
  // Landing page
  LANDING_VIEW: 'landing_view',
  PRICING_VIEW: 'pricing_view',
  PRICING_PLAN_CLICK: 'pricing_plan_click',

  // Auth flow
  LOGIN_PAGE_VIEW: 'login_page_view',
  LOGIN_GITHUB_CLICK: 'login_github_click',
  AUTH_CALLBACK_SUCCESS: 'auth_callback_success',
  AUTH_CALLBACK_ERROR: 'auth_callback_error',

  // Dashboard
  DASHBOARD_VIEW: 'dashboard_view',
  VAULT_CARD_CLICK: 'vault_card_click',
  VAULT_DETAIL_VIEW: 'vault_detail_view',
  SECRET_MODAL_OPEN: 'secret_modal_open',
  SECRET_CREATE: 'secret_create',
  SECRET_EDIT: 'secret_edit',
  SECRET_DELETE: 'secret_delete',
  SECRET_VIEW: 'secret_view',
  SECRET_COPY: 'secret_copy',
  SECRET_COPY_TO_ENV: 'secret_copy_to_env',
  SECRET_VERSION_RESTORED: 'secret_version_restored',
  ACTIVITY_VIEW: 'activity_view',
  SETTINGS_VIEW: 'settings_view',

  // Vault management
  VAULT_CREATE: 'vault_create',
  VAULT_DELETE: 'vault_delete',
  VAULT_SEARCH: 'vault_search',

  // Bulk import
  BULK_IMPORT_OPEN: 'bulk_import_open',
  BULK_IMPORT_SUCCESS: 'bulk_import_success',

  // Environment management
  ENVIRONMENT_VIEW: 'environment_view',
  ENVIRONMENT_CREATE: 'environment_create',
  ENVIRONMENT_RENAME: 'environment_rename',
  ENVIRONMENT_DELETE: 'environment_delete',
  ENVIRONMENT_FILTER: 'environment_filter',

  // Trash operations
  TRASH_VIEW: 'trash_view',
  TRASH_RESTORE: 'trash_restore',
  TRASH_PERMANENT_DELETE: 'trash_permanent_delete',
  TRASH_EMPTY: 'trash_empty',

  // Provider sync
  SYNC_PREVIEW: 'sync_preview',
  SYNC_EXECUTE: 'sync_execute',
  SYNC_SUCCESS: 'sync_success',
  SYNC_ERROR: 'sync_error',

  // Integrations
  INTEGRATION_CONNECT: 'integration_connect',
  INTEGRATION_DISCONNECT: 'integration_disconnect',

  // Collaborators
  COLLABORATORS_VIEW: 'collaborators_view',

  // API Keys
  API_KEYS_VIEW: 'api_keys_view',
  API_KEY_CREATE: 'api_key_create',
  API_KEY_REVOKE: 'api_key_revoke',
  API_KEY_COPY: 'api_key_copy',

  // Organizations
  ORG_LIST_VIEW: 'org_list_view',
  ORG_SWITCH: 'org_switch',
  ORG_SETTINGS_VIEW: 'org_settings_view',
  ORG_SETTINGS_SAVE: 'org_settings_save',
  ORG_CONNECT_MODAL_OPEN: 'org_connect_modal_open',
  ORG_CONNECT: 'org_connect',
  ORG_CONNECT_ERROR: 'org_connect_error',
  ORG_APP_INSTALL_CLICK: 'org_app_install_click',

  // Upgrade page
  UPGRADE_VIEW: 'upgrade_view',
  UPGRADE_CLICK: 'upgrade_click',
  UPGRADE_INTERVAL_CHANGE: 'upgrade_interval_change',

  // Exposure (offboarding)
  EXPOSURE_VIEW: 'exposure_view',
  EXPOSURE_USER_EXPAND: 'exposure_user_expand',
  EXPOSURE_PERIOD_FILTER: 'exposure_period_filter',
  EXPOSURE_CSV_EXPORT: 'exposure_csv_export',

  // Security Center
  SECURITY_ALERTS_VIEW: 'security_alerts_view',
  SECURITY_OVERVIEW_VIEW: 'security_overview_view',
  SECURITY_EXPOSURE_VIEW: 'security_exposure_view',
  SECURITY_ACCESS_LOG_VIEW: 'security_access_log_view',
  SECURITY_TAB_CHANGE: 'security_tab_change',
  SECURITY_ACCESS_LOG_FILTER: 'security_access_log_filter',
} as const;

export type AnalyticsEvent = (typeof AnalyticsEvents)[keyof typeof AnalyticsEvents];

/**
 * Track a custom event in PostHog
 * Safe to call on server or before PostHog loads - will no-op gracefully
 */
export function trackEvent(event: AnalyticsEvent | string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.capture(event, properties);
  }
}

/**
 * Identify a user in PostHog with properties
 */
export function identifyUser(userId: string, properties?: Record<string, unknown>) {
  if (typeof window !== 'undefined' && window.posthog) {
    window.posthog.identify(userId, properties);
  }
}
