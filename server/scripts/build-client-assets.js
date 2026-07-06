import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { minify } from 'terser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');
const routerMarker = '// ════════════════════════ Router ════════════════════════';

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
    'ROUTE_CHUNK_ASSETS',
    'routeChunkTasks',
    'routeChunkAsset',
    'routeChunkExport',
    'ensureRouteChunkLoaded',
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

function findMatchingToken(source = '', startIndex = -1, openChar = '{', closeChar = '}') {
  let depth = 0;
  let state = 'code';
  const templateStack = [];
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (state === 'line_comment') {
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block_comment') {
      if (ch === '*' && next === '/') { state = 'code'; i++; }
      continue;
    }
    if (state === 'single_quote') {
      if (ch === '\\') { i++; continue; }
      if (ch === "'") state = 'code';
      continue;
    }
    if (state === 'double_quote') {
      if (ch === '\\') { i++; continue; }
      if (ch === '"') state = 'code';
      continue;
    }
    if (state === 'template') {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { state = 'code'; continue; }
      if (ch === '$' && next === '{') {
        templateStack.push(depth);
        state = 'code';
        depth += 1;
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '/') { state = 'line_comment'; i++; continue; }
    if (ch === '/' && next === '*') { state = 'block_comment'; i++; continue; }
    if (ch === "'") { state = 'single_quote'; continue; }
    if (ch === '"') { state = 'double_quote'; continue; }
    if (ch === '`') { state = 'template'; continue; }
    if (ch === openChar) {
      depth += 1;
      continue;
    }
    if (ch === closeChar) {
      depth -= 1;
      if (templateStack.length && templateStack[templateStack.length - 1] === depth) {
        templateStack.pop();
        state = 'template';
      }
      if (depth === 0) return i;
    }
  }
  throw new Error(`token_match_failed:${startIndex}:${openChar}${closeChar}`);
}

function findFunctionDeclaration(source = '', name = '') {
  const patterns = [`async function ${name}(`, `function ${name}(`];
  for (const token of patterns) {
    const start = source.indexOf(token);
    if (start === -1) continue;
    const paramsStart = source.indexOf('(', start);
    if (paramsStart === -1) throw new Error(`function_params_missing:${name}`);
    const paramsEnd = findMatchingToken(source, paramsStart, '(', ')');
    let braceStart = paramsEnd + 1;
    while (braceStart < source.length && /\s/.test(source[braceStart])) braceStart += 1;
    if (source[braceStart] !== '{') throw new Error(`function_brace_missing:${name}`);
    const braceEnd = findMatchingToken(source, braceStart, '{', '}');
    let end = braceEnd + 1;
    while (end < source.length && /\s/.test(source[end])) end += 1;
    return {
      name,
      isAsync: token.startsWith('async '),
      start,
      end,
      code: source.slice(start, end).trim(),
    };
  }
  throw new Error(`function_not_found:${name}`);
}

function stripFunctionDeclarations(source = '', names = []) {
  const matches = names.map((name) => findFunctionDeclaration(source, name));
  const ordered = [...matches].sort((a, b) => a.start - b.start);
  let next = source;
  [...matches].sort((a, b) => b.start - a.start).forEach((entry) => {
    next = next.slice(0, entry.start) + next.slice(entry.end);
  });
  return { source: next, functions: ordered };
}

function routeChunkSource(chunkName = '', functions = []) {
  const exportsMap = functions.map((entry) => `    ${JSON.stringify(entry.name)}: ${entry.name}`).join(',\n');
  const body = functions.map((entry) => entry.code).join('\n\n');
  return `(function(global){\n${body}\n\nglobal.__NFLRouteExports=global.__NFLRouteExports||{};\nglobal.__NFLRouteExports[${JSON.stringify(chunkName)}]=Object.assign(global.__NFLRouteExports[${JSON.stringify(chunkName)}]||{}, {\n${exportsMap}\n});\nif(global.__NFLRouteChunksLoaded&&typeof global.__NFLRouteChunksLoaded.add==='function')global.__NFLRouteChunksLoaded.add(${JSON.stringify(chunkName)});\n})(window);`;
}

