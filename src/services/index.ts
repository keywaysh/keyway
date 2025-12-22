// Vault service
export {
  getVaultsForUser,
  getVaultByRepo,
  getVaultByRepoInternal,
  touchVault,
  type VaultListItem,
  type VaultDetails,
} from './vault.service';

// Secret service
export {
  getSecretsForVault,
  getSecretsCount,
  upsertSecret,
  updateSecret,
  getSecretById,
  secretExists,
  getSecretValue,
  generatePreview,
  // Trash operations
  trashSecret,
  trashSecretsByIds,
  permanentlyDeleteSecret,
  getTrashedSecrets,
  getTrashedSecretsCount,
  getTrashedSecretById,
  restoreSecret,
  emptyTrash,
  purgeExpiredTrash,
  type SecretListItem,
  type CreateSecretInput,
  type UpdateSecretInput,
  type TrashedSecretItem,
} from './secret.service';

// Activity service
export {
  logActivity,
  getActivityForUser,
  extractRequestInfo,
  detectPlatform,
  type ActivityLogItem,
  type LogActivityInput,
} from './activity.service';

// Usage service
export {
  computeUserUsage,
  getUserUsage,
  getUserUsageResponse,
  checkVaultCreationAllowed,
  canWriteToVault,
  getPrivateVaultAccess,
  type UserUsage,
  type UserUsageResponse,
  type PrivateVaultAccess,
} from './usage.service';

// Billing service
export {
  isStripeEnabled,
  getOrCreateStripeCustomer,
  createCheckoutSession,
  createPortalSession,
  getUserSubscription,
  isEventProcessed,
  constructWebhookEvent,
  handleWebhookEvent,
  getAvailablePrices,
} from './billing.service';

// GitHub App service
export {
  generateAppJWT,
  getInstallationToken,
  findInstallationForRepo,
  checkInstallationStatus,
  assertRepoAccessViaApp,
  createInstallation,
  deleteInstallation,
  updateInstallationStatus,
  updateInstallationRepos,
  getInstallationsForUser,
  getInstallationByGitHubId,
} from './github-app.service';

// Trial service
export {
  TRIAL_DURATION_DAYS,
  getTrialInfo,
  isTrialActive,
  isTrialExpired,
  hasHadTrial,
  startTrial,
  convertTrial,
  expireTrial,
  getEffectivePlanWithTrial,
  type TrialStatus,
  type TrialInfo,
  type StartTrialInput,
  type StartTrialResult,
  type ConvertTrialInput,
  type ExpireTrialInput,
} from './trial.service';
