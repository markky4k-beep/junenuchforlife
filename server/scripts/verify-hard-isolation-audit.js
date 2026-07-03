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

async function ignoreCleanup(fn) {
  try { await fn(); } catch {}
}

async function staticAudit() {
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
