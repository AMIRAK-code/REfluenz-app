import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight,
  Check,
  CreditCard,
  ImagePlus,
  Lock,
  Menu,
  MessageSquare,
  PlusCircle,
  Shield,
  TrendingUp,
  Upload,
  Users,
  X,
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';
const FALLBACK_IMAGE = '/mock/post-concrete.svg';
const FALLBACK_AVATAR = '/mock/user-aria.svg';
const wrapIndex = (index, length) => ((index % length) + length) % length;
const THEME_TOKENS = {
  dark: {
    '--color-bg': '#050605',
    '--color-surface': '#0e1210',
    '--color-text-main': '#eff1f0',
    '--color-text-muted': '#889993',
    '--color-accent': '#d6cdc6',
    '--color-accent-hover': '#e8e2de',
    '--story-ring-unseen': '#f8fafc',
    '--story-ring-seen': '#9ca3af',
  },
  light: {
    '--color-bg': '#f6f8fb',
    '--color-surface': '#ffffff',
    '--color-text-main': '#111827',
    '--color-text-muted': '#4b5563',
    '--color-accent': '#111827',
    '--color-accent-hover': '#374151',
    '--story-ring-unseen': '#111827',
    '--story-ring-seen': '#9ca3af',
  },
  instagram: {
    '--color-bg': '#0f1023',
    '--color-surface': '#1a1530',
    '--color-text-main': '#f8f7ff',
    '--color-text-muted': '#c6bedf',
    '--color-accent': '#ff3f93',
    '--color-accent-hover': '#ff6cae',
    '--story-ring-unseen': '#feda75',
    '--story-ring-seen': '#9ca3af',
  },
  facebook: {
    '--color-bg': '#f0f2f5',
    '--color-surface': '#ffffff',
    '--color-text-main': '#1c1e21',
    '--color-text-muted': '#65676b',
    '--color-accent': '#1877f2',
    '--color-accent-hover': '#2d88ff',
    '--story-ring-unseen': '#1877f2',
    '--story-ring-seen': '#bcc0c4',
  },
  pinterest: {
    '--color-bg': '#fff7f7',
    '--color-surface': '#ffffff',
    '--color-text-main': '#211922',
    '--color-text-muted': '#5f5b62',
    '--color-accent': '#e60023',
    '--color-accent-hover': '#ad081b',
    '--story-ring-unseen': '#e60023',
    '--story-ring-seen': '#d4d4d8',
  },
};
const THEME_OPTIONS = [
  { value: 'dark', label: 'Dark' },
  { value: 'light', label: 'Light' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'facebook', label: 'Facebook' },
  { value: 'pinterest', label: 'Pinterest' },
];

const toDataUrl = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(new Error('Unable to read file'));
  reader.readAsDataURL(file);
});

