import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  createProduct,
  listProducts,
  getProduct,
  deleteProduct,
  createCoupon,
  listCoupons,
  deleteCoupon,
  addReview,
  listReviews,
  allReviewStats,
  createArticle,
  listArticles,
  deleteArticle,
  createCommunityPost,
  getCommunityPost,
  listCommunityPosts,
  createCommunityComment,
  listCommunityComments,
  setCommunityReaction,
  setCommunitySave,
  deleteCommunityPost,
} from '../db-sqlite.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..', '..');
const serverIndex = fs.readFileSync(path.join(rootDir, 'server', 'index.js'), 'utf8');
const clientApp = fs.readFileSync(path.join(rootDir, 'client-src', 'app.js'), 'utf8');
const buildClientAssets = fs.readFileSync(path.join(rootDir, 'server', 'scripts', 'build-client-assets.js'), 'utf8');
const generatedAdminApp = fs.readFileSync(path.join(rootDir, 'private-build', 'admin-app.js'), 'utf8');
const generatedAdminHtml = fs.readFileSync(path.join(rootDir, 'private-build', 'admin.html'), 'utf8');

function assert(condition, message, payload) {
  if (!condition) {
    const error = new Error(message);
    error.payload = payload;
    throw error;
  }
}

function expectSource(pattern, message) {
  assert(pattern.test(serverIndex), message, { pattern: String(pattern) });
}

function expectClientSource(pattern, message) {
  assert(pattern.test(clientApp), message, { pattern: String(pattern) });
}

function expectBuildSource(pattern, message) {
  assert(pattern.test(buildClientAssets), message, { pattern: String(pattern) });
}

function expectGeneratedAdminApp(pattern, message) {
  assert(pattern.test(generatedAdminApp), message, { pattern: String(pattern) });
}

function expectGeneratedAdminHtml(pattern, message) {
  assert(pattern.test(generatedAdminHtml), message, { pattern: String(pattern) });
}

async function ignoreCleanup(fn) {
  try { await fn(); } catch {}
}

