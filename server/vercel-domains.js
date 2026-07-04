function clean(value = '') {
  return String(value || '').trim();
}

function vercelToken() {
  return clean(process.env.VERCEL_API_TOKEN || process.env.VERCEL_TOKEN || process.env.VERCEL_AUTH_TOKEN);
}

function vercelProjectId() {
  return clean(
    process.env.VERCEL_AUTOMATION_PROJECT_ID
    || process.env.VERCEL_PROJECT_ID
    || process.env.VERCEL_PROJECT_NAME
    || 'project-thceq'
  );
}

function vercelTeamId() {
  return clean(process.env.VERCEL_AUTOMATION_TEAM_ID || process.env.VERCEL_TEAM_ID || process.env.VERCEL_ORG_ID);
}

function apiUrl(path, params = {}) {
  const url = new URL(path, 'https://api.vercel.com');
  const teamId = vercelTeamId();
  if (teamId) url.searchParams.set('teamId', teamId);
  for (const [key, value] of Object.entries(params || {})) {
    const normalized = clean(value);
    if (normalized) url.searchParams.set(key, normalized);
  }
  return url.toString();
}

async function vercelFetch(path, options = {}) {
  const token = vercelToken();
  if (!token) {
    return {
      ok: false,
      skipped: true,
      status: 0,
      data: null,
      message: 'VERCEL_API_TOKEN is not configured',
    };
  }
  const response = await fetch(apiUrl(path, options.params), {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  const message = clean(data?.error?.message || data?.message || text);
  return {
    ok: response.ok,
    status: response.status,
    data,
    message,
  };
}

function alreadyOnProject(result = {}) {
  const msg = clean(result.message).toLowerCase();
  const code = clean(result.data?.error?.code).toLowerCase();
  return result.status === 400 && (
    code.includes('already')
    || msg.includes('already')
    || msg.includes('exists')
  );
}

export function vercelDomainAutomationConfigured() {
  return Boolean(vercelToken() && vercelProjectId());
}

export async function getVercelDomainConfig(domain = '') {
  const host = clean(domain).toLowerCase();
  if (!host) return { ok: false, message: 'missing domain' };
  const projectIdOrName = vercelProjectId();
  const result = await vercelFetch(`/v6/domains/${encodeURIComponent(host)}/config`, {
    params: { projectIdOrName },
  });
  if (result.skipped) return result;
  return {
    ok: result.ok,
    status: result.status,
    domain: host,
    configuredBy: result.data?.configuredBy || '',
    misconfigured: result.data?.misconfigured === true,
    acceptedChallenges: Array.isArray(result.data?.acceptedChallenges) ? result.data.acceptedChallenges : [],
    recommendedIPv4: result.data?.recommendedIPv4 || [],
    recommendedCNAME: result.data?.recommendedCNAME || [],
    raw: result.data,
    message: result.message,
  };
}

export async function removeVercelProjectDomain(domain = '') {
  const host = clean(domain).toLowerCase();
  const projectIdOrName = vercelProjectId();
  if (!host) return { ok: false, status: 'error', domain: host, message: 'missing domain' };
  if (!vercelToken() || !projectIdOrName) {
    return { ok: false, status: 'skipped', domain: host, message: 'VERCEL automation is not configured' };
  }
  const result = await vercelFetch(`/v9/projects/${encodeURIComponent(projectIdOrName)}/domains/${encodeURIComponent(host)}`, {
    method: 'DELETE',
  });
  // 404 = โดเมนไม่ได้ผูกกับโปรเจกต์ (เช่นใช้ wildcard อยู่แล้ว) ถือว่าสำเร็จ
  const notFound = result.status === 404;
  return {
    ok: result.ok || notFound,
    status: result.ok ? 'removed' : (notFound ? 'not_found' : 'error'),
    domain: host,
    message: result.message,
  };
}

export async function provisionVercelProjectDomain(domain = '') {
  const host = clean(domain).toLowerCase();
  const projectIdOrName = vercelProjectId();
  if (!host) return { ok: false, status: 'error', message: 'missing domain' };
  if (!vercelToken()) {
    return {
      ok: false,
      status: 'skipped',
      domain: host,
      verified: false,
      message: 'VERCEL_API_TOKEN is not configured',
    };
  }
  if (!projectIdOrName) {
    return {
      ok: false,
      status: 'skipped',
      domain: host,
      verified: false,
      message: 'VERCEL project id/name is not configured',
    };
  }

  const add = await vercelFetch(`/v10/projects/${encodeURIComponent(projectIdOrName)}/domains`, {
    method: 'POST',
    body: { name: host },
  });
  const addAccepted = add.ok || alreadyOnProject(add);
  const config = await getVercelDomainConfig(host).catch((err) => ({
    ok: false,
    message: err?.message || String(err),
  }));
  const configured = config.ok && config.misconfigured !== true;
  return {
    ok: addAccepted && configured,
    status: addAccepted
      ? (configured ? 'ready' : 'dns_pending')
      : 'error',
    domain: host,
    projectIdOrName,
    addStatus: add.status,
    verified: add.data?.verified === true || configured,
    misconfigured: config.misconfigured === true,
    configuredBy: config.configuredBy || '',
    acceptedChallenges: config.acceptedChallenges || [],
    message: addAccepted
      ? (configured ? 'Domain added to Vercel project and DNS is configured' : (config.message || 'Domain added to Vercel project; waiting for DNS/certificate verification'))
      : (add.message || 'Vercel domain provisioning failed'),
    raw: {
      add: add.data,
      config: config.raw,
    },
  };
}
