import '../env.js';
import { createArticle, listArticles, updateArticle } from '../db.js';
import { DEFAULT_ARTICLES } from '../default-articles.js';

async function main() {
  const existing = await listArticles(true);
  const byId = new Map(existing.map((article) => [article.id, article]));
  const changes = [];

  for (const article of DEFAULT_ARTICLES) {
    const current = byId.get(article.id);
    if (!current) {
      await createArticle(article);
      changes.push({ id: article.id, action: 'created', cover: article.cover });
      continue;
    }
    if (!String(current.cover || '').trim()) {
      await updateArticle(article.id, { cover: article.cover });
      changes.push({ id: article.id, action: 'cover_added', cover: article.cover });
    }
  }

  console.log(JSON.stringify({
    changed: changes.length,
    articles: changes,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