const Navbar = ({ onViewChange, currentView, theme, onThemeChange }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const links = [
    { key: 'landing', label: 'Platform' },
    { key: 'profile', label: 'Explore Creators' },
    { key: 'auth', label: 'Access' },
    { key: 'user', label: 'User Dashboard' },
    { key: 'creator', label: 'Creator Dashboard' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 backdrop-blur-md border-b border-white/10" style={{ backgroundColor: 'var(--color-bg)' }}>
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <button className="text-2xl font-bold font-heading tracking-tight" onClick={() => onViewChange('auth')}>
          REfluenz<span style={{ color: 'var(--color-accent)' }}>.</span>
        </button>

        <div className="hidden md:flex items-center space-x-8">
          {links.map((link) => (
            <button
              key={link.key}
              onClick={() => {
                onViewChange(link.key);
                setMobileMenuOpen(false);
              }}
              className={`text-sm font-medium transition-colors ${currentView === link.key ? 'text-white' : 'text-[#889993] hover:text-white'}`}
            >
              {link.label}
            </button>
          ))}
          <select
            value={theme}
            onChange={(event) => onThemeChange(event.target.value)}
            aria-label="Select theme"
            className="border border-white/20 rounded-md px-2 py-1 text-xs"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-main)' }}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="md:hidden">
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-white">
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>

      {mobileMenuOpen ? (
        <div className="md:hidden px-6 pb-4 space-y-2 border-t border-white/5 bg-[#050605]">
          {links.map((link) => (
            <button
              key={link.key}
              onClick={() => {
                onViewChange(link.key);
                setMobileMenuOpen(false);
              }}
              className={`w-full text-left py-2 text-sm font-medium ${currentView === link.key ? 'text-white' : 'text-[#889993]'}`}
            >
              {link.label}
            </button>
          ))}
          <select
            value={theme}
            onChange={(event) => onThemeChange(event.target.value)}
            aria-label="Select theme"
            className="w-full border border-white/20 rounded-md px-2 py-2 text-xs"
            style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-main)' }}
          >
            {THEME_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </nav>
  );
};

const Avatar = ({ url, alt }) => (
  <img
    src={url || FALLBACK_AVATAR}
    alt={alt}
    className="w-11 h-11 rounded-full object-cover border border-white/15"
    loading="lazy"
    onError={(event) => {
      event.currentTarget.src = FALLBACK_AVATAR;
    }}
  />
);

const FeedImage = ({ src, alt, className }) => (
  <img
    src={src || FALLBACK_IMAGE}
    alt={alt}
    className={className}
    loading="lazy"
    onError={(event) => {
      event.currentTarget.src = FALLBACK_IMAGE;
    }}
  />
);

const LandingView = ({ onViewChange, tiers }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20">
    {/* Hero */}
    <section className="relative pb-20 md:pb-32 overflow-hidden border-b border-white/5">
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-3xl">
          <div className="inline-flex items-center space-x-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#d6cdc6]" />
            <span className="text-xs font-medium text-[#d6cdc6] tracking-wide uppercase">Private Beta Access</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            Influence with <br />
            <span className="text-[#889993]">Intent.</span>
          </h1>
          <p className="text-lg md:text-xl text-[#889993] mb-10 max-w-xl leading-relaxed">
            The platform for creators who value depth over reach. Build a sustainable business on your terms, without the noise.
          </p>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <button
              onClick={() => onViewChange('profile')}
              className="bg-[#d6cdc6] text-[#050605] px-8 py-3.5 rounded-sm font-medium text-lg hover:bg-[#e8e2de] transition-colors flex items-center group"
            >
              View Creator Demo
              <ArrowRight className="ml-2 w-4 h-4 transition-transform group-hover:translate-x-1" />
            </button>
            <button
              onClick={() => onViewChange('auth')}
              className="px-8 py-3.5 rounded-sm font-medium text-lg border border-white/20 text-white hover:border-white/40 transition-colors"
            >
              Request Access
            </button>
          </div>
        </div>
      </div>
      <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-b from-[#0e1210] to-[#050605] opacity-50 pointer-events-none" />
      <div className="absolute top-20 right-[-10%] w-[600px] h-[600px] bg-[#d6cdc6] rounded-full blur-[120px] opacity-5 mix-blend-screen pointer-events-none" />
    </section>

    {/* Features */}
    <section className="py-24 border-b border-white/5">
      <div className="container mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            { icon: Shield, title: 'Creator Sovereignty', desc: 'You own your audience data. No algorithm roulette. Direct connection, always.' },
            { icon: TrendingUp, title: 'Sustainable Growth', desc: 'Tools designed for long-term retention, not just viral spikes. Predictable revenue.' },
            { icon: Users, title: 'Curated Community', desc: 'A noise-free environment for your most dedicated followers to engage deeply.' },
          ].map((item) => (
            <div key={item.title} className="p-8 border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors rounded-xl">
              <div className="w-12 h-12 flex items-center justify-center bg-[#161c18] rounded-lg mb-6 text-[#d6cdc6]">
                <item.icon size={24} />
              </div>
              <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
              <p className="text-[#889993] leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    {/* Subscription Tiers */}
    <section className="py-20">
      <div className="container mx-auto px-6">
        <h2 className="text-3xl font-bold mb-8">Subscription Tiers</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => (
            <div key={tier.id} className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <p className="text-[#d6cdc6] text-sm uppercase tracking-wider mb-2">{tier.name}</p>
              <p className="text-4xl font-bold mb-4">
                ${tier.monthlyPrice}
                <span className="text-sm text-[#889993]">/mo</span>
              </p>
              <ul className="space-y-2">
                {tier.features.map((feature) => (
                  <li key={feature} className="flex items-start text-sm text-[#889993]">
                    <Check className="w-4 h-4 mr-2 mt-0.5 text-[#4E9F76]" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  </motion.div>
);

const MOCK_ESSAYS = [
  {
    id: 'essay-1',
    category: 'Architecture',
    readTime: '5 min read',
    title: 'The Psychology of Brutalist Spaces',
    excerpt: 'Why do we feel calm in concrete? Looking at the raw honesty of materials and how they affect our cognitive load...',
  },
  {
    id: 'essay-2',
    category: 'Design',
    readTime: '7 min read',
    title: 'Silence as a Feature',
    excerpt: 'In a world of noise, empty space is the ultimate luxury. How to design for silence in digital interfaces...',
  },
];

const MOCK_MEMBER_BENEFITS = [
  'Weekly Deep Dives',
  'High-Res Image Library',
  'Monthly Q&A Calls',
  'Community Discord',
];

const ProfileView = ({ onSubscribe }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
    <div className="container mx-auto px-6 max-w-4xl">

      {/* Profile Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center gap-8 mb-16">
        <div className="w-32 h-32 md:w-40 md:h-40 bg-[#161c18] rounded-full overflow-hidden border-2 border-white/10 relative shrink-0 flex items-center justify-center">
          <div className="absolute inset-0 bg-gradient-to-br from-[#2f3e35] to-[#0e1210]" />
          <span className="relative text-2xl font-heading text-[#889993] select-none">JD</span>
        </div>
        <div className="flex-1">
          <h1 className="text-4xl font-bold mb-2">Julian Dax</h1>
          <p className="text-lg text-[#d6cdc6] mb-4">Architectural Photographer & Thought Leader</p>
          <p className="text-[#889993] max-w-lg mb-6 leading-relaxed">
            Exploring the intersection of modern design and human psychology.
            Sharing weekly essays, photo studies, and private workshops.
          </p>
          <div className="flex gap-4 text-sm text-[#889993]">
            <span>12.5k Subscribers</span>
            <span>•</span>
            <span>84 Published Essays</span>
          </div>
        </div>
        <button
          onClick={onSubscribe}
          className="bg-[#d6cdc6] text-[#050605] px-6 py-3 rounded-sm font-medium hover:bg-[#e8e2de] transition-colors w-full md:w-auto"
        >
          Subscribe • $12/mo
        </button>
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-12">

        {/* Essays Feed */}
        <div className="md:col-span-2 space-y-12">
          <h2 className="text-2xl font-semibold border-b border-white/10 pb-4 mb-8">Latest Essays</h2>
          {MOCK_ESSAYS.map((essay) => (
            <div key={essay.id} className="group cursor-pointer">
              <div className="aspect-video bg-[#161c18] rounded-lg mb-4 overflow-hidden relative">
                <div className="absolute inset-0 bg-neutral-900 opacity-50 group-hover:opacity-40 transition-opacity" />
              </div>
              <p className="text-xs text-[#d6cdc6] mb-2 uppercase tracking-wider">
                {essay.category} • {essay.readTime}
              </p>
              <h3 className="text-2xl font-bold mb-3 group-hover:text-[#d6cdc6] transition-colors">{essay.title}</h3>
              <p className="text-[#889993] leading-relaxed mb-4">{essay.excerpt}</p>
              <div className="flex items-center text-sm font-medium text-white group-hover:underline decoration-[#d6cdc6]">
                Read full essay <ArrowRight className="ml-2 w-4 h-4" />
              </div>
            </div>
          ))}
        </div>

        {/* Sidebar */}
        <aside className="space-y-8">
          <div className="p-6 border border-white/5 bg-white/[0.02] rounded-xl">
            <div className="flex items-center mb-4 text-[#d6cdc6]">
              <Lock className="w-5 h-5 mr-2" />
              <h3 className="font-semibold">Member Benefits</h3>
            </div>
            <ul className="space-y-3">
              {MOCK_MEMBER_BENEFITS.map((benefit) => (
                <li key={benefit} className="flex items-start text-sm text-[#889993]">
                  <Check className="w-4 h-4 mr-3 mt-0.5 text-[#4E9F76]" />
                  {benefit}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  </motion.div>
);

const AccessView = ({ users, creators, onAuthenticated }) => {
  const [mode, setMode] = useState('login');
  const [role, setRole] = useState('user');
  const [loginEmail, setLoginEmail] = useState('aria@refluenz.app');
  const [loginPassword, setLoginPassword] = useState('user123');
  const [registerId, setRegisterId] = useState('');
  const [error, setError] = useState('');

  const roleAccounts = role === 'user' ? users : creators;

  useEffect(() => {
    if (!roleAccounts.length) return;
    if (!registerId || !roleAccounts.some((account) => account.id === registerId)) {
      setRegisterId(roleAccounts[0].id);
    }
  }, [roleAccounts, registerId]);

  useEffect(() => {
    if (role === 'user') {
      setLoginEmail('aria@refluenz.app');
      setLoginPassword('user123');
    } else {
      setLoginEmail('julian@refluenz.app');
      setLoginPassword('creator123');
    }
  }, [role]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setError('');

    try {
      const response = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, email: loginEmail, password: loginPassword }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setError(payload.error || 'Invalid credentials');
        return;
      }

      onAuthenticated({ role, account: role === 'user' ? payload.user : payload.creator });
    } catch {
      setError('Unable to login. Ensure backend is running on port 4000.');
    }
  };

  const handleMockRegister = (event) => {
    event.preventDefault();
    const account = roleAccounts.find((item) => item.id === registerId);
    if (!account) {
      setError('Please choose a mock account.');
      return;
    }
    onAuthenticated({ role, account });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
      <div className="container mx-auto px-6 max-w-3xl">
        <div className="p-6 md:p-8 border border-white/10 bg-white/[0.02] rounded-xl">
          <h1 className="text-3xl md:text-4xl font-bold mb-2">Login or Register</h1>
          <p className="text-sm text-[#889993] mb-6">Choose your role and continue with mock IDs, just like an Instagram-style entry flow.</p>

          <div className="flex flex-wrap gap-3 mb-6">
            <button
              onClick={() => setMode('login')}
              className={`px-4 py-2 rounded-sm text-sm border ${mode === 'login' ? 'bg-[#d6cdc6] text-[#050605] border-[#d6cdc6]' : 'border-white/20 text-white'}`}
            >
              Login
            </button>
            <button
              onClick={() => setMode('register')}
              className={`px-4 py-2 rounded-sm text-sm border ${mode === 'register' ? 'bg-[#d6cdc6] text-[#050605] border-[#d6cdc6]' : 'border-white/20 text-white'}`}
            >
              Register (Mock)
            </button>
          </div>

          <div className="flex gap-3 mb-6">
            {['user', 'creator'].map((item) => (
              <button
                key={item}
                onClick={() => setRole(item)}
                className={`px-4 py-2 rounded-sm text-sm capitalize border ${role === item ? 'bg-white/10 border-white/30' : 'border-white/10 text-[#889993]'}`}
              >
                {item}
              </button>
            ))}
          </div>

          {mode === 'login' ? (
            <form className="space-y-3" onSubmit={handleLogin}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {roleAccounts.slice(0, 5).map((account) => (
                  <button
                    key={account.id}
                    type="button"
                    onClick={() => {
                      setLoginEmail(account.email);
                      setLoginPassword(role === 'user' ? 'user123' : 'creator123');
                    }}
                    className="text-left p-2 rounded-md border border-white/10 hover:border-white/20"
                  >
                    <p className="text-sm font-medium">{account.name}</p>
                    <p className="text-xs text-[#889993]">{account.email}</p>
                  </button>
                ))}
              </div>
              <input
                className="w-full bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm"
                placeholder="Email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
              />
              <input
                type="password"
                className="w-full bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm"
                placeholder="Password"
                value={loginPassword}
                onChange={(event) => setLoginPassword(event.target.value)}
              />
              <p className="text-xs text-[#889993]">Mock password: {role === 'user' ? 'user123' : 'creator123'}</p>
              {error ? <p className="text-sm text-red-300">{error}</p> : null}
              <button className="inline-flex items-center bg-[#d6cdc6] text-[#050605] px-4 py-2 rounded-sm font-medium">
                <Lock className="w-4 h-4 mr-2" />
                Login as {role}
              </button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={handleMockRegister}>
              <select
                value={registerId}
                onChange={(event) => setRegisterId(event.target.value)}
                className="w-full bg-[#0e1210] border border-white/10 rounded-md px-3 py-2 text-sm"
              >
                {roleAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.name} ({account.email})</option>
                ))}
              </select>
              <p className="text-xs text-[#889993]">Mock register uses seeded IDs and continues directly to dashboard/home feed.</p>
              {error ? <p className="text-sm text-red-300">{error}</p> : null}
              <button className="inline-flex items-center bg-[#d6cdc6] text-[#050605] px-4 py-2 rounded-sm font-medium">
                Continue as {role}
                <ArrowRight className="w-4 h-4 ml-2" />
              </button>
            </form>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const UserDashboard = ({ creators, tiers, sessionUser, onSessionUserChange }) => {
  const [loggedInUser, setLoggedInUser] = useState(sessionUser || null);
  const [dashboard, setDashboard] = useState(null);
  const [payment, setPayment] = useState({ tierId: '', cardName: '', cardNumber: '' });
  const [paymentResult, setPaymentResult] = useState(null);
  const [paymentError, setPaymentError] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [activeStoryId, setActiveStoryId] = useState(null);
  const [seenStoryIds, setSeenStoryIds] = useState([]);
  const storyModalRef = useRef(null);

  useEffect(() => {
    setLoggedInUser(sessionUser || null);
  }, [sessionUser]);

  useEffect(() => {
    if (!tiers.length || payment.tierId) return;
    setPayment((current) => ({ ...current, tierId: tiers[0].id }));
  }, [tiers, payment.tierId]);

  const refreshDashboard = (userId) => {
    if (!userId) return;
    fetch(`${API_BASE}/api/dashboard/user/${userId}`)
      .then((response) => response.json())
      .then((data) => {
        setDashboard(data);
      })
      .catch(() => setDashboard(null));
  };

  useEffect(() => {
    if (loggedInUser?.id) {
      refreshDashboard(loggedInUser.id);
    }
  }, [loggedInUser?.id]);

  const handlePurchaseTier = async (event) => {
    event.preventDefault();
    if (!loggedInUser) return;

    setPaymentResult(null);
    setPaymentError('');

    try {
      const response = await fetch(`${API_BASE}/api/users/${loggedInUser.id}/purchase-tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payment),
      });

      const data = await response.json();
      if (!response.ok) {
        setPaymentError(data.error || 'Payment failed');
        return;
      }

      setPaymentResult(data.payment);
      setLoggedInUser(data.user);
      onSessionUserChange(data.user);
      refreshDashboard(loggedInUser.id);
    } catch {
      setPaymentError('Payment request failed.');
    }
  };

  const handleAvatarUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !loggedInUser) return;

    setAvatarError('');

    try {
      const avatarUrl = await toDataUrl(file);
      const response = await fetch(`${API_BASE}/api/users/${loggedInUser.id}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAvatarError(data.error || 'Unable to upload profile picture.');
        return;
      }
      setLoggedInUser(data.user);
      onSessionUserChange(data.user);
      refreshDashboard(loggedInUser.id);
    } catch {
      setAvatarError('Unable to upload profile picture.');
    }
  };

  if (!loggedInUser) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
        <div className="container mx-auto px-6 max-w-xl">
          <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
            <h1 className="text-3xl font-bold mb-4">User Access Needed</h1>
            <p className="text-sm text-[#889993]">Open the Access page and login/register as a user to continue.</p>
          </div>
        </div>
      </motion.div>
    );
  }

  const stories = (dashboard?.feed || []).filter((item) => item.type === 'story');
  const activeStory = stories.find((story) => story.id === activeStoryId) || null;
  const activeStoryIndex = stories.findIndex((story) => story.id === activeStoryId);
  const openStory = useCallback((story) => {
    setActiveStoryId(story.id);
    setSeenStoryIds((current) => (current.includes(story.id) ? current : [...current, story.id]));
  }, []);
  const openStoryAtIndex = useCallback((index) => {
    if (!stories.length) return;
    const boundedIndex = wrapIndex(index, stories.length);
    openStory(stories[boundedIndex]);
  }, [openStory, stories]);

  useEffect(() => {
    if (!activeStory || !stories.length) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setActiveStoryId(null);
      } else if (event.key === 'ArrowRight') {
        openStoryAtIndex(activeStoryIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        openStoryAtIndex(activeStoryIndex - 1);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeStory, activeStoryIndex, openStoryAtIndex, stories.length]);

  useEffect(() => {
    if (activeStory && storyModalRef.current) {
      storyModalRef.current.focus();
    }
  }, [activeStory]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <h1 className="text-4xl font-bold">User Home Feed</h1>
          <div className="flex items-center gap-3">
            <Avatar url={loggedInUser.avatarUrl} alt={loggedInUser.name} />
            <div>
              <p className="font-semibold">{loggedInUser.name}</p>
              <p className="text-sm text-[#889993]">{loggedInUser.email}</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-5">
            <h2 className="text-2xl font-semibold border-b border-white/10 pb-3">Scrollytelling Feed (Following)</h2>
            <div className="lg:hidden">
              <div className="flex items-center gap-3 overflow-x-auto pb-2">
                {stories.map((story) => {
                  const seen = seenStoryIds.includes(story.id);
                  return (
                    <button
                      key={story.id}
                      onClick={() => openStory(story)}
                      aria-label={`View story from ${story.creator?.name || 'creator'}`}
                      className="flex-shrink-0"
                    >
                      <span
                        className="p-[2px] rounded-full transition-colors block"
                        style={{ border: '2px solid', borderColor: seen ? 'var(--story-ring-seen)' : 'var(--story-ring-unseen)' }}
                      >
                        <Avatar url={story.creator?.avatarUrl} alt={story.creator?.name || 'Story creator'} />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            {(dashboard?.feed || []).filter((item) => item.type === 'post').map((item) => (
              <article key={item.id} className="p-5 border border-white/10 bg-white/[0.02] rounded-lg">
                <div className="flex items-center gap-3 mb-3">
                  {item.creator?.avatarUrl ? <Avatar url={item.creator.avatarUrl} alt={item.creator.name} /> : null}
                  <div>
                    <p className="text-xs uppercase tracking-wider text-[#d6cdc6]">@{item.creator?.name} • followed creator</p>
                    <p className="text-xs text-[#889993]">{item.creator?.niche}</p>
                  </div>
                </div>
                <h3 className="text-xl font-semibold mb-2">{item.title || item.text}</h3>
                {item.body ? <p className="text-[#889993] mb-3">{item.body}</p> : null}
                {item.imageUrl ? <FeedImage src={item.imageUrl} alt={item.title || item.text} className="w-full max-h-[420px] object-cover rounded-md" /> : null}
              </article>
            ))}
          </div>

          <aside className="space-y-5">
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Profile Picture</h3>
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="w-full text-sm text-[#889993]" />
              <p className="text-xs text-[#889993] mt-2">Upload your own profile image or use mock avatars.</p>
              {avatarError ? <p className="text-sm text-red-300 mt-2">{avatarError}</p> : null}
            </div>

            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <div className="flex items-center mb-3 text-[#d6cdc6]">
                <Lock className="w-5 h-5 mr-2" />
                <h3 className="font-semibold">Current Tier</h3>
              </div>
              <p className="text-2xl font-semibold">{dashboard?.tier?.name || '-'}</p>
            </div>

            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Upgrade Tier (Mock Payment)</h3>
              <form className="space-y-2" onSubmit={handlePurchaseTier}>
                <select
                  value={payment.tierId}
                  onChange={(event) => setPayment((current) => ({ ...current, tierId: event.target.value }))}
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-3 py-2 text-sm"
                >
                  {tiers.map((tier) => (
                    <option key={tier.id} value={tier.id}>{tier.name} — ${tier.monthlyPrice}/mo</option>
                  ))}
                </select>
                <input
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-3 py-2 text-sm"
                  placeholder="Cardholder name"
                  value={payment.cardName}
                  onChange={(event) => setPayment((current) => ({ ...current, cardName: event.target.value }))}
                />
                <input
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-3 py-2 text-sm"
                  placeholder="Card number"
                  value={payment.cardNumber}
                  onChange={(event) => setPayment((current) => ({ ...current, cardNumber: event.target.value }))}
                />
                {paymentError ? <p className="text-sm text-red-300">{paymentError}</p> : null}
                {paymentResult ? <p className="text-sm text-[#4E9F76]">Paid mock transaction {paymentResult.transactionId}.</p> : null}
                <button className="inline-flex items-center bg-[#d6cdc6] text-[#050605] px-4 py-2 rounded-sm font-medium text-sm">
                  <CreditCard className="w-4 h-4 mr-2" />
                  Pay & Upgrade
                </button>
              </form>
            </div>

            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Subscribed Creators</h3>
              <ul className="space-y-3">
                {(dashboard?.subscribedCreators || creators).map((creator) => (
                  <li key={creator.id} className="flex items-center gap-2 text-sm text-[#889993]">
                    <Avatar url={creator.avatarUrl} alt={creator.name} />
                    <span>{creator.name} • {creator.niche}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>

        <aside className="hidden lg:flex fixed right-2 top-28 bottom-8 z-40">
          <div
            tabIndex={0}
            role="region"
            aria-label="Story rail"
            className="w-[66px] rounded-full border border-white/10 backdrop-blur-sm py-3 px-2 overflow-y-auto space-y-3"
            style={{ backgroundColor: 'var(--color-surface)' }}
          >
            {stories.map((story) => {
              const seen = seenStoryIds.includes(story.id);
              return (
                <button
                  key={story.id}
                  onClick={() => openStory(story)}
                  onFocus={(event) => event.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
                  title={story.creator?.name || 'Story'}
                  aria-label={`View story from ${story.creator?.name || 'creator'}`}
                  className="w-full flex justify-center"
                >
                  <span
                    className="p-[2px] rounded-full transition-colors"
                    style={{ border: '2px solid', borderColor: seen ? 'var(--story-ring-seen)' : 'var(--story-ring-unseen)' }}
                  >
                    <Avatar url={story.creator?.avatarUrl} alt={story.creator?.name || 'Story creator'} />
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {activeStory ? (
        <div
          className="fixed inset-0 z-50 bg-black/50 backdrop-blur-md flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Story viewer"
          onClick={() => setActiveStoryId(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/20 overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface)' }}
            onClick={(event) => event.stopPropagation()}
            tabIndex={0}
            ref={storyModalRef}
            onKeyDown={(event) => {
              if (event.key !== 'Tab') return;
              const focusable = Array.from(
                event.currentTarget.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
              );
              if (!focusable.length) {
                event.preventDefault();
                return;
              }
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
              }
            }}
          >
            <div className="flex justify-end p-2">
              <button
                type="button"
                onClick={() => setActiveStoryId(null)}
                aria-label="Close story viewer"
                className="rounded-full p-1 border border-white/20"
              >
                <X size={16} />
              </button>
            </div>
            {activeStory.imageUrl ? (
              <FeedImage src={activeStory.imageUrl} alt={activeStory.text || 'Story'} className="w-full h-80 object-cover" />
            ) : null}
            <div className="p-4">
              <p className="text-sm mb-2" style={{ color: 'var(--color-text-muted)' }}>{activeStory.creator?.name}</p>
              <p className="text-base" style={{ color: 'var(--color-text-main)' }}>{activeStory.text || 'Story'}</p>
            </div>
          </div>
        </div>
      ) : null}
    </motion.div>
  );
};

const CreatorDashboard = ({ sessionCreator, onSessionCreatorChange }) => {
  const [selectedCreatorId, setSelectedCreatorId] = useState(sessionCreator?.id || '');
  const [dashboard, setDashboard] = useState(null);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postImageData, setPostImageData] = useState('');
  const [storyText, setStoryText] = useState('');
  const [storyImageUrl, setStoryImageUrl] = useState('');
  const [channelText, setChannelText] = useState('');
  const [uploadHint, setUploadHint] = useState('Drop image here or select from device');
  const [avatarError, setAvatarError] = useState('');

  useEffect(() => {
    setSelectedCreatorId(sessionCreator?.id || '');
  }, [sessionCreator?.id]);

  const refreshDashboard = (creatorId) => {
    fetch(`${API_BASE}/api/dashboard/creator/${creatorId}`)
      .then((response) => response.json())
      .then(setDashboard)
      .catch(() => setDashboard(null));
  };

  useEffect(() => {
    if (selectedCreatorId) {
      refreshDashboard(selectedCreatorId);
    }
  }, [selectedCreatorId]);

  const handlePostImageFile = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await toDataUrl(file);
      setPostImageData(dataUrl);
      setUploadHint(`Selected: ${file.name}`);
    } catch {
      setUploadHint('Unable to read file');
    }
  };

  const handleCreatePost = async (event) => {
    event.preventDefault();
    if (!postTitle.trim() || !postBody.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/api/creators/${selectedCreatorId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: postTitle, body: postBody, imageUrl: postImageData }),
      });
      if (!response.ok) {
        return;
      }
      setPostTitle('');
      setPostBody('');
      setPostImageData('');
      setUploadHint('Drop image here or select from device');
      refreshDashboard(selectedCreatorId);
    } catch {
      return;
    }
  };

  const handleCreateStory = async (event) => {
    event.preventDefault();
    if (!storyText.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/api/creators/${selectedCreatorId}/stories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: storyText, imageUrl: storyImageUrl }),
      });
      if (!response.ok) {
        return;
      }
      setStoryText('');
      setStoryImageUrl('');
      refreshDashboard(selectedCreatorId);
    } catch {
      return;
    }
  };

  const handleChannelPost = async (event) => {
    event.preventDefault();
    if (!channelText.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/api/creators/${selectedCreatorId}/channel-messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: channelText }),
      });
      if (!response.ok) return;
      setChannelText('');
      refreshDashboard(selectedCreatorId);
    } catch {
      return;
    }
  };

  const handleAvatarUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedCreatorId) return;

    setAvatarError('');

    try {
      const avatarUrl = await toDataUrl(file);
      const response = await fetch(`${API_BASE}/api/creators/${selectedCreatorId}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl }),
      });
      const data = await response.json();
      if (!response.ok) {
        setAvatarError(data.error || 'Unable to upload profile picture.');
        return;
      }
      onSessionCreatorChange(data.creator);
      refreshDashboard(selectedCreatorId);
    } catch {
      setAvatarError('Unable to upload profile picture.');
    }
  };

  if (!selectedCreatorId) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
        <div className="container mx-auto px-6 max-w-xl">
          <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
            <h1 className="text-3xl font-bold mb-4">Creator Access Needed</h1>
            <p className="text-sm text-[#889993]">Open the Access page and login/register as a creator to continue.</p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <h1 className="text-4xl font-bold">Creator Dashboard</h1>
          {dashboard?.creator ? (
            <div className="flex items-center gap-3">
              <Avatar url={dashboard.creator.avatarUrl} alt={dashboard.creator.name} />
              <div>
                <p className="font-semibold">{dashboard.creator.name}</p>
                <p className="text-sm text-[#889993]">{dashboard.creator.niche}</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <section className="lg:col-span-2 space-y-8">
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h2 className="text-xl font-semibold mb-4">Publish Post</h2>
              <form className="space-y-3" onSubmit={handleCreatePost}>
                <input
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm"
                  placeholder="Post title"
                  value={postTitle}
                  onChange={(event) => setPostTitle(event.target.value)}
                />
                <textarea
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm h-24"
                  placeholder="Post body"
                  value={postBody}
                  onChange={(event) => setPostBody(event.target.value)}
                />
                <label
                  className="block border border-dashed border-white/20 rounded-md p-4 text-sm text-[#889993]"
                  onDrop={(event) => {
                    event.preventDefault();
                    handlePostImageFile(event.dataTransfer.files?.[0]);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                >
                  <div className="flex items-center gap-2 mb-2 text-white">
                    <ImagePlus className="w-4 h-4" />
                    Post image upload
                  </div>
                  <p>{uploadHint}</p>
                  <input type="file" accept="image/*" className="mt-3 text-xs" onChange={(event) => handlePostImageFile(event.target.files?.[0])} />
                  {postImageData ? <FeedImage src={postImageData} alt="Upload preview" className="w-full h-40 object-cover rounded-md mt-3" /> : null}
                </label>
                <button className="inline-flex items-center bg-[#d6cdc6] text-[#050605] px-4 py-2 rounded-sm font-medium">
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Publish Post
                </button>
              </form>
            </div>

            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h2 className="text-xl font-semibold mb-4">Publish Story</h2>
              <form className="space-y-3" onSubmit={handleCreateStory}>
                <textarea
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm h-20"
                  placeholder="Story text"
                  value={storyText}
                  onChange={(event) => setStoryText(event.target.value)}
                />
                <input
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm"
                  placeholder="Story image URL"
                  value={storyImageUrl}
                  onChange={(event) => setStoryImageUrl(event.target.value)}
                />
                <button className="inline-flex items-center border border-white/20 px-4 py-2 rounded-sm font-medium">
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Publish Story
                </button>
              </form>
            </div>

            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <div className="flex items-center gap-2 mb-4">
                <MessageSquare className="w-5 h-5 text-[#d6cdc6]" />
                <h2 className="text-xl font-semibold">Creator Text Channel</h2>
              </div>
              <form className="space-y-3" onSubmit={handleChannelPost}>
                <textarea
                  className="w-full bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm h-20"
                  placeholder="Share an update with your channel"
                  value={channelText}
                  onChange={(event) => setChannelText(event.target.value)}
                />
                <button className="inline-flex items-center border border-white/20 px-4 py-2 rounded-sm font-medium">
                  <Upload className="w-4 h-4 mr-2" />
                  Post to Channel
                </button>
              </form>
              <ul className="space-y-3 mt-4">
                {(dashboard?.channelMessages || []).slice(0, 6).map((message) => (
                  <li key={message.id} className="text-sm border border-white/10 rounded-md p-3 text-[#889993]">
                    {message.text}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <aside className="space-y-5">
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Profile Picture</h3>
              <input type="file" accept="image/*" onChange={handleAvatarUpload} className="w-full text-sm text-[#889993]" />
              <p className="text-xs text-[#889993] mt-2">Upload your own profile image or use the seeded mock profile pictures.</p>
              {avatarError ? <p className="text-sm text-red-300 mt-2">{avatarError}</p> : null}
            </div>

            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Recent Posts</h3>
              <ul className="space-y-4">
                {(dashboard?.posts || []).slice(0, 5).map((post) => (
                  <li key={post.id} className="text-sm text-[#889993]">
                    {post.imageUrl ? <FeedImage src={post.imageUrl} alt={post.title} className="w-full h-24 object-cover rounded-md mb-2" /> : null}
                    <p className="text-white">{post.title}</p>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Recent Stories</h3>
              <ul className="space-y-4">
                {(dashboard?.stories || []).slice(0, 5).map((story) => (
                  <li key={story.id} className="text-sm text-[#889993]">
                    {story.imageUrl ? <FeedImage src={story.imageUrl} alt={story.text} className="w-full h-24 object-cover rounded-md mb-2" /> : null}
                    {story.text}
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </motion.div>
  );
};

const App = () => {
  const [view, setView] = useState('landing');
  const [theme, setTheme] = useState('dark');
  const [users, setUsers] = useState([]);
  const [creators, setCreators] = useState([]);
  const [tiers, setTiers] = useState([]);
  const [session, setSession] = useState(null);

  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/users`).then((response) => response.json()),
      fetch(`${API_BASE}/api/creators`).then((response) => response.json()),
      fetch(`${API_BASE}/api/subscription-tiers`).then((response) => response.json()),
    ])
      .then(([usersData, creatorsData, tiersData]) => {
        setUsers(usersData.users || []);
        setCreators(creatorsData.creators || []);
        setTiers(tiersData.tiers || []);
      })
      .catch(() => {
        setUsers([]);
        setCreators([]);
        setTiers([]);
      });
  }, []);

  useEffect(() => {
    const tokens = THEME_TOKENS[theme] || THEME_TOKENS.dark;
    Object.entries(tokens).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }, [theme]);

  const viewNode = useMemo(() => {
    if (view === 'user') {
      return (
        <UserDashboard
          key="user"
          creators={creators}
          tiers={tiers}
          sessionUser={session?.role === 'user' ? session.account : null}
          onSessionUserChange={(account) => setSession({ role: 'user', account })}
        />
      );
    }
    if (view === 'creator') {
      return (
        <CreatorDashboard
          key="creator"
          sessionCreator={session?.role === 'creator' ? session.account : null}
          onSessionCreatorChange={(account) => setSession({ role: 'creator', account })}
        />
      );
    }
    if (view === 'profile') {
      return <ProfileView key="profile" onSubscribe={() => setView('auth')} />;
    }
    if (view === 'landing') {
      return <LandingView key="landing" onViewChange={setView} tiers={tiers} />;
    }
    return (
      <AccessView
        key="auth"
        users={users}
        creators={creators}
        onAuthenticated={(nextSession) => {
          setSession(nextSession);
          setView(nextSession.role === 'user' ? 'user' : 'creator');
        }}
      />
    );
  }, [view, creators, tiers, users, session]);

  return (
    <div className="min-h-screen">
      <Navbar onViewChange={setView} currentView={view} theme={theme} onThemeChange={setTheme} />
      <AnimatePresence mode="wait">{viewNode}</AnimatePresence>
      <footer className="py-12 border-t border-white/5 mt-auto">
        <div className="container mx-auto px-6 text-center text-[#889993] text-sm">
          <p>© 2026 REfluenz. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;
