import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { minify } from 'terser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');

function collectTopLevelDeclarations(block = '') {
  const out = [];
  for (const line of String(block || '').split(/\r?\n/)) {
    let match = line.match(/^async function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (match) { out.push({ kind: 'async_function', name: match[1] }); continue; }
    match = line.match(/^function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (match) { out.push({ kind: 'function', name: match[1] }); continue; }
    match = line.match(/^(const|let)\s+([A-Za-z0-9_$]+)\s*=/);
    if (match) { out.push({ kind: match[1], name: match[2] }); continue; }
  }
  return out;
}

function publicAdminStubSource(block = '') {
  const declarations = collectTopLevelDeclarations(block);
  const handled = new Set([
    'adminLockedView',
    'adminGuard',
    'adminLayout',
    'clearAdminInboxPoll',
    'disconnectAdminInboxSocket',
    'disconnectAdminInboxRealtime',
    'initAdminInboxLive',
  ]);
  const lines = [
    "// admin code stripped from public bundle",
    "function adminLockedView(){",
    "  const href = typeof adminEntryHref === 'function' ? adminEntryHref('/admin') : '/secure-admin#/admin';",
    "  const isAdminUser = typeof canAccessAdminShellClient === 'function' ? canAccessAdminShellClient(currentUser) : Boolean(currentUser && currentUser.role === 'admin');",
    "  if (isAdminUser && typeof location !== 'undefined' && !String(location.pathname || '').startsWith('/secure-admin')) {",
    "    setTimeout(() => { location.href = href; }, 0);",
    "  }",
    "  return `<section class=\"section page-top\"><div class=\"container\" style=\"max-width:760px\"><div class=\"glass\" style=\"padding:28px;border-radius:28px\"><span class=\"eyebrow\">Protected Admin</span><h2>พื้นที่หลังบ้านถูกแยกออกจากเว็บหลักแล้ว</h2><p class=\"muted\">เพื่อความปลอดภัย โค้ดหลังบ้านจะถูกโหลดเฉพาะในพื้นที่แอดมินที่ได้รับสิทธิ์เท่านั้น</p>${isAdminUser ? `<a class=\"btn btn-primary\" href=\"${href}\">เปิดหลังบ้านแบบปลอดภัย</a>` : `<a class=\"btn btn-primary\" href=\"/#/login\">เข้าสู่ระบบ</a>`}</div></div></section>`;",
    "}",
    "function adminGuard(){ return false; }",
    "function adminLayout(){ return adminLockedView(); }",
    "function clearAdminInboxPoll(){}",
    "function disconnectAdminInboxSocket(){}",
    "function disconnectAdminInboxRealtime(){}",
    "function initAdminInboxLive(){}",
  ];
  for (const entry of declarations) {
    if (handled.has(entry.name)) continue;
    if (/^viewAdmin/.test(entry.name) || entry.name === 'viewAdminOrderDetail') {
      lines.push(`async function ${entry.name}(){ return adminLockedView(); }`);
      continue;
    }
    if (entry.kind === 'async_function') {
      lines.push(`async function ${entry.name}(){ return null; }`);
      continue;
    }
    if (entry.kind === 'function') {
      lines.push(`function ${entry.name}(){ return null; }`);
      continue;
    }
    if (entry.kind === 'const' || entry.kind === 'let') {
      const fallback = /OPTIONS$/i.test(entry.name) ? '[]' : (/State$/i.test(entry.name) ? '{}' : 'null');
      lines.push(`${entry.kind} ${entry.name} = ${fallback};`);
    }
  }
  return lines.join('\n');
}

function transformPublicApp(source = '') {
  const startMarker = '// ════════════════════════ Admin views ════════════════════════';
  const endMarker = '// ════════════════════════ Router ════════════════════════';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) throw new Error('admin_block_not_found');
  const adminBlock = source.slice(start, end);
  let next = `${source.slice(0, start)}${publicAdminStubSource(adminBlock)}\n\n${source.slice(end)}`;
  next = next.replace(/\/api\/admin/g, '/__admin_disabled__');
  next = next.replace(/\/admin\/(products|articles|inbox|orders|users|coupons|site|settings)/g, '/__admin_disabled__/$1');
  return next;
}

async function buildTask(task) {
  let source = await fs.readFile(task.src, 'utf8');
  if (typeof task.transform === 'function') source = task.transform(source);
  const result = await minify(source, {
    module: task.module,
    compress: {
      passes: 2,
      drop_console: true,
      drop_debugger: true,
      pure_getters: true,
    },
    mangle: true,
    format: {
      comments: false,
      ascii_only: true,
    },
  });
  if (!result.code) throw new Error(`build_failed:${path.basename(task.src)}`);
  const banner = '/* generated file: edit client-src sources, not public output */\n';
  await fs.mkdir(path.dirname(task.dest), { recursive: true });
  await fs.writeFile(task.dest, banner + result.code + '\n', 'utf8');
}

const tasks = [
  {
    src: path.join(projectRoot, 'client-src', 'app.js'),
    dest: path.join(projectRoot, 'public', 'app.js'),
    module: false,
    transform: transformPublicApp,
  },
  {
    src: path.join(projectRoot, 'client-src', 'app.js'),
    dest: path.join(projectRoot, 'private-build', 'admin-app.js'),
    module: false,
  },
  {
    src: path.join(projectRoot, 'client-src', 'bg3d.js'),
    dest: path.join(projectRoot, 'public', 'bg3d.js'),
    module: true,
  },
];

await Promise.all(tasks.map(buildTask));
console.log(`built ${tasks.length} client assets`);
