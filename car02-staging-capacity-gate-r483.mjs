/**
 * DPRO CAR02 V4.83 — fail-closed, read-only Supabase staging capacity preflight.
 * No SDK, network, credentials, SQL, mutations, or release operations.
 * Inputs are caller-provided organization/project metadata ONLY.
 * A possible free slot is never proof of permission to create a project.
 */
export const CAR02_V483_RELEASE_LOCK = true;
export const CAR02_V483_FREE_ACTIVE_PROJECT_LIMIT = 2;

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmpty = value => typeof value === 'string' && value.trim().length > 0;

function hold(reason, extra = {}) {
  return Object.freeze({
    systemCode: 'CAR02', version: 'V4.83', decision: 'HOLD', reason,
    releaseLock: true, commercialReleaseAllowed: false,
    projectCreationAllowed: false, existingProjectReuseAllowed: false,
    billingChangeAllowed: false, databaseAccessAllowed: false,
    workerDeployAllowed: false, lineDispatchAllowed: false,
    commercialProviderProofsVerified: 0, requiredCommercialProviderProofs: 7,
    ...extra
  });
}

/**
 * organizations: [{id,name,...}]
 * organizationDetails: [{id,plan,...}] (from explicit read-only get_organization)
 * projects: [{id,organization_id,status,...}] (from read-only list_projects)
 * Does NOT assume any unused Free slot is actually available: other Owner/Admin
 * memberships can lower quota. Paid plans still require owner cost consent.
 */
export function evaluateCar02StagingCapacityR483({organizations, organizationDetails, projects} = {}) {
  if (!Array.isArray(organizations) || !Array.isArray(organizationDetails) ||
      !Array.isArray(projects) || organizations.length === 0) {
    return hold('metadata_missing_or_incomplete');
  }
  const orgIds = new Set();
  for (const org of organizations) {
    if (!isObject(org) || !nonEmpty(org.id) || orgIds.has(org.id))
      return hold('organization_inventory_invalid');
    orgIds.add(org.id);
  }
  const detailMap = new Map();
  for (const detail of organizationDetails) {
    if (!isObject(detail) || !nonEmpty(detail.id) || !orgIds.has(detail.id) ||
        detailMap.has(detail.id) || !nonEmpty(detail.plan)) {
      return hold('subscription_metadata_invalid');
    }
    detailMap.set(detail.id, detail.plan.trim().toLowerCase());
  }
  if (detailMap.size !== orgIds.size) return hold('subscription_metadata_incomplete');
  const validPlans = new Set(['free', 'pro', 'team', 'enterprise']);
  if ([...detailMap.values()].some(plan => !validPlans.has(plan)))
    return hold('unrecognized_subscription_plan');

  const projectIds = new Set();
  let freeActiveProjects = 0;
  let freePausedProjects = 0;
  let paidProjects = 0;
  for (const project of projects) {
    if (!isObject(project) || !nonEmpty(project.id) || !nonEmpty(project.organization_id) ||
        !nonEmpty(project.status) || projectIds.has(project.id) ||
        !detailMap.has(project.organization_id)) {
      return hold('project_inventory_invalid');
    }
    projectIds.add(project.id);
    if (detailMap.get(project.organization_id) === 'free') {
      // Unknown or degraded states count against the upper-bound free quota.
      if (project.status.toUpperCase().startsWith('PAUSED')) freePausedProjects++;
      else freeActiveProjects++;
    } else paidProjects++;
  }

  const upperBound = Math.max(0, CAR02_V483_FREE_ACTIVE_PROJECT_LIMIT - freeActiveProjects);
  const counts = Object.freeze({
    observedOrganizations: organizations.length,
    observedProjects: projects.length,
    freeActiveProjects, freePausedProjects, paidProjects,
    freeSlotsUpperBound: upperBound,
    extraOrganizationMemberQuotaChecked: false,
    car02DedicatedProjectVerified: false,
    inventoryEvidenceClass: 'read_only_metadata_not_staging_or_commercial_proof'
  });
  if (freeActiveProjects >= CAR02_V483_FREE_ACTIVE_PROJECT_LIMIT)
    return hold('free_capacity_exhausted', counts);
  if (![...detailMap.values()].includes('free'))
    return hold('no_free_organization_cost_review_required', counts);
  return hold('unverified_free_slot_requires_owner_and_member_quota_review', counts);
}

/** Read-only injected adapters only; no provider calls are built into this module. */
export function createCar02StagingCapacityAuditorR483({listOrganizations, listProjects, getOrganization} = {}) {
  if (![listOrganizations, listProjects, getOrganization].every(v => typeof v === 'function'))
    throw Error('V483_READ_ONLY_METADATA_ADAPTERS_REQUIRED');
  return Object.freeze({inspect: async () => {
    if (CAR02_V483_RELEASE_LOCK !== true) return hold('release_lock_missing');
    let organizations, projects;
    try {
      [organizations, projects] = await Promise.all([listOrganizations(), listProjects()]);
    } catch { return hold('read_only_inventory_unavailable'); }
    if (!Array.isArray(organizations) || !Array.isArray(projects))
      return hold('metadata_missing_or_incomplete');
    let organizationDetails;
    try {
      organizationDetails = await Promise.all(organizations.map(({id}) => getOrganization(id)));
    } catch { return hold('read_only_plan_unavailable'); }
    return evaluateCar02StagingCapacityR483({organizations, projects, organizationDetails});
  }});
}
