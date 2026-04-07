import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bookmark, Camera, Check, ChevronLeft, ChevronRight, Circle,
  Compass, CreditCard, Heart, Home, Image, LayoutDashboard,
  LogIn, MessageCircle, MoreHorizontal, PlusSquare, Search,
  Send, Shield, Star, TrendingUp, Upload, User, Users, X, Zap,
  ArrowRight,
} from 'lucide-react';
import './index.css';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'https://refluenz-app.onrender.com';

/* ─────────────────────────────────────────────────
   MOCK DATA FALLBACKS
───────────────────────────────────────────────── */
const MOCK_USERS = [
  { id: 'u1', name: 'Aria Romano',   email: 'aria@refluenz.app',   avatarUrl: '' },
  { id: 'u2', name: 'Marco Bianchi', email: 'marco@refluenz.app',  avatarUrl: '' },
];
const MOCK_CREATORS = [
  { id: 'c1', name: 'Julian Dax',  email: 'julian@refluenz.app', niche: 'Photography', avatarUrl: '' },
  { id: 'c2', name: 'Mia Torres',  email: 'mia@refluenz.app',    niche: 'Writing',     avatarUrl: '' },
  { id: 'c3', name: 'Lukas Bauer', email: 'lukas@refluenz.app',  niche: 'Tech',        avatarUrl: '' },
];
const MOCK_TIERS = [
  { id: 't1', name: 'Explorer', monthlyPrice: 5,  features: ['Access to public posts', 'Weekly newsletter'] },
  { id: 't2', name: 'Insider',  monthlyPrice: 12, features: ['All Explorer features', 'Exclusive content', 'Community access'] },
  { id: 't3', name: 'Partner',  monthlyPrice: 29, features: ['All Insider features', 'Monthly 1:1 call', 'Early access'] },
];
function buildMockFeed(creators) {
  const titles  = ['The Psychology of Brutalist Spaces', 'Silence as a Feature', 'Async-First Teams'];
  const stories = ['Just returned from Milano 🏙', 'New chapter coming soon ✍', 'Shipped a new tool today 🚀'];
  const posts = [];
  creators.forEach((c, i) => {
    posts.push({ id: `p${i}1`, type: 'post',  title: titles[i % 3],  body: 'A deep dive into the intersection of design and human experience, exploring how environment shapes cognition.', imageUrl: '', creator: c });
    posts.push({ id: `s${i}1`, type: 'story', text: stories[i % 3], imageUrl: '', creator: c });
  });
  return posts;
}

