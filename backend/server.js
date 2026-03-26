import { createServer } from 'node:http';

const PORT = Number(process.env.PORT) || 4000;

const subscriptionTiers = [
  { id: 'essential', name: 'Essential', monthlyPrice: 9, features: ['View creator posts', 'View creator stories'] },
  { id: 'premium', name: 'Premium', monthlyPrice: 19, features: ['Everything in Essential', 'Early-access creator drops', 'Priority Q&A'] },
  { id: 'signature', name: 'Signature', monthlyPrice: 39, features: ['Everything in Premium', 'Private creator rooms', 'Monthly strategy session'] },
];

const users = [
  {
    id: 'u1',
    name: 'Aria Bennett',
    email: 'aria@refluenz.app',
    password: 'user123',
    tierId: 'essential',
    avatarUrl: '/mock/user-aria.svg',
    subscribedCreatorIds: ['c1', 'c3'],
  },
  {
    id: 'u2',
    name: 'Noah Cole',
    email: 'noah@refluenz.app',
    password: 'user123',
    tierId: 'premium',
    avatarUrl: '/mock/user-noah.svg',
    subscribedCreatorIds: ['c2', 'c4'],
  },
  {
    id: 'u3',
    name: 'Mila Rhodes',
    email: 'mila@refluenz.app',
    password: 'user123',
    tierId: 'signature',
    avatarUrl: '/mock/user-mila.svg',
    subscribedCreatorIds: ['c1', 'c5', 'c3'],
  },
  {
    id: 'u4',
    name: 'Ethan Vale',
    email: 'ethan@refluenz.app',
    password: 'user123',
    tierId: 'premium',
    avatarUrl: '/mock/user-ethan.svg',
    subscribedCreatorIds: ['c4', 'c2'],
  },
  {
    id: 'u5',
    name: 'Sage Monroe',
    email: 'sage@refluenz.app',
    password: 'user123',
    tierId: 'essential',
    avatarUrl: '/mock/user-sage.svg',
    subscribedCreatorIds: ['c5', 'c1'],
  },
];

const creators = [
  {
    id: 'c1',
    name: 'Julian Dax',
    email: 'julian@refluenz.app',
    password: 'creator123',
    niche: 'Architecture',
    audience: 12500,
    avatarUrl: '/mock/creator-julian.svg',
  },
  {
    id: 'c2',
    name: 'Sera Lin',
    email: 'sera@refluenz.app',
    password: 'creator123',
    niche: 'Luxury Wellness',
    audience: 9800,
    avatarUrl: '/mock/creator-sera.svg',
  },
  {
    id: 'c3',
    name: 'Romy Kade',
    email: 'romy@refluenz.app',
    password: 'creator123',
    niche: 'Design Systems',
    audience: 14200,
    avatarUrl: '/mock/creator-romy.svg',
  },
  {
    id: 'c4',
    name: 'Theo Arman',
    email: 'theo@refluenz.app',
    password: 'creator123',
    niche: 'Product Leadership',
    audience: 8700,
    avatarUrl: '/mock/creator-theo.svg',
  },
  {
    id: 'c5',
    name: 'Ivy Rena',
    email: 'ivy@refluenz.app',
    password: 'creator123',
    niche: 'Editorial Photography',
    audience: 11300,
    avatarUrl: '/mock/creator-ivy.svg',
  },
];

const posts = [
  { id: 'p1', creatorId: 'c1', title: 'Concrete Quiet', body: 'How minimalist architecture reduces cognitive overload.', imageUrl: '/mock/post-concrete.svg', createdAt: '2026-03-21T09:00:00.000Z' },
  { id: 'p2', creatorId: 'c2', title: 'Rituals for Focus', body: 'A 20-minute premium morning structure for founders.', imageUrl: '/mock/post-focus.svg', createdAt: '2026-03-22T13:15:00.000Z' },
  { id: 'p3', creatorId: 'c3', title: 'Design Debt Signals', body: 'Three practical indicators your product UI is drifting.', imageUrl: '/mock/post-design.svg', createdAt: '2026-03-23T17:45:00.000Z' },
  { id: 'p4', creatorId: 'c4', title: 'Decision Logs That Scale', body: 'A short framework for product leaders documenting key choices.', imageUrl: '/mock/post-leadership.svg', createdAt: '2026-03-24T09:15:00.000Z' },
  { id: 'p5', creatorId: 'c5', title: 'Shadow and Texture', body: 'How to frame editorial portraits with one practical light setup.', imageUrl: '/mock/post-photo.svg', createdAt: '2026-03-25T11:40:00.000Z' },
];

const stories = [
  { id: 's1', creatorId: 'c1', text: 'Live from Lisbon studio review. New photo set at 6 PM.', imageUrl: '/mock/story-lisbon.svg', createdAt: '2026-03-24T10:30:00.000Z' },
  { id: 's2', creatorId: 'c4', text: 'Quick leadership brief: 2 questions for weekly retros.', imageUrl: '/mock/story-retro.svg', createdAt: '2026-03-25T08:20:00.000Z' },
  { id: 's3', creatorId: 'c5', text: 'Behind the lens: grading setup for cinematic shadows.', imageUrl: '/mock/story-lens.svg', createdAt: '2026-03-25T19:05:00.000Z' },
];

