const provider = String(process.env.COMMUNITY_SMOKE_PROVIDER || 'sqlite').toLowerCase();

const {
  createArticle,
  deleteArticle,
  seedCommunityFromArticles,
  listCommunityPosts,
  getCommunityPost,
  deleteCommunityPost,
  createCommunityComment,
  listCommunityComments,
  setCommunityReaction,
  setCommunitySave,
  createCommunityStory,
  listCommunityStories,
  deleteCommunityStory,
} = provider === 'supabase' ? await import('../db-supabase.js') : await import('../db-sqlite.js');

const storeId = process.env.STORE_ID || 'store_main';
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const articleId = `community_smoke_${suffix}`;
const postId = `post_${storeId}_${articleId}`;
const storyId = `story_${storeId}_${articleId}`;
const expiredStoryId = `story_expired_${suffix}`;
const userId = `smoke_user_${suffix}`;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function cleanup() {
  await Promise.allSettled([
    deleteCommunityStory(storyId, { storeId }),
    deleteCommunityStory(expiredStoryId, { storeId }),
    deleteCommunityPost(postId, { storeId }),
    deleteArticle(articleId, { storeId }),
  ]);
}

try {
  await cleanup();
  await createArticle({
    storeId,
    id: articleId,
    title: 'Community Smoke Test',
    cover: '/assets/community-smoke-cover.jpg',
    excerpt: 'Seed this article into a community post and 24-hour story.',
    body: 'Smoke test body',
    published: true,
  });

  const seed = await seedCommunityFromArticles({ storeId, all: true });
  assert(seed.totalArticles >= 1, 'seed did not see any articles');

  const post = await getCommunityPost(postId, { storeId, viewerId: userId });
  assert(post?.id === postId, 'seeded community post was not created');
  assert(post.articleId === articleId, 'seeded post is not linked to source article');

  const activeStories = await listCommunityStories({ storeId, limit: 100 });
  assert(activeStories.some((story) => story.id === storyId), 'seeded 24-hour story is not active');
  const seededStory = activeStories.find((story) => story.id === storyId);
  assert(Number(seededStory.expiresAt || 0) > Date.now(), 'seeded story does not expire in the future');

  await createCommunityStory({
    storeId,
    id: expiredStoryId,
    title: 'Expired Smoke Story',
    media: '/assets/community-smoke-expired.jpg',
    expiresAt: Date.now() - 1000,
  });
  const visibleStories = await listCommunityStories({ storeId, limit: 100 });
  assert(!visibleStories.some((story) => story.id === expiredStoryId), 'expired story is visible in active stories');

  await createCommunityComment(postId, { storeId, userId, authorName: 'Smoke Tester', text: 'Smoke comment' });
  const comments = await listCommunityComments(postId, { storeId, limit: 20 });
  assert(comments.some((comment) => comment.userId === userId), 'community comment was not saved');

  const likedPost = await setCommunityReaction(postId, userId, 'like', true, { storeId });
  assert(likedPost?.liked === true && Number(likedPost.likes || 0) >= 1, 'like state was not saved');
  const savedPost = await setCommunitySave(postId, userId, true, { storeId });
  assert(savedPost?.saved === true && Number(savedPost.saves || 0) >= 1, 'save state was not saved');

  const posts = await listCommunityPosts({ storeId, viewerId: userId, limit: 100 });
  assert(posts.some((item) => item.id === postId), 'seeded post is not visible in approved feed');

  console.log(JSON.stringify({
    ok: true,
    storeId,
    seed,
    postId,
    storyId,
    comments: comments.length,
  }, null, 2));
} finally {
  await cleanup();
}
