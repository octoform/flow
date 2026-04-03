const FLOW_PREFIX = 'octoform-flow';

export function generateSessionId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `session-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseFlow(url) {
  const owner = url.searchParams.get('owner')?.trim() ?? '';
  const ownerType = url.searchParams.get('owner_type')?.trim() ?? '';
  const flowType = url.searchParams.get('flow_type')?.trim() ?? '';
  const payloadRaw = url.searchParams.get('payload') ?? '';
  const errors = [];

  if (!owner) {
    errors.push('Missing required query parameter `owner`.');
  }

  if (!['organization', 'user'].includes(ownerType)) {
    errors.push('`owner_type` must be either `organization` or `user`.');
  }

  if (!['bootstrap', 'apply'].includes(flowType)) {
    errors.push('`flow_type` must be either `bootstrap` or `apply`.');
  }

  if (flowType === 'apply' && !payloadRaw) {
    errors.push('`payload` is required when `flow_type=apply`.');
  }

  return {
    owner,
    ownerType,
    flowType,
    payloadRaw,
    errors
  };
}

export function buildFlowArtifacts({ owner, ownerType, flowType, payloadRaw, currentUrl }) {
  const appHomeUrl = new URL('./', currentUrl).href;
  const returnUrl = new URL('return/', appHomeUrl).href;
  const warnings = [];
  let manifests = [];

  if (flowType === 'bootstrap') {
    manifests = [prepareManifestItem(buildBootstrapManifest(appHomeUrl), 'octoform-seed', returnUrl, appHomeUrl)];
  }

  if (flowType === 'apply') {
    const decoded = decodePayload(payloadRaw);

    if (decoded.error) {
      return {
        manifests: [],
        warnings,
        errors: [decoded.error]
      };
    }

    warnings.push(...decoded.warnings);

    const normalized = normalizePayload(decoded.value);
    if (!normalized.length) {
      return {
        manifests: [],
        warnings,
        errors: ['Decoded `payload` did not contain any manifests.']
      };
    }

    manifests = normalized.map((item) => prepareManifestItem(item.manifest, item.key, returnUrl, appHomeUrl, item.label));
  }

  return {
    manifests,
    warnings,
    errors: [],
    actionUrl: ownerType === 'organization'
      ? `https://github.com/organizations/${encodeURIComponent(owner)}/settings/apps/new`
      : 'https://github.com/settings/apps/new'
  };
}

function buildBootstrapManifest(appHomeUrl) {
  return {
    name: 'octoform-seed',
    description: 'Seed GitHub App manifest for Octoform Flow bootstrap sessions.',
    url: appHomeUrl,
    hook_attributes: {
      url: new URL('webhooks/octoform-seed', appHomeUrl).href,
      active: true
    },
    public: false,
    default_permissions: {
      contents: 'read',
      metadata: 'read',
      pull_requests: 'write',
      issues: 'write'
    },
    default_events: ['pull_request', 'pull_request_review', 'issues', 'issue_comment']
  };
}

function prepareManifestItem(manifestInput, fallbackKey, returnUrl, appHomeUrl, fallbackLabel) {
  const manifest = structuredCloneSafe(manifestInput);
  const slug = slugify(fallbackKey || manifest.name || fallbackLabel || 'app');
  const key = String(fallbackKey || manifest.app_id || manifest.id || manifest.name || slug);
  const label = fallbackLabel || manifest.name || key;

  manifest.name = manifest.name || label;
  manifest.url = manifest.url || appHomeUrl;
  manifest.redirect_url = returnUrl;
  manifest.hook_attributes = {
    active: true,
    ...(manifest.hook_attributes || {}),
    url: manifest.hook_attributes?.url || new URL(`webhooks/${slug}`, appHomeUrl).href
  };

  return {
    key,
    label,
    manifest,
    permissions: Object.entries(manifest.default_permissions || {}),
    events: manifest.default_events || []
  };
}

function normalizePayload(payload) {
  if (Array.isArray(payload)) {
    return payload.map((entry, index) => normalizeEntry(entry, `app-${index + 1}`));
  }

  if (payload && Array.isArray(payload.manifests)) {
    return payload.manifests.map((entry, index) => normalizeEntry(entry, `app-${index + 1}`));
  }

  if (payload && payload.apps) {
    return normalizePayload(payload.apps);
  }

  if (looksLikeManifest(payload)) {
    return [normalizeEntry(payload, payload.name || 'app-1')];
  }

  if (payload && typeof payload === 'object') {
    return Object.entries(payload).map(([key, value]) => normalizeEntry(value, key));
  }

  return [];
}

