import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 4000;

const subscriptionTiers = [
  { id: 'essential', name: 'Essential', monthlyPrice: 9, features: ['View creator posts', 'View creator stories'] },
  { id: 'premium', name: 'Premium', monthlyPrice: 19, features: ['Everything in Essential', 'Early-access creator drops', 'Priority Q&A'] },
  { id: 'signature', name: 'Signature', monthlyPrice: 39, features: ['Everything in Premium', 'Private creator rooms', 'Monthly strategy session'] },
];

const users = [
  { id: 'u1', name: 'Aria Bennett', email: 'aria@refluenz.app', tierId: 'essential' },
  { id: 'u2', name: 'Noah Cole', email: 'noah@refluenz.app', tierId: 'premium' },
  { id: 'u3', name: 'Mila Rhodes', email: 'mila@refluenz.app', tierId: 'signature' },
  { id: 'u4', name: 'Ethan Vale', email: 'ethan@refluenz.app', tierId: 'premium' },
  { id: 'u5', name: 'Sage Monroe', email: 'sage@refluenz.app', tierId: 'essential' },
];

const creators = [
  { id: 'c1', name: 'Julian Dax', niche: 'Architecture', audience: 12500 },
  { id: 'c2', name: 'Sera Lin', niche: 'Luxury Wellness', audience: 9800 },
  { id: 'c3', name: 'Romy Kade', niche: 'Design Systems', audience: 14200 },
  { id: 'c4', name: 'Theo Arman', niche: 'Product Leadership', audience: 8700 },
  { id: 'c5', name: 'Ivy Rena', niche: 'Editorial Photography', audience: 11300 },
];

const posts = [
  { id: 'p1', creatorId: 'c1', title: 'Concrete Quiet', body: 'How minimalist architecture reduces cognitive overload.', createdAt: '2026-03-21T09:00:00.000Z' },
  { id: 'p2', creatorId: 'c2', title: 'Rituals for Focus', body: 'A 20-minute premium morning structure for founders.', createdAt: '2026-03-22T13:15:00.000Z' },
  { id: 'p3', creatorId: 'c3', title: 'Design Debt Signals', body: 'Three practical indicators your product UI is drifting.', createdAt: '2026-03-23T17:45:00.000Z' },
];

const stories = [
  { id: 's1', creatorId: 'c1', text: 'Live from Lisbon studio review. New photo set at 6 PM.', createdAt: '2026-03-24T10:30:00.000Z' },
  { id: 's2', creatorId: 'c4', text: 'Quick leadership brief: 2 questions for weekly retros.', createdAt: '2026-03-25T08:20:00.000Z' },
  { id: 's3', creatorId: 'c5', text: 'Behind the lens: grading setup for cinematic shadows.', createdAt: '2026-03-25T19:05:00.000Z' },
];

const json = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(JSON.stringify(payload));
};

const parseBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return null;
  }
};

const buildUserDashboard = (userId) => {
  const user = users.find((item) => item.id === userId);
  if (!user) return null;

  const tier = subscriptionTiers.find((item) => item.id === user.tierId);
  const contentFeed = [...posts.map((post) => ({ type: 'post', ...post })), ...stories.map((story) => ({ type: 'story', ...story }))]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => ({
      ...item,
      creator: creators.find((creator) => creator.id === item.creatorId) || null,
    }));

  return { user, tier, feed: contentFeed };
};

const buildCreatorDashboard = (creatorId) => {
  const creator = creators.find((item) => item.id === creatorId);
  if (!creator) return null;

  return {
    creator,
    posts: posts.filter((post) => post.creatorId === creatorId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    stories: stories.filter((story) => story.creatorId === creatorId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
  };
};

createServer(async (req, res) => {
  if (!req.url) {
    json(res, 400, { error: 'Invalid request URL' });
    return;
  }

  if (req.method === 'OPTIONS') {
    json(res, 204, {});
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;

  if (req.method === 'GET' && path === '/api/health') {
    json(res, 200, { status: 'ok' });
    return;
  }

  if (req.method === 'GET' && path === '/api/users') {
    json(res, 200, { users });
    return;
  }

  if (req.method === 'GET' && path === '/api/creators') {
    json(res, 200, { creators });
    return;
  }

  if (req.method === 'GET' && path === '/api/subscription-tiers') {
    json(res, 200, { tiers: subscriptionTiers });
    return;
  }

  if (req.method === 'GET' && path.startsWith('/api/dashboard/user/')) {
    const userId = path.split('/').pop();
    const dashboard = buildUserDashboard(userId);
    if (!dashboard) {
      json(res, 404, { error: 'User not found' });
      return;
    }
    json(res, 200, dashboard);
    return;
  }

  if (req.method === 'GET' && path.startsWith('/api/dashboard/creator/')) {
    const creatorId = path.split('/').pop();
    const dashboard = buildCreatorDashboard(creatorId);
    if (!dashboard) {
      json(res, 404, { error: 'Creator not found' });
      return;
    }
    json(res, 200, dashboard);
    return;
  }

  if (req.method === 'POST' && path.startsWith('/api/creators/') && path.endsWith('/posts')) {
    const creatorId = path.split('/')[3];
    const creatorExists = creators.some((creator) => creator.id === creatorId);
    if (!creatorExists) {
      json(res, 404, { error: 'Creator not found' });
      return;
    }

    const body = await parseBody(req);
    if (!body || !body.title || !body.body) {
      json(res, 400, { error: 'title and body are required' });
      return;
    }
    const title = String(body.title).trim();
    const content = String(body.body).trim();
    if (!title || !content) {
      json(res, 400, { error: 'title and body are required' });
      return;
    }

    const post = {
      id: `p${posts.length + 1}`,
      creatorId,
      title,
      body: content,
      createdAt: new Date().toISOString(),
    };
    posts.push(post);
    json(res, 201, { post });
    return;
  }

  if (req.method === 'POST' && path.startsWith('/api/creators/') && path.endsWith('/stories')) {
    const creatorId = path.split('/')[3];
    const creatorExists = creators.some((creator) => creator.id === creatorId);
    if (!creatorExists) {
      json(res, 404, { error: 'Creator not found' });
      return;
    }

    const body = await parseBody(req);
    if (!body || !body.text) {
      json(res, 400, { error: 'text is required' });
      return;
    }
    const text = String(body.text).trim();
    if (!text) {
      json(res, 400, { error: 'text is required' });
      return;
    }

    const story = {
      id: `s${stories.length + 1}`,
      creatorId,
      text,
      createdAt: new Date().toISOString(),
    };
    stories.push(story);
    json(res, 201, { story });
    return;
  }

  json(res, 404, { error: 'Route not found' });
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`REfluenz backend listening on http://localhost:${PORT}`);
});