async function staticAudit() {
  expectSource(/function requestIsSecure\(req = \{\}\)/, 'request secure helper missing');
  expectSource(/"frame-src 'none'"/, 'csp does not block frames');
  expectSource(/"form-action 'self'"/, 'csp does not restrict form submission');
  expectSource(/const BLOCKED_LEGACY_ADMIN_CLIENT_RE = .*route-admin/, 'legacy admin client paths are not blocked');
  expectSource(/function logBlockedSurfaceProbe\(req,\s*category = 'blocked_surface'\)/, 'blocked surface probe logging missing');
  expectClientSource(/document\.addEventListener\('contextmenu',\s*\(event\)\s*=>\s*\{[\s\S]*?event\.preventDefault\(\);/, 'context menu blocker is missing');
  expectClientSource(/function blockedInspectionShortcut\(event\)/, 'inspection shortcut blocker helper is missing');
  expectClientSource(/document\.body\.classList\.toggle\('devtools-guard-active',\s*next\)/, 'devtools guard body toggle is missing');
  expectSource(/const OPAQUE_ADMIN_CLIENT_PATHS = Object\.freeze\(\{\s*app: '\/api\/admin\/client\/a\.js',\s*route: '\/api\/admin\/client\/b\.js',?\s*\}\);/, 'admin client paths are not opaque');
  expectBuildSource(/routeChunkStubSource\('r4',\s*extracted\.functions\)/, 'admin route chunk stub is not mapped to r4');
  expectSource(/const BLOCKED_LEGACY_ASSET_PATH_RE = [\s\S]*route-\(\?:calc\|community\|account\)\\\.js/, 'legacy public route assets are not blocked');
  expectClientSource(/loadRuntimeScriptOnce\('\/m1\.js'\)/, 'marketing runtime path is not opaque');
  expectClientSource(/const ROUTE_CHUNK_ASSETS = \{\s*r1: '\/x1\.js',\s*r2: '\/x2\.js',\s*r3: '\/x3\.js',\s*r4: '\/api\/admin\/client\/b\.js',\s*\};/, 'route chunk assets are not using opaque paths');
  expectGeneratedAdminApp(/ROUTE_CHUNK_ASSETS=\{r1:"\/x1\.js",r2:"\/x2\.js",r3:"\/x3\.js",r4:"\/api\/admin\/client\/b\.js"\}/, 'generated admin app route chunk map drifted from opaque r4 mapping');
  expectGeneratedAdminApp(/ensureRouteChunkLoaded\("r4"\)|ensureRouteChunkLoaded\('r4'\)/, 'generated admin app does not lazy-load admin route chunk via r4');
  assert(!/\/api\/admin\/client\/route-admin\.js/.test(generatedAdminApp), 'generated admin app still references legacy route-admin.js');
  expectGeneratedAdminHtml(/<script src="\/api\/admin\/client\/a\.js\?v=[A-Za-z0-9._-]+"><\/script>/, 'generated admin html does not load opaque admin bootstrap chunk');
  assert(!/\/api\/admin\/client\/route-admin\.js/.test(generatedAdminHtml), 'generated admin html still references legacy route-admin.js');
  expectClientSource(/function renderAdminStoreSwitcher\(\)\s*\{[\s\S]*?if \(!canAccessMultistoreConsoleClient\(\)\) return '';/, 'admin store switcher is not hidden for sub-store admin');
  expectClientSource(/fullAdminTabs\.filter\(\(\[key\]\) => canAccessMultistoreConsoleClient\(\) \|\| !\['stores', 'users'\]\.includes\(key\)\)/, 'full admin navigation does not hide stores/users when multistore console is disabled');
  expectClientSource(/viewAdminUsers\(\)[\s\S]*?if \(!canAccessMultistoreConsoleClient\(\)\) \{[\s\S]*?go\('\/admin\/site'\)[\s\S]*?return loadingView\(\);[\s\S]*?\}/, 'admin users page is not redirecting sub-store away');
  expectClientSource(/viewAdminStores\(\)[\s\S]*?if \(!canAccessMultistoreConsoleClient\(\)\) \{[\s\S]*?go\('\/admin\/site'\)[\s\S]*?return loadingView\(\);[\s\S]*?\}/, 'admin stores page is not redirecting sub-store away');
  expectSource(/function multistoreConsoleEnabledForStore\(store = null\) \{\s*return !store \|\| store\.isDefault === true;\s*\}/, 'server multistore console gate no longer restricts to default store');
  expectSource(/app\.get\('\/api\/admin\/users',\s*requireAdmin,\s*requireMultistoreConsole,/, 'admin users endpoint is not protected by multistore console');
  expectSource(/app\.get\('\/api\/admin\/stores\/check-subdomain',\s*requireAdmin,\s*requireMultistoreConsole,/, 'store creation helper endpoint is not protected by multistore console');
  expectSource(/function normalizedUserBoundStoreId\(user = null\)/, 'user bound-store helper is missing');
  expectSource(/app\.post\('\/api\/auth\/register'[\s\S]*?const boundStoreId = await getRequestStoreId\(req\);[\s\S]*?bound_store_id:\s*boundStoreId/, 'register flow does not bind new accounts to the current store');
  expectSource(/app\.post\('\/api\/auth\/login'[\s\S]*?requestMatchesUserBoundStore\(req,\s*user\)/, 'login flow does not enforce host-based store binding');
  expectSource(/app\.post\('\/api\/admin\/stores',[\s\S]*?adminEmail[\s\S]*?adminPassword[\s\S]*?bound_store_id:\s*store\.id/, 'store creation does not force tenant admin credentials or bind admin account to the store');
  expectSource(/app\.post\('\/api\/admin\/stores\/:id\/roles'[\s\S]*?boundStoreId && boundStoreId !== String\(store\.id \|\| ''\)\.trim\(\)/, 'store role assignment does not block tenant-bound accounts from crossing stores');
  expectSource(/app\.put\('\/api\/admin\/users\/:id'[\s\S]*?normalizedUserBoundStoreId\(target\) && newRole !== ROLE_USER/, 'bound accounts can still be elevated to global roles');
  expectClientSource(/name="adminEmail"[\s\S]*name="adminPassword"/, 'store creation UI does not require tenant admin credentials');
  expectSource(/app\.get\('\/api\/admin\/products',\s*requireStoreScopedAccess\('staff'\)/, 'admin products list is not store-role guarded');
  expectSource(/app\.post\('\/api\/admin\/products',\s*requireStoreScopedAccess\('staff'\)/, 'admin products create is not store-role guarded');
  expectSource(/app\.get\('\/api\/admin\/orders',\s*requireStoreScopedAccess\('staff'\)/, 'admin orders list is not store-role guarded');
  expectSource(/app\.get\('\/api\/admin\/inbox',\s*requireStoreScopedAccess\('chat_admin'\)/, 'admin inbox list is not chat-role guarded');
  expectSource(/app\.get\('\/api\/admin\/coupons',\s*requireStoreScopedAccess\('staff'\)/, 'admin coupons list is not store-role guarded');
  expectSource(/app\.get\('\/api\/admin\/articles',\s*requireStoreScopedAccess\('staff'\)/, 'admin articles list is not store-role guarded');
  expectSource(/app\.get\('\/api\/admin\/community',\s*requireStoreScopedAccess\('staff'\)/, 'admin community list is not store-role guarded');
  expectSource(/createCommunityComment\(req\.params\.id,\s*\{\s*storeId:\s*store\?\.id/, 'community comments do not pass request storeId');
  expectSource(/setCommunityReaction\(req\.params\.id,\s*req\.user\.id,\s*'like',\s*active,\s*\{\s*storeId:\s*store\?\.id/, 'community reactions do not pass request storeId');
  expectSource(/setCommunitySave\(req\.params\.id,\s*req\.user\.id,\s*active,\s*\{\s*storeId:\s*store\?\.id/, 'community saves do not pass request storeId');
  expectSource(/listOrdersByUser\(req\.user\.id,\s*50,\s*\{\s*storeId:\s*store\?\.id\s*\}\)/, 'my orders list is not store-scoped');
}

async function sqliteAdapterAudit() {
  const stamp = Date.now().toString(36);
  const storeA = `store_iso_a_${stamp}`;
  const storeB = `store_iso_b_${stamp}`;
  const productA = `iso_product_a_${stamp}`;
  const productB = `iso_product_b_${stamp}`;
  const couponA = `ISOA${stamp}`.toUpperCase().slice(0, 18);
  const articleA = `iso_article_a_${stamp}`;
  const postA = `iso_post_a_${stamp}`;
  const userId = `iso_user_${stamp}`;

  try {
    await createProduct({ storeId: storeA, id: productA, name: 'Isolation Product A', price: 10, stock: 3, active: true });
    await createProduct({ storeId: storeB, id: productB, name: 'Isolation Product B', price: 20, stock: 3, active: true });

    assert((await listProducts(true, { storeId: storeA })).some((item) => item.id === productA), 'store A product missing');
    assert(!(await listProducts(true, { storeId: storeA })).some((item) => item.id === productB), 'store B product leaked into store A');
    assert(!(await getProduct(productA, { storeId: storeB })), 'getProduct leaked cross-store detail');

    await addReview(productA, userId, 'Isolation Reviewer', 5, 'Scoped review', { storeId: storeA });
    assert((await listReviews(productA, { storeId: storeA })).length === 1, 'store A review missing');
    assert((await listReviews(productA, { storeId: storeB })).length === 0, 'review leaked across stores');
    assert(!Object.prototype.hasOwnProperty.call(await allReviewStats({ storeId: storeB }), productA), 'review stats leaked across stores');

    await createCoupon({ storeId: storeA, code: couponA, type: 'fixed', value: 1, active: true });
    assert((await listCoupons({ storeId: storeA })).some((item) => item.code === couponA), 'store A coupon missing');
    assert(!(await listCoupons({ storeId: storeB })).some((item) => item.code === couponA), 'coupon leaked across stores');

    await createArticle({ storeId: storeA, id: articleA, title: 'Isolation Article', body: 'Scoped body', published: true });
    assert((await listArticles(true, { storeId: storeA })).some((item) => item.id === articleA), 'store A article missing');
    assert(!(await listArticles(true, { storeId: storeB })).some((item) => item.id === articleA), 'article leaked across stores');

    await createCommunityPost({ storeId: storeA, id: postA, userId, authorName: 'Isolation', caption: 'Scoped post', status: 'approved' });
    assert(await getCommunityPost(postA, { storeId: storeA }), 'store A community post missing');
    assert(!(await getCommunityPost(postA, { storeId: storeB })), 'community post leaked across stores');
    assert(!(await createCommunityComment(postA, { storeId: storeB, userId, authorName: 'Bad', text: 'Leak' })), 'cross-store comment was accepted');
    await createCommunityComment(postA, { storeId: storeA, userId, authorName: 'Good', text: 'Scoped comment' });
    assert((await listCommunityComments(postA, { storeId: storeA })).length === 1, 'store A comment missing');
    assert((await listCommunityComments(postA, { storeId: storeB })).length === 0, 'comment leaked across stores');
    assert(!(await setCommunityReaction(postA, userId, 'like', true, { storeId: storeB })), 'cross-store reaction was accepted');
    assert((await setCommunityReaction(postA, userId, 'like', true, { storeId: storeA }))?.liked === true, 'store A reaction missing');
    assert(!(await setCommunitySave(postA, userId, true, { storeId: storeB })), 'cross-store save was accepted');
    assert((await setCommunitySave(postA, userId, true, { storeId: storeA }))?.saved === true, 'store A save missing');
    assert((await listCommunityPosts({ storeId: storeB, all: true, limit: 100 })).every((item) => item.id !== postA), 'community list leaked across stores');
  } finally {
    await ignoreCleanup(() => deleteCommunityPost(postA, { storeId: storeA }));
    await ignoreCleanup(() => deleteArticle(articleA, { storeId: storeA }));
    await ignoreCleanup(() => deleteCoupon(couponA, { storeId: storeA }));
    await ignoreCleanup(() => deleteProduct(productA, { storeId: storeA }));
    await ignoreCleanup(() => deleteProduct(productB, { storeId: storeB }));
  }

  return { storeA, storeB };
}

async function main() {
  await staticAudit();
  const adapter = await sqliteAdapterAudit();
  console.log(JSON.stringify({ ok: true, staticAudit: true, sqliteAdapterAudit: true, ...adapter }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    payload: error?.payload || null,
  }, null, 2));
  process.exit(1);
});