function routeChunkStubSource(chunkName = '', functions = []) {
  return functions.map((entry) => {
    const signature = entry.isAsync || /^view/i.test(entry.name) ? 'async function' : 'function';
    if (signature === 'async function') {
      return `${signature} ${entry.name}(...args){const loaded=routeChunkExport(${JSON.stringify(chunkName)},${JSON.stringify(entry.name)});if(typeof loaded==='function')return loaded.apply(this,args);await ensureRouteChunkLoaded(${JSON.stringify(chunkName)});const impl=routeChunkExport(${JSON.stringify(chunkName)},${JSON.stringify(entry.name)});if(typeof impl==='function')return impl.apply(this,args);throw new Error(${JSON.stringify(`route_chunk_missing:${chunkName}:${entry.name}`)});}`;
    }
    return `${signature} ${entry.name}(...args){const loaded=routeChunkExport(${JSON.stringify(chunkName)},${JSON.stringify(entry.name)});if(typeof loaded==='function')return loaded.apply(this,args);ensureRouteChunkLoaded(${JSON.stringify(chunkName)}).then(()=>{const impl=routeChunkExport(${JSON.stringify(chunkName)},${JSON.stringify(entry.name)});if(typeof impl==='function')impl.apply(this,args);}).catch(()=>{});return null;}`;
  }).join('\n\n');
}

function routeChunkRuntimeSource() {
  return `const ROUTE_CHUNK_ASSETS = {
  calc: '/route-calc.js',
  community: '/route-community.js',
  account: '/route-account.js',
  admin: '/api/admin/client/route-admin.js',
};
const routeChunkTasks = new Map();
window.__NFLRouteExports = window.__NFLRouteExports || {};
window.__NFLRouteChunksLoaded = window.__NFLRouteChunksLoaded || new Set();
function routeChunkAsset(name = '') {
  return ROUTE_CHUNK_ASSETS[String(name || '').trim()] || '';
}
function routeChunkExport(chunkName = '', exportName = '') {
  return window.__NFLRouteExports?.[String(chunkName || '').trim()]?.[String(exportName || '').trim()] || null;
}
function ensureRouteChunkLoaded(name = '') {
  const chunkName = String(name || '').trim();
  if (!chunkName) return Promise.resolve(null);
  if (window.__NFLRouteChunksLoaded.has(chunkName)) return Promise.resolve(window.__NFLRouteExports?.[chunkName] || null);
  if (routeChunkTasks.has(chunkName)) return routeChunkTasks.get(chunkName);
  const src = routeChunkAsset(chunkName);
  if (!src) return Promise.reject(new Error(\`route_chunk_unknown:\${chunkName}\`));
  const task = new Promise((resolve, reject) => {
    const fullSrc = new URL(src, window.location.origin).href;
    const existing = [...document.querySelectorAll('script[data-route-chunk]')].find((el) => el.src === fullSrc || el.dataset.routeChunk === chunkName);
    if (existing?.dataset.loaded === '1') {
      window.__NFLRouteChunksLoaded.add(chunkName);
      resolve(window.__NFLRouteExports?.[chunkName] || null);
      return;
    }
    const script = existing || document.createElement('script');
    script.async = true;
    script.src = src;
    script.dataset.routeChunk = chunkName;
    const done = () => {
      script.dataset.loaded = '1';
      window.__NFLRouteChunksLoaded.add(chunkName);
      resolve(window.__NFLRouteExports?.[chunkName] || null);
    };
    const fail = () => {
      routeChunkTasks.delete(chunkName);
      reject(new Error(\`route_chunk_load_failed:\${chunkName}\`));
    };
    script.addEventListener('load', done, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (!existing) document.head.appendChild(script);
  }).finally(() => {
    if (window.__NFLRouteChunksLoaded.has(chunkName)) routeChunkTasks.delete(chunkName);
  });
  routeChunkTasks.set(chunkName, task);
  return task;
}`;
}

function injectBeforeRouter(source = '', code = '') {
  const index = source.indexOf(routerMarker);
  if (index === -1) throw new Error('router_marker_not_found');
  return `${source.slice(0, index)}${String(code || '').trim()}\n\n${source.slice(index)}`;
}

