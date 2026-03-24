import {
  getExternalApplicationPlanLimit,
  getExternalApplicationSupportedFlow,
  getExternalApplicationTemplate,
  listExternalApplicationPlanLimits,
  listExternalApplicationSupportedFlows,
  listExternalApplicationTemplates
} from '../../../services/internal-contracts/src/index.mjs';

function unique(values = []) {
  return [...new Set(values.filter((value) => value !== undefined && value !== null))];
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isLikelyHttpsUri(value, { allowHttpLocalhost = false } = {}) {
  if (!isNonEmptyString(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:') {
      return true;
    }

    return allowHttpLocalhost && parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isPemCertificate(value) {
  return isNonEmptyString(value) && /-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----/.test(value.trim());
}

function getLimitValue(planLimit, metricKey) {
  return planLimit?.limits?.find((limit) => limit.metricKey === metricKey)?.limit ?? null;
}

function buildValidationCheck(code, severity, message, fieldPath) {
  return { code, severity, message, fieldPath };
}

function pushUriValidation(violations, values = [], fieldPath, { allowEmpty = true } = {}) {
  if (!Array.isArray(values)) {
    violations.push(buildValidationCheck('invalid_type', 'error', `${fieldPath} must be an array of URIs.`, fieldPath));
    return;
  }

  if (!allowEmpty && values.length === 0) {
    violations.push(buildValidationCheck('missing_uri', 'error', `${fieldPath} must declare at least one URI.`, fieldPath));
  }

  const normalized = unique(values);
  if (normalized.length !== values.length) {
    violations.push(buildValidationCheck('duplicate_uri', 'error', `${fieldPath} must not contain duplicates.`, fieldPath));
  }

  for (const uri of values) {
    if (!isLikelyHttpsUri(uri, { allowHttpLocalhost: true })) {
      violations.push(buildValidationCheck('invalid_uri', 'error', `${fieldPath} contains an invalid or non-HTTPS URI.`, fieldPath));
    }

    if (uri === '*' || /\*/.test(uri)) {
      violations.push(buildValidationCheck('wildcard_uri', 'error', `${fieldPath} cannot contain wildcard URIs.`, fieldPath));
    }
  }
}

function validateAttributeMappers(attributeMappers = [], violations, { maxAttributeMappers, providerIds }) {
  if (!Array.isArray(attributeMappers)) {
    violations.push(buildValidationCheck('invalid_attribute_mappers', 'error', 'attributeMappers must be an array.', 'attributeMappers'));
    return;
  }

  if (maxAttributeMappers !== null && attributeMappers.length > maxAttributeMappers) {
    violations.push(
      buildValidationCheck(
        'plan_limit_exceeded',
        'error',
        `attributeMappers exceeds the plan limit of ${maxAttributeMappers}.`,
        'attributeMappers'
      )
    );
  }

  const seenMapperIds = new Set();
  for (const [index, mapper] of attributeMappers.entries()) {
    const fieldPath = `attributeMappers[${index}]`;
    if (!isNonEmptyString(mapper?.mapperId)) {
      violations.push(buildValidationCheck('missing_mapper_id', 'error', 'Each attribute mapper requires mapperId.', `${fieldPath}.mapperId`));
    } else if (seenMapperIds.has(mapper.mapperId)) {
      violations.push(buildValidationCheck('duplicate_mapper_id', 'error', `Duplicate mapperId ${mapper.mapperId}.`, `${fieldPath}.mapperId`));
    } else {
      seenMapperIds.add(mapper.mapperId);
    }

    if (!isNonEmptyString(mapper?.name) || !isNonEmptyString(mapper?.source) || !isNonEmptyString(mapper?.target)) {
      violations.push(buildValidationCheck('invalid_mapper_shape', 'error', 'Each attribute mapper requires name, source, and target.', fieldPath));
    }

    if (mapper?.providerId && !providerIds.has(mapper.providerId)) {
      violations.push(
        buildValidationCheck(
          'unknown_provider_reference',
          'error',
          `Attribute mapper ${mapper.mapperId} references unknown provider ${mapper.providerId}.`,
          `${fieldPath}.providerId`
        )
      );
    }

    const tokenTargets = mapper?.tokenTargets ?? [];
    if (!Array.isArray(tokenTargets) || tokenTargets.length === 0) {
      violations.push(buildValidationCheck('missing_token_targets', 'error', 'Each attribute mapper requires at least one token target.', `${fieldPath}.tokenTargets`));
    }
  }
}

function validateFederatedProviders({ protocol, providers = [], violations, maxProviders }) {
  if (!Array.isArray(providers)) {
    violations.push(buildValidationCheck('invalid_provider_list', 'error', 'federatedProviders must be an array.', 'federatedProviders'));
    return new Set();
  }

  if (maxProviders !== null && providers.length > maxProviders) {
    violations.push(
      buildValidationCheck(
        'plan_limit_exceeded',
        'error',
        `federatedProviders exceeds the plan limit of ${maxProviders}.`,
        'federatedProviders'
      )
    );
  }

  const providerIds = new Set();
  const aliases = new Set();

  for (const [index, provider] of providers.entries()) {
    const fieldPath = `federatedProviders[${index}]`;
    if (!isNonEmptyString(provider?.providerId)) {
      violations.push(buildValidationCheck('missing_provider_id', 'error', 'Each federated provider requires providerId.', `${fieldPath}.providerId`));
    } else if (providerIds.has(provider.providerId)) {
      violations.push(buildValidationCheck('duplicate_provider_id', 'error', `Duplicate providerId ${provider.providerId}.`, `${fieldPath}.providerId`));
    } else {
      providerIds.add(provider.providerId);
    }

    if (!isNonEmptyString(provider?.alias)) {
      violations.push(buildValidationCheck('missing_provider_alias', 'error', 'Each federated provider requires alias.', `${fieldPath}.alias`));
    } else if (aliases.has(provider.alias)) {
      violations.push(buildValidationCheck('duplicate_provider_alias', 'error', `Duplicate provider alias ${provider.alias}.`, `${fieldPath}.alias`));
    } else {
      aliases.add(provider.alias);
    }

    if (!['oidc', 'saml'].includes(provider?.protocol)) {
      violations.push(buildValidationCheck('unsupported_provider_protocol', 'error', 'Federated providers must use OIDC or SAML.', `${fieldPath}.protocol`));
      continue;
    }

    if (protocol === 'saml' && provider.protocol !== 'saml') {
      violations.push(
        buildValidationCheck(
          'protocol_mismatch',
          'error',
          'SAML applications can only declare SAML federated providers in the canonical contract.',
          `${fieldPath}.protocol`
        )
      );
    }

    if (provider.protocol === 'oidc') {
      if (!isNonEmptyString(provider?.issuer) && !isLikelyHttpsUri(provider?.metadataUrl)) {
        violations.push(
          buildValidationCheck(
            'missing_oidc_discovery',
            'error',
            'OIDC providers must declare issuer or metadataUrl/discovery URL.',
            fieldPath
          )
        );
      }

      const requestedScopes = provider?.requestedScopes ?? [];
      if (unique(requestedScopes).length !== requestedScopes.length) {
        violations.push(buildValidationCheck('duplicate_requested_scope', 'error', 'OIDC provider scopes must be unique.', `${fieldPath}.requestedScopes`));
      }
    }

    if (provider.protocol === 'saml') {
      const hasMetadata = isLikelyHttpsUri(provider?.metadataUrl) || isNonEmptyString(provider?.metadataXml);
      const hasEndpoints = isLikelyHttpsUri(provider?.ssoServiceUrl) || isLikelyHttpsUri(provider?.sloServiceUrl);
      if (!hasMetadata && !hasEndpoints) {
        violations.push(
          buildValidationCheck(
            'missing_saml_metadata',
            'error',
            'SAML providers require metadataUrl, metadataXml, or explicit SSO/SLO endpoints.',
            fieldPath
          )
        );
      }

      const certificates = provider?.certificates ?? [];
      if (!Array.isArray(certificates) || certificates.length === 0) {
        violations.push(
          buildValidationCheck('missing_certificate', 'error', 'SAML providers require at least one signing certificate.', `${fieldPath}.certificates`)
        );
      } else {
        for (const [certificateIndex, certificate] of certificates.entries()) {
          if (!isPemCertificate(certificate?.pem)) {
            violations.push(
              buildValidationCheck(
                'invalid_certificate',
                'error',
                'SAML provider certificates must be PEM encoded.',
                `${fieldPath}.certificates[${certificateIndex}].pem`
              )
            );
          }
        }
      }
    }
  }

  return providerIds;
}

export function getExternalApplicationSupportMatrix() {
  return {
    supportedFlows: listExternalApplicationSupportedFlows(),
    templates: listExternalApplicationTemplates(),
    planLimits: listExternalApplicationPlanLimits()
  };
}

export function listStarterTemplates({ planId } = {}) {
  const templates = listExternalApplicationTemplates();
  if (!planId) {
    return templates;
  }

  return templates.filter((template) => (template.recommendedPlanIds ?? []).includes(planId));
}

export function listSupportedAuthenticationFlows({ planId, protocol } = {}) {
  let flows = listExternalApplicationSupportedFlows();

  if (planId) {
    const planLimit = getExternalApplicationPlanLimit(planId);
    const supportedFlowIds = new Set(planLimit?.supportedAuthenticationFlows ?? []);
    flows = flows.filter((flow) => supportedFlowIds.has(flow.flowId));
  }

  if (protocol) {
    flows = flows.filter((flow) => flow.protocol === protocol);
  }

  return flows;
}

export function validateExternalApplicationConfiguration({ application = {}, planId } = {}) {
  const violations = [];
  const protocol = application.protocol;
  const planLimit = planId ? getExternalApplicationPlanLimit(planId) : null;
  const maxProviders = getLimitValue(planLimit, 'identity.federated_providers.per_application');
  const maxAttributeMappers = getLimitValue(planLimit, 'identity.attribute_mappers.per_application');
  const maxRoles = getLimitValue(planLimit, 'identity.roles.per_application');
  const maxScopes = getLimitValue(planLimit, 'identity.scopes.per_application');
  const planSupportedProtocols = new Set(planLimit?.supportedProtocols ?? []);
  const planSupportedFlows = new Set(planLimit?.supportedAuthenticationFlows ?? []);
  const planTemplateIds = new Set(planLimit?.templateIds ?? []);

  if (!['oidc', 'saml'].includes(protocol)) {
    violations.push(buildValidationCheck('unsupported_protocol', 'error', 'Only OIDC and SAML federation are supported by this feature.', 'protocol'));
  }

  if (planId && planSupportedProtocols.size > 0 && !planSupportedProtocols.has(protocol)) {
    violations.push(
      buildValidationCheck('plan_protocol_not_supported', 'error', `Plan ${planId} does not support protocol ${protocol}.`, 'protocol')
    );
  }

  if (application.templateId) {
    const template = getExternalApplicationTemplate(application.templateId);
    if (!template) {
      violations.push(buildValidationCheck('unknown_template', 'error', `Unknown templateId ${application.templateId}.`, 'templateId'));
    } else {
      if (template.protocol !== protocol) {
        violations.push(buildValidationCheck('template_protocol_mismatch', 'error', 'templateId must match the application protocol.', 'templateId'));
      }
      if (planId && planTemplateIds.size > 0 && !planTemplateIds.has(application.templateId)) {
        violations.push(
          buildValidationCheck('plan_template_not_supported', 'error', `Plan ${planId} does not allow template ${application.templateId}.`, 'templateId')
        );
      }
    }
  }

  const authenticationFlows = application.authenticationFlows ?? [];
  if (!Array.isArray(authenticationFlows) || authenticationFlows.length === 0) {
    violations.push(buildValidationCheck('missing_authentication_flow', 'error', 'authenticationFlows must declare at least one supported flow.', 'authenticationFlows'));
  } else {
    const uniqueFlows = unique(authenticationFlows);
    if (uniqueFlows.length !== authenticationFlows.length) {
      violations.push(buildValidationCheck('duplicate_authentication_flow', 'error', 'authenticationFlows must be unique.', 'authenticationFlows'));
    }

    for (const [index, flowId] of authenticationFlows.entries()) {
      const flow = getExternalApplicationSupportedFlow(flowId);
      if (!flow) {
        violations.push(buildValidationCheck('unknown_authentication_flow', 'error', `Unknown authentication flow ${flowId}.`, `authenticationFlows[${index}]`));
        continue;
      }

      if (flow.protocol !== protocol) {
        violations.push(buildValidationCheck('authentication_flow_protocol_mismatch', 'error', `${flowId} is not compatible with protocol ${protocol}.`, `authenticationFlows[${index}]`));
      }

      if (planId && planSupportedFlows.size > 0 && !planSupportedFlows.has(flowId)) {
        violations.push(buildValidationCheck('plan_flow_not_supported', 'error', `Plan ${planId} does not support flow ${flowId}.`, `authenticationFlows[${index}]`));
      }
    }
  }

  const login = application.login ?? {};
  const logout = application.logout ?? {};
  pushUriValidation(violations, login.redirectUris ?? [], 'login.redirectUris', { allowEmpty: protocol === 'saml' });
  pushUriValidation(violations, logout.postLogoutRedirectUris ?? [], 'logout.postLogoutRedirectUris');

  if (login.defaultRedirectUri && !isLikelyHttpsUri(login.defaultRedirectUri, { allowHttpLocalhost: true })) {
    violations.push(buildValidationCheck('invalid_default_redirect_uri', 'error', 'login.defaultRedirectUri must be a valid HTTPS URI.', 'login.defaultRedirectUri'));
  }

  if (logout.frontChannelLogoutUri && !isLikelyHttpsUri(logout.frontChannelLogoutUri, { allowHttpLocalhost: true })) {
    violations.push(buildValidationCheck('invalid_frontchannel_logout_uri', 'error', 'logout.frontChannelLogoutUri must be a valid HTTPS URI.', 'logout.frontChannelLogoutUri'));
  }

  if (logout.backChannelLogoutUri && !isLikelyHttpsUri(logout.backChannelLogoutUri, { allowHttpLocalhost: true })) {
    violations.push(buildValidationCheck('invalid_backchannel_logout_uri', 'error', 'logout.backChannelLogoutUri must be a valid HTTPS URI.', 'logout.backChannelLogoutUri'));
  }

  const scopes = application.scopes ?? [];
  if (!Array.isArray(scopes)) {
    violations.push(buildValidationCheck('invalid_scopes', 'error', 'scopes must be an array.', 'scopes'));
  } else {
    if (maxScopes !== null && scopes.length > maxScopes) {
      violations.push(buildValidationCheck('plan_limit_exceeded', 'error', `scopes exceeds the plan limit of ${maxScopes}.`, 'scopes'));
    }
    const names = scopes.map((scope) => scope?.scopeName).filter(Boolean);
    if (unique(names).length !== names.length) {
      violations.push(buildValidationCheck('duplicate_scope', 'error', 'Application scopes must be unique.', 'scopes'));
    }
  }

  const roles = application.roles ?? [];
  if (!Array.isArray(roles)) {
    violations.push(buildValidationCheck('invalid_roles', 'error', 'roles must be an array.', 'roles'));
  } else {
    if (maxRoles !== null && roles.length > maxRoles) {
      violations.push(buildValidationCheck('plan_limit_exceeded', 'error', `roles exceeds the plan limit of ${maxRoles}.`, 'roles'));
    }
    const names = roles.map((role) => role?.roleName).filter(Boolean);
    if (unique(names).length !== names.length) {
      violations.push(buildValidationCheck('duplicate_role', 'error', 'Application roles must be unique.', 'roles'));
    }
  }

  const providerIds = validateFederatedProviders({
    protocol,
    providers: application.federatedProviders ?? [],
    violations,
    maxProviders
  });

  validateAttributeMappers(application.attributeMappers ?? [], violations, { maxAttributeMappers, providerIds });

  const client = application.iamClient ?? {};
  const clientType = client.clientType;
  if (protocol === 'oidc') {
    if (!['public', 'confidential'].includes(clientType)) {
      violations.push(buildValidationCheck('invalid_client_type', 'error', 'OIDC applications require a public or confidential iamClient.clientType.', 'iamClient.clientType'));
    }

    if (authenticationFlows.includes('oidc_authorization_code_pkce') && clientType !== 'public') {
      violations.push(buildValidationCheck('client_flow_mismatch', 'error', 'oidc_authorization_code_pkce requires a public client.', 'iamClient.clientType'));
    }

    if (
      authenticationFlows.some((flowId) => ['oidc_authorization_code_client_secret', 'oidc_client_credentials'].includes(flowId)) &&
      clientType !== 'confidential'
    ) {
      violations.push(buildValidationCheck('client_flow_mismatch', 'error', 'Confidential OIDC flows require iamClient.clientType=confidential.', 'iamClient.clientType'));
    }
  }

  if (protocol === 'saml') {
    if (clientType && clientType === 'public') {
      violations.push(buildValidationCheck('invalid_client_type', 'error', 'SAML applications cannot use a public iamClient.clientType.', 'iamClient.clientType'));
    }

    if (authenticationFlows.includes('saml_idp_initiated') && login.allowIdpInitiated !== true) {
      violations.push(buildValidationCheck('idp_initiated_requires_flag', 'error', 'saml_idp_initiated requires login.allowIdpInitiated=true.', 'login.allowIdpInitiated'));
    }

    if (logout.signedRequestsRequired !== true) {
      violations.push(buildValidationCheck('missing_signed_logout', 'error', 'SAML applications require logout.signedRequestsRequired=true.', 'logout.signedRequestsRequired'));
    }
  }

  return {
    ok: violations.length === 0,
    planLimit,
    supportedFlows: listSupportedAuthenticationFlows({ planId, protocol }),
    starterTemplates: listStarterTemplates({ planId }).filter((template) => !protocol || template.protocol === protocol),
    validation: {
      status: violations.some((violation) => violation.severity === 'error') ? 'invalid' : 'valid',
      checks: violations
    }
  };
}
