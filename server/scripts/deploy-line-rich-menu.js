import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..', '..');
const richMenuDir = path.join(rootDir, 'docs', 'line-rich-menu');

const token = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
if (!token) {
  throw new Error('LINE_CHANNEL_ACCESS_TOKEN is missing');
}

const defaultHeaders = {
  Authorization: `Bearer ${token}`,
};

async function lineApi(pathname, options = {}) {
  const baseUrl = String(options.baseUrl || 'https://api.line.me');
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: options.method || 'GET',
    headers: {
      ...defaultHeaders,
      ...(options.headers || {}),
    },
    body: options.body,
  });
  const text = await response.text().catch(() => '');
  if (!response.ok) {
    throw new Error(`${pathname} failed: ${response.status} ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : {};
}

async function createRichMenu(jsonFileName) {
  const body = fs.readFileSync(path.join(richMenuDir, jsonFileName), 'utf8');
  const result = await lineApi('/v2/bot/richmenu', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
  });
  return result.richMenuId;
}

async function uploadRichMenuImage(richMenuId, imageFileName) {
  const buffer = fs.readFileSync(path.join(richMenuDir, imageFileName));
  await lineApi(`/v2/bot/richmenu/${richMenuId}/content`, {
    method: 'POST',
    baseUrl: 'https://api-data.line.me',
    headers: {
      'Content-Type': 'image/png',
    },
    body: buffer,
  });
}

async function listAliases() {
  const result = await lineApi('/v2/bot/richmenu/alias/list', { method: 'GET' });
  return Array.isArray(result.aliases) ? result.aliases : [];
}

async function deleteAlias(aliasId) {
  await lineApi(`/v2/bot/richmenu/alias/${encodeURIComponent(aliasId)}`, { method: 'DELETE' });
}

async function createAlias(aliasId, richMenuId) {
  await lineApi('/v2/bot/richmenu/alias', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
}

async function setDefaultRichMenu(richMenuId) {
  await lineApi(`/v2/bot/user/all/richmenu/${richMenuId}`, { method: 'POST' });
}

async function main() {
  const created = [];
  const homeId = await createRichMenu('customer-home-richmenu.json');
  created.push(homeId);
  await uploadRichMenuImage(homeId, 'customer-home-richmenu.png');

  const catalogId = await createRichMenu('customer-catalog-richmenu.json');
  created.push(catalogId);
  await uploadRichMenuImage(catalogId, 'customer-catalog-richmenu.png');

  const aliases = await listAliases();
  for (const aliasId of ['line-home', 'line-catalog']) {
    if (aliases.find((item) => item.richMenuAliasId === aliasId)) {
      await deleteAlias(aliasId);
    }
  }

  await createAlias('line-home', homeId);
  await createAlias('line-catalog', catalogId);
  await setDefaultRichMenu(homeId);

  const output = {
    ok: true,
    defaultRichMenuId: homeId,
    catalogRichMenuId: catalogId,
    aliases: {
      'line-home': homeId,
      'line-catalog': catalogId,
    },
    created,
  };

  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