function transformPublicApp(source = '') {
  const publicChunks = [
    { name: 'calc', functions: ['viewCalc', 'updateCalcPage'] },
    { name: 'community', functions: ['viewCommunity', 'viewArticles', 'viewArticle'] },
    { name: 'account', functions: ['viewAccount'] },
  ];
  let next = source;
  const chunkTasks = [];
  const stubParts = [];
  for (const spec of publicChunks) {
    const extracted = stripFunctionDeclarations(next, spec.functions);
    next = extracted.source;
    chunkTasks.push({
      code: routeChunkSource(spec.name, extracted.functions),
      dest: path.join(projectRoot, 'public', `route-${spec.name}.js`),
      module: false,
    });
    stubParts.push(routeChunkStubSource(spec.name, extracted.functions));
  }
  const startMarker = '// ════════════════════════ Admin views ════════════════════════';
  const endMarker = routerMarker;
  const start = next.indexOf(startMarker);
  const end = next.indexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) throw new Error('admin_block_not_found');
  const adminBlock = next.slice(start, end);
  next = `${next.slice(0, start)}${publicAdminStubSource(adminBlock)}\n\n${next.slice(end)}`;
  next = injectBeforeRouter(next, `${routeChunkRuntimeSource()}\n\n${stubParts.join('\n\n')}`);
  next = next.replace(/\/api\/admin/g, '/__admin_disabled__');
  next = next.replace(/\/admin\/(products|community|articles|inbox|orders|users|coupons|site|settings)/g, '/__admin_disabled__/$1');
  return { code: next, extraTasks: chunkTasks };
}

function transformAdminApp(source = '') {
  const adminFunctions = [
    'viewAdminDash',
    'viewAdminCustomers',
    'viewAdminProducts',
    'viewAdminArticles',
    'viewAdminCommunity',
    'viewAdminLeads',
    'viewAdminOrders',
    'viewAdminInbox',
    'viewAdminUsers',
    'viewAdminCoupons',
    'viewAdminSettings',
    'viewAdminStores',
    'viewAdminDiagnostics',
    'viewAdminSite',
    'viewAdminOrderDetail',
  ];
  const extracted = stripFunctionDeclarations(source, adminFunctions);
  const next = injectBeforeRouter(extracted.source, routeChunkStubSource('admin', extracted.functions));
  return {
    code: next,
    extraTasks: [{
      code: routeChunkSource('admin', extracted.functions),
      dest: path.join(projectRoot, 'private-build', 'admin-route.js'),
      module: false,
    }],
  };
}

async function buildTask(task) {
  let source = typeof task.code === 'string' ? task.code : await fs.readFile(task.src, 'utf8');
  if (typeof task.transform === 'function') {
    const transformed = task.transform(source);
    source = typeof transformed === 'string' ? transformed : transformed.code;
  }
  let result;
  try {
    result = await minify(source, {
      module: task.module,
      compress: {
        passes: 3,
        drop_console: true,
        drop_debugger: true,
        pure_getters: true,
        dead_code: true,
        unused: true,
        booleans_as_integers: true,
      },
      mangle: {
        safari10: true,
      },
      format: {
        comments: false,
        ascii_only: true,
      },
      sourceMap: false,
    });
  } catch (error) {
    const debugFile = path.join(projectRoot, 'tmp', `${path.basename(Array.isArray(task.dest) ? task.dest[0] : (task.dest || task.src || 'inline'))}.debug.js`);
    await fs.mkdir(path.dirname(debugFile), { recursive: true });
    await fs.writeFile(debugFile, source, 'utf8');
    throw error;
  }
  if (!result.code) throw new Error(`build_failed:${path.basename(task.dest || task.src || 'inline')}`);
  const banner = '/* generated file: edit client-src sources, not public output */\n';
  const destinations = Array.isArray(task.dest) ? task.dest : [task.dest];
  for (const dest of destinations) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, banner + result.code + '\n', 'utf8');
  }
}

