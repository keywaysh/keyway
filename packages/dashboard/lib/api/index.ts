import { usersApi } from './users'
import { vaultsApi } from './vaults'
import { secretsApi } from './secrets'
import { trashApi } from './trash'
import { activityApi } from './activity'
import { securityApi } from './security'
import { environmentsApi } from './environments'
import { collaboratorsApi } from './collaborators'
import { billingApi } from './billing'
import { apiKeysApi } from './api-keys'
import { organizationsApi } from './organizations'
import { orgBillingApi } from './org-billing'
import { exposureApi } from './exposure'
import { syncApi } from './sync'

/**
 * Facade API for backward compatibility
 * Allows using `api.getVaults()` instead of `vaultsApi.getVaults()`
 */
export const api = {
  // Users
  getMe: usersApi.getMe.bind(usersApi),
  getUsage: usersApi.getUsage.bind(usersApi),

  // Vaults
  getVaults: vaultsApi.getVaults.bind(vaultsApi),
  getVaultByRepo: vaultsApi.getVaultByRepo.bind(vaultsApi),
  deleteVault: vaultsApi.deleteVault.bind(vaultsApi),

  // Secrets
  getSecretsByRepo: secretsApi.getSecretsByRepo.bind(secretsApi),
  createSecretByRepo: secretsApi.createSecretByRepo.bind(secretsApi),
  updateSecretByRepo: secretsApi.updateSecretByRepo.bind(secretsApi),
  deleteSecretByRepo: secretsApi.deleteSecretByRepo.bind(secretsApi),
  getSecretValue: secretsApi.getSecretValue.bind(secretsApi),
  getSecretVersions: secretsApi.getSecretVersions.bind(secretsApi),
  getSecretVersionValue: secretsApi.getSecretVersionValue.bind(secretsApi),
  restoreSecretVersion: secretsApi.restoreSecretVersion.bind(secretsApi),

  // Trash
  getTrashedSecrets: trashApi.getTrashedSecrets.bind(trashApi),
  restoreSecret: trashApi.restoreSecret.bind(trashApi),
  permanentlyDeleteSecret: trashApi.permanentlyDeleteSecret.bind(trashApi),
  emptyTrash: trashApi.emptyTrash.bind(trashApi),

  // Activity
  getActivity: activityApi.getActivity.bind(activityApi),

  // Security
  getMySecurityAlerts: securityApi.getMySecurityAlerts.bind(securityApi),
  getSecurityOverview: securityApi.getSecurityOverview.bind(securityApi),
  getAccessLog: securityApi.getAccessLog.bind(securityApi),

  // Environments
  getEnvironments: environmentsApi.getEnvironments.bind(environmentsApi),
  createEnvironment: environmentsApi.createEnvironment.bind(environmentsApi),
  renameEnvironment: environmentsApi.renameEnvironment.bind(environmentsApi),
  deleteEnvironment: environmentsApi.deleteEnvironment.bind(environmentsApi),

  // Collaborators
  getVaultCollaborators: collaboratorsApi.getVaultCollaborators.bind(collaboratorsApi),

  // User Billing
  getSubscription: billingApi.getSubscription.bind(billingApi),
  getPrices: billingApi.getPrices.bind(billingApi),
  createCheckoutSession: billingApi.createCheckoutSession.bind(billingApi),
  createPortalSession: billingApi.createPortalSession.bind(billingApi),

  // API Keys
  getApiKeys: apiKeysApi.getApiKeys.bind(apiKeysApi),
  getApiKey: apiKeysApi.getApiKey.bind(apiKeysApi),
  createApiKey: apiKeysApi.createApiKey.bind(apiKeysApi),
  revokeApiKey: apiKeysApi.revokeApiKey.bind(apiKeysApi),

  // Organizations
  getOrganizations: organizationsApi.getOrganizations.bind(organizationsApi),
  getOrganization: organizationsApi.getOrganization.bind(organizationsApi),
  getOrganizationMembers: organizationsApi.getOrganizationMembers.bind(organizationsApi),
  syncOrganizationMembers: organizationsApi.syncOrganizationMembers.bind(organizationsApi),
  updateOrganization: organizationsApi.updateOrganization.bind(organizationsApi),
  getAvailableOrganizations: organizationsApi.getAvailableOrganizations.bind(organizationsApi),
  connectOrganization: organizationsApi.connectOrganization.bind(organizationsApi),

  // Organization Billing
  getOrganizationBilling: orgBillingApi.getOrganizationBilling.bind(orgBillingApi),
  createOrganizationCheckoutSession: orgBillingApi.createOrganizationCheckoutSession.bind(orgBillingApi),
  createOrganizationPortalSession: orgBillingApi.createOrganizationPortalSession.bind(orgBillingApi),
  getOrganizationTrial: orgBillingApi.getOrganizationTrial.bind(orgBillingApi),
  startOrganizationTrial: orgBillingApi.startOrganizationTrial.bind(orgBillingApi),

  // Exposure
  getMyExposure: exposureApi.getMyExposure.bind(exposureApi),
  getMyExposureUser: exposureApi.getMyExposureUser.bind(exposureApi),
  getOrganizationExposure: exposureApi.getOrganizationExposure.bind(exposureApi),
  getUserExposure: exposureApi.getUserExposure.bind(exposureApi),

  // Sync
  getSyncPreview: syncApi.getSyncPreview.bind(syncApi),
  executeSync: syncApi.executeSync.bind(syncApi),
}

// Export individual API clients for direct usage
export { usersApi } from './users'
export { vaultsApi } from './vaults'
export { secretsApi } from './secrets'
export { trashApi } from './trash'
export { activityApi } from './activity'
export { securityApi } from './security'
export { environmentsApi } from './environments'
export { collaboratorsApi } from './collaborators'
export { billingApi } from './billing'
export { apiKeysApi } from './api-keys'
export { organizationsApi } from './organizations'
export { orgBillingApi } from './org-billing'
export { exposureApi } from './exposure'
export { syncApi } from './sync'

// Export the base client for custom extensions
export { BaseApiClient } from './client'