let nextPostId = posts.length + 1;
let nextStoryId = stories.length + 1;

const sanitizeUser = ({ password, ...safeUser }) => safeUser;
const sanitizeCreator = ({ password, ...safeCreator }) => safeCreator;
const normalizeImageUrl = (value) => {
  const candidate = String(value || '').trim();
  if (!candidate) return '';
  if (candidate.startsWith('/mock/')) return candidate;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return candidate;
    }
  } catch {
    return '';
  }
  return '';
};

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
  const subscribedCreatorIds = user.subscribedCreatorIds || [];
  const subscribedCreators = creators
    .filter((creator) => subscribedCreatorIds.includes(creator.id))
    .map(sanitizeCreator);

  const contentFeed = [...posts.map((post) => ({ type: 'post', ...post })), ...stories.map((story) => ({ type: 'story', ...story }))]
    .filter((item) => subscribedCreatorIds.includes(item.creatorId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((item) => ({
      ...item,
      creator: sanitizeCreator(creators.find((creator) => creator.id === item.creatorId) || {}),
    }));

  const recentSubscribedPosts = posts
    .filter((post) => subscribedCreatorIds.includes(post.creatorId))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map((post) => ({
      ...post,
      creator: sanitizeCreator(creators.find((creator) => creator.id === post.creatorId) || {}),
    }));

  return {
    user: sanitizeUser(user),
    tier,
    feed: contentFeed,
    subscribedCreators,
    recentSubscribedPosts,
  };
};

const buildCreatorDashboard = (creatorId) => {
  const creator = creators.find((item) => item.id === creatorId);
  if (!creator) return null;

  return {
    creator: sanitizeCreator(creator),
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

  if (req.method === 'POST' && path === '/api/auth/login') {
    const body = await parseBody(req);
    if (!body || !body.role || !body.email || !body.password) {
      json(res, 400, { error: 'role, email and password are required' });
      return;
    }

    const role = String(body.role).trim();
    const email = String(body.email).trim().toLowerCase();
    const password = String(body.password).trim();

    if (role === 'user') {
      const user = users.find((item) => item.email.toLowerCase() === email && item.password === password);
      if (!user) {
        json(res, 401, { error: 'Invalid user credentials' });
        return;
      }
      json(res, 200, { role: 'user', user: sanitizeUser(user) });
      return;
    }

    if (role === 'creator') {
      const creator = creators.find((item) => item.email.toLowerCase() === email && item.password === password);
      if (!creator) {
        json(res, 401, { error: 'Invalid creator credentials' });
        return;
      }
      json(res, 200, { role: 'creator', creator: sanitizeCreator(creator) });
      return;
    }

    json(res, 400, { error: 'Invalid role' });
    return;
  }

  if (req.method === 'GET' && path === '/api/users') {
    json(res, 200, { users: users.map(sanitizeUser) });
    return;
  }

  if (req.method === 'GET' && path === '/api/creators') {
    json(res, 200, { creators: creators.map(sanitizeCreator) });
    return;
  }

  if (req.method === 'GET' && path === '/api/subscription-tiers') {
    json(res, 200, { tiers: subscriptionTiers });
    return;
  }

  if (req.method === 'POST' && path.startsWith('/api/users/') && path.endsWith('/purchase-tier')) {
    const userId = path.split('/')[3];
    const user = users.find((item) => item.id === userId);
    if (!user) {
      json(res, 404, { error: 'User not found' });
      return;
    }

    const body = await parseBody(req);
    if (!body || !body.tierId || !body.cardName || !body.cardNumber) {
      json(res, 400, { error: 'tierId, cardName and cardNumber are required' });
      return;
    }

    const tierId = String(body.tierId).trim();
    const cardName = String(body.cardName).trim();
    const hasCardNumber = Boolean(String(body.cardNumber || '').trim());
    const tier = subscriptionTiers.find((item) => item.id === tierId);

    if (!tier) {
      json(res, 400, { error: 'Invalid tierId' });
      return;
    }

    if (!cardName || !hasCardNumber) {
      json(res, 400, { error: 'Mock payment details are invalid' });
      return;
    }

    user.tierId = tierId;
    json(res, 200, {
      payment: {
        status: 'paid',
        transactionId: `txn_${Date.now()}`,
        amount: tier.monthlyPrice,
        currency: 'USD',
      },
      tier,
      user: sanitizeUser(user),
    });
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
    const imageUrl = normalizeImageUrl(body.imageUrl);
    if (!title || !content) {
      json(res, 400, { error: 'title and body are required' });
      return;
    }

    const post = {
      id: `p${nextPostId}`,
      creatorId,
      title,
      body: content,
      imageUrl,
      createdAt: new Date().toISOString(),
    };
    nextPostId += 1;
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
    const imageUrl = normalizeImageUrl(body.imageUrl);
    if (!text) {
      json(res, 400, { error: 'text is required' });
      return;
    }

    const story = {
      id: `s${nextStoryId}`,
      creatorId,
      text,
      imageUrl,
      createdAt: new Date().toISOString(),
    };
    nextStoryId += 1;
    stories.push(story);
    json(res, 201, { story });
    return;
  }

  json(res, 404, { error: 'Route not found' });
}).listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`REfluenz backend listening on http://localhost:${PORT}`);
});