async function minifyVendor(src, dest, { module = false } = {}) {
  const source = await fs.readFile(src, 'utf8');
  const result = await minify(source, {
    module,
    compress: {
      passes: 2,
      drop_debugger: true,
      pure_getters: true,
    },
    mangle: {
      safari10: true,
    },
    format: {
      comments: false,
      ascii_only: true,
    },
    sourceMap: false,
  });
  if (!result.code) throw new Error(`vendor_build_failed:${path.basename(src)}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, result.code + '\n', 'utf8');
}

async function copyAsset(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

const appSource = await fs.readFile(path.join(projectRoot, 'client-src', 'app.js'), 'utf8');
const publicApp = transformPublicApp(appSource);
const adminApp = transformAdminApp(appSource);

const tasks = [
  {
    code: publicApp.code,
    dest: [
      path.join(projectRoot, 'public', 'app.js'),
      path.join(projectRoot, 'public', 'assets', 'runtime', 'a.js'),
    ],
    module: false,
  },
  {
    code: adminApp.code,
    dest: path.join(projectRoot, 'private-build', 'admin-app.js'),
    module: false,
  },
  {
    src: path.join(projectRoot, 'client-src', 'modules', 'core.js'),
    dest: [
      path.join(projectRoot, 'public', 'client-core.js'),
      path.join(projectRoot, 'public', 'assets', 'runtime', 'c.js'),
    ],
    module: false,
  },
  {
    src: path.join(projectRoot, 'client-src', 'modules', 'marketing.js'),
    dest: path.join(projectRoot, 'public', 'marketing-module.js'),
    module: false,
  },
  {
    src: path.join(projectRoot, 'client-src', 'bg3d.js'),
    dest: [
      path.join(projectRoot, 'public', 'bg3d.js'),
      path.join(projectRoot, 'public', 'assets', 'runtime', 'b.js'),
    ],
    module: true,
  },
  ...publicApp.extraTasks,
  ...adminApp.extraTasks,
];

await Promise.all(tasks.map(buildTask));
await Promise.all([
  copyAsset(path.join(projectRoot, 'public', 'styles.css'), path.join(projectRoot, 'public', 'assets', 'runtime', 's.css')),
  minifyVendor(
    path.join(projectRoot, 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js'),
    path.join(projectRoot, 'public', 'assets', 'runtime', 'v1.js'),
  ),
  minifyVendor(
    path.join(projectRoot, 'node_modules', 'three', 'build', 'three.module.js'),
    path.join(projectRoot, 'public', 'assets', 'runtime', 'v2.js'),
    { module: true },
  ),
]);

async function contentHash(file) {
  const buf = await fs.readFile(file);
  return crypto.createHash('md5').update(buf).digest('hex').slice(0, 10);
}

async function stampAssetVersions(htmlFile, hashByAsset) {
  let html = await fs.readFile(htmlFile, 'utf8');
  for (const [assetPath, hash] of Object.entries(hashByAsset)) {
    const escaped = assetPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp(`(${escaped})(\\?v=[A-Za-z0-9._-]+)?`, 'g'), `$1?v=${hash}`);
  }
  await fs.writeFile(htmlFile, html, 'utf8');
}

const [stylesHash, appHash, clientCoreHash, bg3dHash, supabaseHash, threeHash, adminAppHash] = await Promise.all([
  contentHash(path.join(projectRoot, 'public', 'assets', 'runtime', 's.css')),
  contentHash(path.join(projectRoot, 'public', 'assets', 'runtime', 'a.js')),
  contentHash(path.join(projectRoot, 'public', 'assets', 'runtime', 'c.js')),
  contentHash(path.join(projectRoot, 'public', 'assets', 'runtime', 'b.js')),
  contentHash(path.join(projectRoot, 'public', 'assets', 'runtime', 'v1.js')),
  contentHash(path.join(projectRoot, 'public', 'assets', 'runtime', 'v2.js')),
  contentHash(path.join(projectRoot, 'private-build', 'admin-app.js')),
]);
const shellDest = path.join(projectRoot, 'private-build', 'shell.html');
await fs.copyFile(path.join(projectRoot, 'client-src', 'index.html'), shellDest);
await stampAssetVersions(shellDest, {
  '/assets/runtime/s.css': stylesHash,
  '/assets/runtime/c.js': clientCoreHash,
  '/assets/runtime/a.js': appHash,
  '/assets/runtime/b.js': bg3dHash,
  '/assets/runtime/v1.js': supabaseHash,
  '/assets/runtime/v2.js': threeHash,
  '/styles.css': stylesHash,
  '/client-core.js': clientCoreHash,
  '/app.js': appHash,
  '/bg3d.js': bg3dHash,
});
await fs.rm(path.join(projectRoot, 'public', 'index.html'), { force: true });
await stampAssetVersions(path.join(projectRoot, 'private-build', 'admin.html'), {
  '/assets/runtime/s.css': stylesHash,
  '/assets/runtime/c.js': clientCoreHash,
  '/assets/runtime/b.js': bg3dHash,
  '/assets/runtime/v1.js': supabaseHash,
  '/assets/runtime/v2.js': threeHash,
  '/styles.css': stylesHash,
  '/client-core.js': clientCoreHash,
  '/api/admin/client/app.js': adminAppHash,
  '/bg3d.js': bg3dHash,
});
console.log(`built ${tasks.length} client assets (styles=${stylesHash} core=${clientCoreHash} app=${appHash} bg3d=${bg3dHash} sb=${supabaseHash} three=${threeHash} admin=${adminAppHash})`);
