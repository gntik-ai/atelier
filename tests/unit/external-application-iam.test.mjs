import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getExternalApplicationSupportMatrix,
  listStarterTemplates,
  listSupportedAuthenticationFlows,
  validateExternalApplicationConfiguration
} from '../../apps/control-plane/src/external-application-iam.mjs';

test('external application IAM helper exposes starter templates and plan-filtered flow catalogs', () => {
  const supportMatrix = getExternalApplicationSupportMatrix();
  const growthFlows = listSupportedAuthenticationFlows({ planId: 'pln_01growth', protocol: 'oidc' }).map((flow) => flow.flowId);
  const enterpriseSamlTemplates = listStarterTemplates({ planId: 'pln_01enterprise' })
    .filter((template) => template.protocol === 'saml')
    .map((template) => template.templateId);

  assert.equal(supportMatrix.supportedFlows.length, 5);
  assert.equal(supportMatrix.templates.length, 3);
  assert.equal(supportMatrix.planLimits.length, 4);
  assert.deepEqual(growthFlows, ['oidc_authorization_code_pkce', 'oidc_authorization_code_client_secret', 'oidc_client_credentials']);
  assert.deepEqual(enterpriseSamlTemplates, ['tpl_b2b_saml']);
});

test('external application IAM validation accepts a valid OIDC SPA and rejects plan or certificate violations', () => {
  const validOidcApplication = {
    protocol: 'oidc',
    templateId: 'tpl_spa_oidc_pkce',
    authenticationFlows: ['oidc_authorization_code_pkce'],
    login: {
      redirectUris: ['https://spa.example.com/auth/callback'],
      defaultRedirectUri: 'https://spa.example.com/auth/callback',
      allowIdpInitiated: false
    },
    logout: {
      postLogoutRedirectUris: ['https://spa.example.com/logout/callback'],
      frontChannelLogoutUri: 'https://spa.example.com/logout/front-channel'
    },
    scopes: [{ scopeName: 'openid' }, { scopeName: 'profile' }],
    roles: [{ roleName: 'workspace_viewer' }],
    attributeMappers: [
      {
        mapperId: 'map_workspace',
        name: 'workspace-context',
        source: 'workspaceId',
        target: 'workspace_id',
        mapperType: 'claim',
        tokenTargets: ['access_token', 'id_token']
      }
    ],
    federatedProviders: [
      {
        providerId: 'google-workspace',
        alias: 'google-workspace',
        displayName: 'Google Workspace',
        protocol: 'oidc',
        providerMode: 'metadata_url',
        issuer: 'https://accounts.google.com',
        metadataUrl: 'https://accounts.google.com/.well-known/openid-configuration',
        requestedScopes: ['openid', 'profile', 'email']
      }
    ],
    iamClient: {
      clientType: 'public'
    }
  };

  const invalidSamlOnGrowth = {
    protocol: 'saml',
    templateId: 'tpl_b2b_saml',
    authenticationFlows: ['saml_sp_initiated'],
    login: {
      defaultRedirectUri: 'https://partner.example.com/saml/acs',
      allowIdpInitiated: false
    },
    logout: {
      frontChannelLogoutUri: 'https://partner.example.com/saml/slo',
      signedRequestsRequired: false
    },
    roles: [{ roleName: 'partner_admin' }],
    attributeMappers: [
      {
        mapperId: 'map_partner_email',
        providerId: 'corp-directory',
        name: 'partner-email',
        source: 'email',
        target: 'email',
        mapperType: 'attribute',
        tokenTargets: ['saml_assertion']
      }
    ],
    federatedProviders: [
      {
        providerId: 'corp-directory',
        alias: 'corp-directory',
        displayName: 'Corporate Directory',
        protocol: 'saml',
        providerMode: 'metadata_url',
        metadataUrl: 'https://partner.example.com/saml/metadata',
        certificates: [
          {
            certificateId: 'cert_01',
            usage: 'signing',
            format: 'pem',
            pem: 'not-a-pem-certificate'
          }
        ]
      }
    ],
    iamClient: {
      clientType: 'confidential'
    }
  };

  const validResult = validateExternalApplicationConfiguration({ application: validOidcApplication, planId: 'pln_01starter' });
  const invalidResult = validateExternalApplicationConfiguration({ application: invalidSamlOnGrowth, planId: 'pln_01growth' });

  assert.equal(validResult.ok, true);
  assert.equal(validResult.validation.status, 'valid');
  assert.equal(validResult.supportedFlows.some((flow) => flow.flowId === 'oidc_authorization_code_pkce'), true);

  assert.equal(invalidResult.ok, false);
  assert.equal(invalidResult.validation.checks.some((check) => check.code === 'plan_protocol_not_supported'), true);
  assert.equal(invalidResult.validation.checks.some((check) => check.code === 'invalid_certificate'), true);
  assert.equal(invalidResult.validation.checks.some((check) => check.code === 'missing_signed_logout'), true);
});