/* ─────────────────────────────────────────────────
   SMALL HELPERS
───────────────────────────────────────────────── */
function initials(name = '') {
  return name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || 'RF';
}
function Avatar({ url, name, size = 36, fontSize = 13 }) {
  if (url) return <img src={url} alt={name} className="avatar" style={{ width: size, height: size }} />;
  return (
    <div className="avatar-placeholder" style={{ width: size, height: size, fontSize }}>
      {initials(name)}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   TOAST (global)
───────────────────────────────────────────────── */
let _setToast = () => {};
function showToast(msg) { _setToast(msg); }

function ToastPortal() {
  const [msg, setMsg]       = useState('');
  const [visible, setVisible] = useState(false);
  const timerRef = useRef(null);
  _setToast = (m) => {
    setMsg(m);
    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 2200);
  };
  return <div className={`toast${visible ? ' show' : ''}`}>{msg}</div>;
}

/* ─────────────────────────────────────────────────
   STORY MODAL
───────────────────────────────────────────────── */
function StoryModal({ stories, idx, seenIds, onClose, onNext, onPrev, onSeen }) {
  const story = stories[idx];
  const timerRef = useRef(null);
  const [prog, setProg] = useState(0);

  useEffect(() => {
    if (!story) return;
    onSeen(story.id);
    setProg(0);
    const t = setTimeout(() => setProg(100), 50);
    timerRef.current = setTimeout(() => onNext(), 5100);
    return () => { clearTimeout(t); clearTimeout(timerRef.current); };
  }, [story?.id]);

  if (!story) return null;
  const c = story.creator || {};

  return (
    <div className="story-modal-overlay open" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="story-modal-inner">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 14px 10px' }}>
          <Avatar url={c.avatarUrl} name={c.name} size={34} fontSize={12} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name || 'Creator'}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Story</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
            <X size={16} />
          </button>
        </div>
        {/* progress */}
        <div style={{ height: 2, background: 'var(--surface2)', margin: '0 14px 10px' }}>
          <div style={{ height: '100%', background: 'var(--silver)', width: `${prog}%`, transition: prog === 0 ? 'none' : 'width 5s linear' }} />
        </div>
        <div className="story-modal-img-area">
          {story.imageUrl ? <img src={story.imageUrl} alt="" /> : <Image size={28} />}
        </div>
        <div style={{ padding: 14 }}>
          <p style={{ fontSize: 14, color: 'var(--text)' }}>{story.text || ''}</p>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0 14px 14px' }}>
          <button onClick={onPrev} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            <ChevronLeft size={16} /> Prev
          </button>
          <button onClick={onNext} style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────
   POST CARD
───────────────────────────────────────────────── */
function PostCard({ post, liked, onLike }) {
  const c = post.creator || {};
  return (
    <article className="post-card fade-up">
      <div className="post-card-header">
        <Avatar url={c.avatarUrl} name={c.name} size={36} fontSize={12} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name || 'Creator'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.niche || 'Creator'}</div>
        </div>
        <button style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer' }}>
          <MoreHorizontal size={18} />
        </button>
      </div>

      <div className="post-card-img-wrap">
        {post.imageUrl ? <img src={post.imageUrl} alt={post.title || ''} /> : <Image size={28} />}
      </div>

      <div className="post-card-actions">
        <button onClick={() => onLike(post.id)}>
          <Heart size={22} style={{ fill: liked ? 'var(--silver)' : 'none', stroke: liked ? 'var(--silver)' : 'currentColor' }} />
        </button>
        <button><MessageCircle size={22} /></button>
        <button><Send size={20} /></button>
        <div style={{ flex: 1 }} />
        <button><Bookmark size={20} /></button>
      </div>

      <div className="post-card-body">
        <div className="caption">
          <span style={{ fontWeight: 600 }}>{c.name || 'Creator'}</span>{' '}
          {post.title || ''}{post.body ? ` — ${post.body.slice(0, 120)}…` : ''}
        </div>
        <div className="meta">JUST NOW</div>
      </div>
    </article>
  );
}

/* ─────────────────────────────────────────────────
   STORY TRAY
───────────────────────────────────────────────── */
function StoryTray({ stories, seenIds, onOpen }) {
  if (!stories.length) return null;
  return (
    <div className="story-tray">
      {stories.map((s, i) => {
        const c = s.creator || {};
        const seen = seenIds.has(s.id);
        return (
          <div key={s.id} className="story-item" onClick={() => onOpen(i)}>
            <div className={`story-ring${seen ? ' seen' : ''}`}>
              <div className="story-ring-inner">
                <Avatar url={c.avatarUrl} name={c.name} size={52} fontSize={14} />
              </div>
            </div>
            <span>{(c.name || '').split(' ')[0]}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   VIEW: FEED
───────────────────────────────────────────────── */
function FeedView({ feed, likedPosts, onLike, onOpenStory, seenStories }) {
  const posts   = feed.filter(i => i.type === 'post');
  const stories = feed.filter(i => i.type === 'story');
  return (
    <div className="feed-wrap">
      <StoryTray stories={stories} seenIds={seenStories} onOpen={onOpenStory} />
      {posts.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', fontSize: 14 }}>
          No posts yet.<br />Log in to see your feed.
        </div>
      ) : posts.map(p => (
        <PostCard key={p.id} post={p} liked={likedPosts.has(p.id)} onLike={onLike} />
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   VIEW: EXPLORE
───────────────────────────────────────────────── */
function ExploreView({ creators, feed }) {
  const posts = feed.filter(i => i.type === 'post');
  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '24px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--muted)' }} />
          <input className="inp" placeholder="Search creators, posts…" style={{ paddingLeft: 36 }} />
        </div>
      </div>

      <p className="sec-title">Creators</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 12, marginBottom: 28 }}>
        {creators.map(c => (
          <div key={c.id} className="tier-card" style={{ textAlign: 'center' }}>
            <div style={{ margin: '0 auto 10px' }}>
              <Avatar url={c.avatarUrl} name={c.name} size={52} fontSize={15} />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', margin: '3px 0 10px' }}>{c.niche}</div>
            <button className="btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'center' }}>Follow</button>
          </div>
        ))}
      </div>

      <p className="sec-title">Trending Posts</p>
      <div className="post-grid">
        {posts.map(p => (
          <div key={p.id} className="post-grid-item">
            {p.imageUrl ? <img src={p.imageUrl} alt="" /> : (p.title || 'Post').slice(0, 20)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────
   VIEW: AUTH
───────────────────────────────────────────────── */
function AuthView({ users, creators, onAuthenticated }) {
  const [tab,      setTab]      = useState('login');
  const [role,     setRole]     = useState('user');
  const [email,    setEmail]    = useState('aria@refluenz.app');
  const [password, setPassword] = useState('user123');
  const [regId,    setRegId]    = useState('');
  const [error,    setError]    = useState('');

  const accounts = role === 'user' ? users : creators;

  useEffect(() => {
    if (role === 'user') { setEmail('aria@refluenz.app');   setPassword('user123'); }
    else                 { setEmail('julian@refluenz.app'); setPassword('creator123'); }
    if (accounts.length) setRegId(accounts[0].id);
  }, [role, accounts.length]);

  const applyRole = (r) => { setRole(r); setError(''); };

  async function doLogin(e) {
    e.preventDefault();
    setError('');
    try {
      const r = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, email, password }),
      });
      const d = await r.json();
      if (!r.ok) { setError(d.error || 'Invalid credentials'); return; }
      onAuthenticated(role, role === 'user' ? d.user : d.creator);
    } catch {
      const acc = accounts.find(a => a.email === email);
      if (acc) onAuthenticated(role, acc);
      else setError('Backend offline — try the mock accounts above');
    }
  }

  function doRegister(e) {
    e.preventDefault();
    const acc = accounts.find(a => a.id === regId);
    if (acc) onAuthenticated(role, acc);
  }

  return (
    <div style={{ maxWidth: 420, margin: '40px auto', padding: '0 12px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <div className="logo" style={{ fontSize: 38, color: 'var(--text)' }}>
          REfluenz<span style={{ color: 'var(--silver)' }}>.</span>
        </div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6 }}>The premium creator membership platform</p>
      </div>

      <div className="auth-card">
        {/* tab bar */}
        <div className="tab-bar" style={{ marginBottom: 20 }}>
          {['login', 'register'].map(t => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'login' ? 'Log in' : 'Register (Mock)'}
            </button>
          ))}
        </div>

        {/* role selector */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {['user', 'creator'].map(r => (
            <button key={r} className="btn-ghost btn-sm"
              onClick={() => applyRole(r)}
              style={{ flex: 1, borderColor: role === r ? 'var(--silver)' : 'var(--border)', color: role === r ? 'var(--text)' : 'var(--muted)' }}>
              {r.charAt(0).toUpperCase() + r.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'login' ? (
          <form onSubmit={doLogin} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* quick accounts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 4 }}>
              {accounts.slice(0, 4).map(a => (
                <div key={a.id} className="tier-card" style={{ padding: '8px 10px', cursor: 'pointer' }}
                  onClick={() => { setEmail(a.email); setPassword(role === 'user' ? 'user123' : 'creator123'); }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500 }}>{a.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.email}</div>
                </div>
              ))}
            </div>
            <input className="inp" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" />
            <input className="inp" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" />
            <p style={{ fontSize: 11.5, color: 'var(--muted)' }}>Mock password: {role === 'user' ? 'user123' : 'creator123'}</p>
            {error && <div style={{ fontSize: 13, color: '#e88' }}>{error}</div>}
            <button className="btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }}>
              <LogIn size={14} /> Log in
            </button>
          </form>
        ) : (
          <form onSubmit={doRegister} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <select className="inp" value={regId} onChange={e => setRegId(e.target.value)}>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.email})</option>)}
            </select>
            <p style={{ fontSize: 11.5, color: 'var(--muted)' }}>Mock register uses seeded IDs and goes directly to your dashboard.</p>
            <button className="btn-primary" type="submit" style={{ width: '100%', justifyContent: 'center' }}>
              <ArrowRight size={14} /> Continue
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────
   VIEW: LANDING
───────────────────────────────────────────────── */
function LandingView({ tiers, onNavigate }) {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 16px' }}>
      {/* Hero */}
      <div style={{ textAlign: 'center', padding: '40px 0 36px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 99, padding: '5px 14px', fontSize: 12, color: 'var(--silver)', marginBottom: 20, letterSpacing: '.5px' }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--silver)', display: 'inline-block' }} />
          MVP READY
        </div>
        <h1 style={{ fontSize: 'clamp(36px,8vw,72px)', fontWeight: 700, lineHeight: 1.1, marginBottom: 16 }}>
          Premium creator<br /><span style={{ color: 'var(--muted)' }}>membership platform.</span>
        </h1>
        <p style={{ fontSize: 17, color: 'var(--muted)', maxWidth: 480, margin: '0 auto 28px', lineHeight: 1.6 }}>
          Build a sustainable business on your terms. Direct connection, always.
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn-primary" onClick={() => onNavigate('auth')}><ArrowRight size={14} /> Get Started</button>
          <button className="btn-ghost" onClick={() => onNavigate('explore')}>Explore Creators</button>
        </div>
      </div>

      {/* Grid */}
      <div className="hero-grid">
        {[['@julian.dax','Architectural Photography'],['@mia.writes','Creative Writing'],['@lukas.code','Developer Tools'],['@aria.wellness','Mindfulness']].map(([handle, label], i) => (
          <div key={handle} className="hero-cell" style={{ background: i % 2 === 0 ? 'var(--surface)' : 'var(--surface2)' }}>
            <div className="hero-cell-txt">
              <p style={{ fontSize: 12, color: 'var(--silver)' }}>{handle}</p>
              <p style={{ fontSize: 14, fontWeight: 600 }}>{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Features */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 16, marginBottom: 40 }}>
        {[
          { Icon: Shield,     title: 'Creator Sovereignty',  desc: 'You own your audience data. No algorithm roulette. Direct connection, always.' },
          { Icon: TrendingUp, title: 'Sustainable Growth',    desc: 'Tools designed for long-term retention. Predictable, recurring revenue.' },
          { Icon: Users,      title: 'Dual Dashboards',       desc: 'Tailored UX for users and creators. Data-backed views, streamlined workflows.' },
        ].map(({ Icon, title, desc }) => (
          <div key={title} className="tier-card">
            <div style={{ width: 40, height: 40, background: 'var(--surface)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Icon size={18} style={{ color: 'var(--silver)' }} />
            </div>
            <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{desc}</p>
          </div>
        ))}
      </div>

      {/* Tiers */}
      <p className="sec-title">Subscription Tiers</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 12 }}>
        {tiers.map(t => (
          <div key={t.id} className="tier-card">
            <div style={{ fontSize: 11, color: 'var(--silver)', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 }}>{t.name}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 10 }}>
              ${t.monthlyPrice}<span style={{ fontSize: 13, color: 'var(--muted)' }}>/mo</span>
            </div>
            <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(t.features || []).map(f => (
                <li key={f} style={{ fontSize: 13, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Check size={13} style={{ color: 'var(--silver)', flexShrink: 0 }} />{f}
                </li>
              ))}
            </ul>
            <button className="btn-primary" onClick={() => onNavigate('auth')} style={{ marginTop: 14, width: '100%', justifyContent: 'center' }}>Get started</button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────
   VIEW: CREATOR DASHBOARD
───────────────────────────────────────────────── */
function CreatorView({ session, creatorDash, onRefresh }) {
  const [activeTab, setActiveTab] = useState('post');
  const [postTitle,  setPostTitle]  = useState('');
  const [postBody,   setPostBody]   = useState('');
  const [postImg,    setPostImg]    = useState('');
  const [storyText,  setStoryText]  = useState('');
  const [storyImg,   setStoryImg]   = useState('');
  const [chanText,   setChanText]   = useState('');

  if (!session || session.role !== 'creator') {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '80px 12px', textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>
        Log in as a creator to use this dashboard.
      </div>
    );
  }

  const acc     = session.account;
  const dash    = creatorDash || {};
  const creator = dash.creator || acc;

  async function pubPost() {
    if (!postTitle.trim() || !postBody.trim()) { showToast('Fill in title and body'); return; }
    try {
      await fetch(`${API_BASE}/api/creators/${acc.id}/posts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: postTitle, body: postBody, imageUrl: postImg }),
      });
    } catch {}
    setPostTitle(''); setPostBody(''); setPostImg('');
    showToast('Post published!');
    onRefresh();
  }
  async function pubStory() {
    if (!storyText.trim()) { showToast('Add story text'); return; }
    try {
      await fetch(`${API_BASE}/api/creators/${acc.id}/stories`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: storyText, imageUrl: storyImg }),
      });
    } catch {}
    setStoryText(''); setStoryImg('');
    showToast('Story published!');
    onRefresh();
  }
  async function pubChannel() {
    if (!chanText.trim()) return;
    try {
      await fetch(`${API_BASE}/api/creators/${acc.id}/channel-messages`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: chanText }),
      });
    } catch {}
    setChanText('');
    showToast('Posted to channel!');
    onRefresh();
  }

  function handleImgFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => setPostImg(ev.target.result);
    reader.readAsDataURL(file);
  }

  const tabs = [
    { id: 'post',    label: 'Publish Post' },
    { id: 'story',   label: 'Story'        },
    { id: 'channel', label: 'Channel'      },
    { id: 'myposts', label: 'My Posts'     },
  ];

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '24px 12px' }}>
      {/* Profile header */}
      <div className="profile-header">
        <Avatar url={creator.avatarUrl} name={creator.name} size={80} fontSize={22} />
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, marginBottom: 6 }}>{creator.name}</h2>
          <div className="chip" style={{ marginBottom: 8 }}>{creator.niche || 'Creator'}</div>
          <div className="profile-stats">
            <span><strong>{(dash.posts || []).length}</strong><br /><span style={{ fontSize: 12, color: 'var(--muted)' }}>posts</span></span>
            <span><strong>{dash.subscriberCount || 0}</strong><br /><span style={{ fontSize: 12, color: 'var(--muted)' }}>subscribers</span></span>
          </div>
        </div>
      </div>
      <div className="divider" />

      {/* Tab bar */}
      <div className="tab-bar">
        {tabs.map(t => (
          <button key={t.id} className={activeTab === t.id ? 'active' : ''} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Publish Post */}
      {activeTab === 'post' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input className="inp" value={postTitle} onChange={e => setPostTitle(e.target.value)} placeholder="Title…" />
          <textarea className="inp" rows={4} value={postBody} onChange={e => setPostBody(e.target.value)} placeholder="Share something with your subscribers…" />
          <div className="dropzone" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); handleImgFile(e.dataTransfer.files?.[0]); }}>
            <Image size={20} style={{ margin: '0 auto 6px', display: 'block', color: 'var(--muted)' }} />
            <span>Drag & drop image or{' '}
              <label htmlFor="post-img-input" style={{ color: 'var(--silver)', cursor: 'pointer', textDecoration: 'underline' }}>browse</label>
            </span>
            <input type="file" id="post-img-input" accept="image/*" style={{ display: 'none' }} onChange={e => handleImgFile(e.target.files?.[0])} />
          </div>
          {postImg && <img src={postImg} alt="" style={{ width: '100%', borderRadius: 10, maxHeight: 240, objectFit: 'cover' }} />}
          <button className="btn-primary" onClick={pubPost}><Send size={14} /> Publish Post</button>
        </div>
      )}

      {/* Story */}
      {activeTab === 'story' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea className="inp" rows={3} value={storyText} onChange={e => setStoryText(e.target.value)} placeholder="Add story text…" />
          <input className="inp" value={storyImg} onChange={e => setStoryImg(e.target.value)} placeholder="Image URL (optional)" />
          <button className="btn-primary" onClick={pubStory}><Circle size={14} /> Publish Story</button>
        </div>
      )}

      {/* Channel */}
      {activeTab === 'channel' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <textarea className="inp" rows={3} value={chanText} onChange={e => setChanText(e.target.value)} placeholder="Send a message to your subscribers…" />
          <button className="btn-primary" onClick={pubChannel}><MessageCircle size={14} /> Post to Channel</button>
          {(dash.channelMessages || []).slice(0, 6).map((m, i) => (
            <div key={i} className="channel-msg">{m.text}</div>
          ))}
        </div>
      )}

      {/* My Posts */}
      {activeTab === 'myposts' && (
        <div className="post-grid">
          {(dash.posts || []).map(p => (
            <div key={p.id} className="post-grid-item">
              {p.imageUrl ? <img src={p.imageUrl} alt={p.title || ''} /> : (p.title || 'Post').slice(0, 24)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────
   RIGHT PANEL
───────────────────────────────────────────────── */
function RightPanel({ session, tiers, creators, onAvatarUpload }) {
  const [selectedTier, setSelectedTier] = useState('');
  const [cardName,     setCardName]     = useState('');
  const [cardNumber,   setCardNumber]   = useState('');
  const [payResult,    setPayResult]    = useState('');

  useEffect(() => { if (tiers.length && !selectedTier) setSelectedTier(tiers[0].id); }, [tiers]);

  async function purchase() {
    if (!session || session.role !== 'user') { showToast('Log in as a user first'); return; }
    if (!cardName || !cardNumber) { showToast('Fill in card details'); return; }
    try {
      const r = await fetch(`${API_BASE}/api/users/${session.account.id}/purchase-tier`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tierId: selectedTier, cardName, cardNumber }),
      });
      const d = await r.json();
      if (!r.ok) { showToast(d.error || 'Payment failed'); return; }
      setPayResult(`✓ Upgraded! Tx: ${d.payment?.transactionId || 'mock'}`);
      showToast('Tier upgraded!');
    } catch {
      setPayResult('✓ Mock payment accepted!');
      showToast('Tier upgraded (mock)!');
    }
  }

  const acc = session?.account;
  return (
    <div className="right-panel">
      {/* User info */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <Avatar url={acc?.avatarUrl} name={acc?.name || 'Guest'} size={46} fontSize={15} />
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{acc?.name || 'Not logged in'}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{acc?.email || ''}</div>
          </div>
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', fontSize: 12, marginBottom: 12 }}>
          <Star size={12} style={{ color: 'var(--silver)' }} />
          <span style={{ color: 'var(--silver)' }}>Free tier</span>
        </div>
      </div>

      {/* Upgrade */}
      <div>
        <p className="sec-title">Upgrade Tier</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tiers.map(t => (
            <div key={t.id} className={`tier-card${selectedTier === t.id ? ' selected' : ''}`} onClick={() => setSelectedTier(t.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{t.name}</span>
                <span style={{ fontSize: 13, color: 'var(--silver)' }}>${t.monthlyPrice}/mo</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
          <input className="inp" value={cardName} onChange={e => setCardName(e.target.value)} placeholder="Cardholder name" />
          <input className="inp" value={cardNumber} onChange={e => setCardNumber(e.target.value)} placeholder="Card number" />
          <button className="btn-primary" onClick={purchase}><CreditCard size={14} /> Pay & Upgrade</button>
          {payResult && <div style={{ fontSize: 12, color: 'var(--silver)' }}>{payResult}</div>}
        </div>
      </div>

      {/* Suggested creators */}
      <div>
        <p className="sec-title">Suggested Creators</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {creators.slice(0, 4).map(c => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar url={c.avatarUrl} name={c.name} size={36} fontSize={11} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{c.name}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{c.niche}</div>
              </div>
              <button className="btn-ghost btn-sm">Follow</button>
            </div>
          ))}
        </div>
      </div>

      {/* Profile photo */}
      <div>
        <p className="sec-title">Profile Photo</p>
        <button className="btn-ghost" style={{ width: '100%', justifyContent: 'center' }} onClick={() => document.getElementById('rp-avatar-input').click()}>
          <Upload size={14} /> Upload photo
        </button>
        <input type="file" id="rp-avatar-input" accept="image/*" style={{ display: 'none' }} onChange={e => onAvatarUpload('user', e.target.files?.[0])} />
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────
   SIDEBAR
───────────────────────────────────────────────── */
function Sidebar({ view, onNavigate, session }) {
  const acc = session?.account;
  const navItems = [
    { id: 'feed',    Icon: Home,            label: 'Feed'      },
    { id: 'explore', Icon: Compass,         label: 'Explore'   },
    { id: 'creator', Icon: LayoutDashboard, label: 'Creator'   },
    { id: 'landing', Icon: Zap,             label: 'Platform'  },
    { id: 'auth',    Icon: LogIn,           label: 'Access'    },
  ];
  return (
    <nav className="sidebar">
      <div className="logo" style={{ fontSize: 24, marginBottom: 32, padding: '0 14px', color: 'var(--text)' }}>
        REfluenz<span style={{ color: 'var(--silver)' }}>.</span>
      </div>
      {navItems.map(({ id, Icon, label }) => (
        <button key={id} className={`nav-item${view === id ? ' active' : ''}`} onClick={() => onNavigate(id)}>
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
      <div style={{ flex: 1 }} />
      <div className="sidebar-user">
        <Avatar url={acc?.avatarUrl} name={acc?.name || 'Guest'} size={36} fontSize={13} />
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <div style={{ fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acc?.name || 'Guest'}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{session?.role === 'creator' ? 'Creator' : 'User'}</div>
        </div>
      </div>
    </nav>
  );
}

/* ─────────────────────────────────────────────────
   APP ROOT
───────────────────────────────────────────────── */
export default function App() {
  const [view,         setView]         = useState('feed');
  const [users,        setUsers]        = useState(MOCK_USERS);
  const [creators,     setCreators]     = useState(MOCK_CREATORS);
  const [tiers,        setTiers]        = useState(MOCK_TIERS);
  const [session,      setSession]      = useState(null);
  const [dashboard,    setDashboard]    = useState(null);
  const [creatorDash,  setCreatorDash]  = useState(null);
  const [likedPosts,   setLikedPosts]   = useState(new Set());
  const [seenStories,  setSeenStories]  = useState(new Set());
  const [storyOpen,    setStoryOpen]    = useState(false);
  const [storyIdx,     setStoryIdx]     = useState(0);

  /* boot */
  useEffect(() => {
    async function boot() {
      try { const r = await fetch(`${API_BASE}/api/users`);        const d = await r.json(); setUsers(d.users || MOCK_USERS); } catch {}
      try { const r = await fetch(`${API_BASE}/api/creators`);     const d = await r.json(); setCreators(d.creators || MOCK_CREATORS); } catch {}
      try { const r = await fetch(`${API_BASE}/api/subscription-tiers`); const d = await r.json(); setTiers(d.tiers || MOCK_TIERS); } catch {}
    }
    boot();
  }, []);

  /* keyboard shortcuts for story */
  useEffect(() => {
    const handler = e => {
      if (e.key === 'Escape') setStoryOpen(false);
      if (e.key === 'ArrowRight' && storyOpen) advanceStory(1);
      if (e.key === 'ArrowLeft'  && storyOpen) advanceStory(-1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [storyOpen, storyIdx, stories]);

  const feed    = dashboard?.feed || buildMockFeed(creators);
  const stories = feed.filter(i => i.type === 'story');

  function advanceStory(dir) {
    const next = storyIdx + dir;
    if (next < 0 || next >= stories.length) setStoryOpen(false);
    else setStoryIdx(next);
  }

  function openStory(idx) { setStoryIdx(idx); setStoryOpen(true); }

  function toggleLike(id) {
    setLikedPosts(prev => {
      const s = new Set(prev);
      s.has(id) ? s.delete(id) : s.add(id);
      return s;
    });
  }

  function markSeen(id) {
    setSeenStories(prev => new Set([...prev, id]));
  }

  async function loadUserDash(uid) {
    try {
      const r = await fetch(`${API_BASE}/api/dashboard/user/${uid}`);
      setDashboard(await r.json());
    } catch {
      setDashboard({ feed: buildMockFeed(creators), tier: { name: 'Explorer' }, subscribedCreators: creators });
    }
  }

  async function loadCreatorDash(cid) {
    try {
      const r = await fetch(`${API_BASE}/api/dashboard/creator/${cid}`);
      setCreatorDash(await r.json());
    } catch {
      setCreatorDash({ creator: session?.account, posts: [], stories: [], channelMessages: [], subscriberCount: 0 });
    }
  }

  function onAuthenticated(role, account) {
    const sess = { role, account };
    setSession(sess);
    if (role === 'user') {
      loadUserDash(account.id).then(() => setView('feed'));
    } else {
      loadCreatorDash(account.id).then(() => setView('creator'));
    }
    showToast(`Welcome back, ${account.name.split(' ')[0]}!`);
  }

  async function onAvatarUpload(type, file) {
    if (!file || !session) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      const avatarUrl = ev.target.result;
      const acc = session.account;
      const endpoint = type === 'user'
        ? `${API_BASE}/api/users/${acc.id}/avatar`
        : `${API_BASE}/api/creators/${acc.id}/avatar`;
      try {
        const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarUrl }) });
        const d = await r.json();
        if (r.ok) setSession(s => ({ ...s, account: type === 'user' ? d.user : d.creator }));
      } catch {
        setSession(s => ({ ...s, account: { ...s.account, avatarUrl } }));
      }
      showToast('Photo updated!');
    };
    reader.readAsDataURL(file);
  }

  function navigate(v) { setView(v); window.scrollTo(0, 0); }

  const bottomNavItems = [
    { id: 'feed',    Icon: Home        },
    { id: 'explore', Icon: Compass     },
    { id: 'creator', Icon: PlusSquare  },
    { id: 'auth',    Icon: User        },
  ];

  return (
    <>
      <Sidebar view={view} onNavigate={navigate} session={session} />

      {/* Topbar (mobile) */}
      <div className="topbar">
        <div className="logo" style={{ fontSize: 22, color: 'var(--text)' }}>
          REfluenz<span style={{ color: 'var(--silver)' }}>.</span>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Search size={20} style={{ color: 'var(--silver)', cursor: 'pointer' }} />
          <Send    size={20} style={{ color: 'var(--silver)', cursor: 'pointer' }} />
        </div>
      </div>

      {/* Bottom nav (mobile) */}
      <div className="bottomnav">
        {bottomNavItems.map(({ id, Icon }) => (
          <button key={id} className={`bnav-item${view === id ? ' active' : ''}`} onClick={() => navigate(id)}>
            <Icon size={22} />
          </button>
        ))}
      </div>

      {/* Main content */}
      <div className={`main-content has-right`}>
        <div className={`view${view === 'feed'    ? ' active fade-in' : ''}`}>
          <FeedView feed={feed} likedPosts={likedPosts} onLike={toggleLike} onOpenStory={openStory} seenStories={seenStories} />
        </div>
        <div className={`view${view === 'explore' ? ' active fade-in' : ''}`}>
          <ExploreView creators={creators} feed={feed} />
        </div>
        <div className={`view${view === 'creator' ? ' active fade-in' : ''}`}>
          <CreatorView session={session} creatorDash={creatorDash} onRefresh={() => session?.account?.id && loadCreatorDash(session.account.id)} />
        </div>
        <div className={`view${view === 'auth'    ? ' active fade-in' : ''}`}>
          <AuthView users={users} creators={creators} onAuthenticated={onAuthenticated} />
        </div>
        <div className={`view${view === 'landing' ? ' active fade-in' : ''}`}>
          <LandingView tiers={tiers} onNavigate={navigate} />
        </div>
      </div>

      {/* Right panel */}
      <RightPanel session={session} tiers={tiers} creators={creators} onAvatarUpload={onAvatarUpload} />

      {/* Story modal */}
      {storyOpen && (
        <StoryModal
          stories={stories}
          idx={storyIdx}
          seenIds={seenStories}
          onClose={() => setStoryOpen(false)}
          onNext={() => advanceStory(1)}
          onPrev={() => advanceStory(-1)}
          onSeen={markSeen}
        />
      )}

      <ToastPortal />
    </>
  );
}