function normalizeEntry(entry, fallbackKey) {
  const wrapper = entry?.manifest && typeof entry.manifest === 'object' ? entry : { manifest: entry };
  const manifest = wrapper.manifest;
  const key = String(wrapper.id || wrapper.app_id || wrapper.appId || wrapper.key || manifest?.name || fallbackKey);
  const label = wrapper.label || wrapper.name || manifest?.name || key;

  return {
    key,
    label,
    manifest
  };
}

function looksLikeManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  return ['default_permissions', 'default_events', 'hook_attributes', 'redirect_url', 'callback_urls'].some((key) => key in value);
}

function decodePayload(rawValue) {
  const warnings = [];
  const attempts = [];
  const seen = new Set();

  const pushAttempt = (value, label) => {
    if (typeof value !== 'string' || seen.has(value)) {
      return;
    }

    seen.add(value);
    attempts.push({ value, label });
  };

  pushAttempt(rawValue, 'raw query value');

  try {
    pushAttempt(decodeURIComponent(rawValue), 'URL-decoded payload');
  } catch {
    // Ignore malformed percent-encoding here; JSON parsing will fail later.
  }

  for (const candidate of [...attempts]) {
    try {
      pushAttempt(decodeBase64Url(candidate.value), `${candidate.label}, then base64url-decoded`);
    } catch {
      // Not a base64-encoded payload.
    }
  }

  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate.value);
      if (candidate.label !== 'raw query value') {
        warnings.push(`Parsed payload via ${candidate.label}.`);
      }

      return { value: parsed, warnings };
    } catch {
      // Try next representation.
    }
  }

  return {
    error: 'Unable to decode `payload`. Pass URL-encoded JSON, plain JSON, or base64url-encoded JSON.'
  };
}

export function buildState(payload) {
  return encodeBase64Url(JSON.stringify(payload));
}

export function parseState(encoded) {
  try {
    return JSON.parse(decodeBase64Url(encoded));
  } catch {
    return null;
  }
}

export function flowFingerprint({ owner, ownerType, flowType, payloadRaw }) {
  const input = JSON.stringify({ owner, ownerType, flowType, payloadRaw });
  let hash = 0;

  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
}

export function getOrCreateSession(fingerprint) {
  const refKey = `${FLOW_PREFIX}:flow:${fingerprint}`;
  const existing = safeReadJson(refKey);

  if (existing?.sessionId) {
    return existing.sessionId;
  }

  const sessionId = generateSessionId();
  safeWriteJson(refKey, { sessionId, updatedAt: new Date().toISOString() });
  return sessionId;
}

export function readSession(sessionId) {
  return safeReadJson(`${FLOW_PREFIX}:session:${sessionId}`) || {
    sessionId,
    codes: {},
    labels: {}
  };
}

export function writeSession(sessionId, updater) {
  const storageKey = `${FLOW_PREFIX}:session:${sessionId}`;
  const current = readSession(sessionId);
  const nextValue = updater(structuredCloneSafe(current));
  safeWriteJson(storageKey, nextValue);
  return nextValue;
}

export function mapCodes(session, manifests) {
  return Object.fromEntries(
    manifests
      .filter((item) => session.codes?.[item.key]?.code)
      .map((item) => [item.key, session.codes[item.key].code])
  );
}

export function completionStats(session, manifests) {
  const completed = manifests.filter((item) => session.codes?.[item.key]?.code).length;

  return {
    completed,
    total: manifests.length,
    done: manifests.length > 0 && completed === manifests.length
  };
}

function safeReadJson(key) {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function safeWriteJson(key, value) {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(key, JSON.stringify(value));
}

function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'app';
}

function encodeBase64Url(value) {
  const base64 = toBase64(value);
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return fromBase64(`${normalized}${padding}`);
}

function toBase64(value) {
  if (typeof btoa === 'function') {
    return btoa(unescape(encodeURIComponent(value)));
  }

  return Buffer.from(value, 'utf8').toString('base64');
}

function fromBase64(value) {
  if (typeof atob === 'function') {
    return decodeURIComponent(escape(atob(value)));
  }

  return Buffer.from(value, 'base64').toString('utf8');
}
