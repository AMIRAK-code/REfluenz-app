import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Lock, Menu, PlusCircle, Shield, TrendingUp, Users, X } from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000';

const Navbar = ({ onViewChange, currentView }) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const links = [
    { key: 'landing', label: 'Platform' },
    { key: 'user', label: 'User Dashboard' },
    { key: 'creator', label: 'Creator Dashboard' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 backdrop-blur-md border-b border-white/5 bg-opacity-80 bg-[#050605]">
      <div className="container mx-auto px-6 h-20 flex items-center justify-between">
        <button className="text-2xl font-bold font-heading tracking-tight" onClick={() => onViewChange('landing')}>
          REfluenz<span className="text-[#d6cdc6]">.</span>
        </button>

        <div className="hidden md:flex items-center space-x-8">
          {links.map((link) => (
            <button
              key={link.key}
              onClick={() => onViewChange(link.key)}
              className={`text-sm font-medium transition-colors ${currentView === link.key ? 'text-white' : 'text-[#889993] hover:text-white'}`}
            >
              {link.label}
            </button>
          ))}
        </div>

        <div className="md:hidden">
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="text-white">
            {mobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
        </div>
      </div>
    </nav>
  );
};

const LandingView = ({ onViewChange, tiers }) => (
  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20">
    <section className="relative pb-20 md:pb-24 overflow-hidden border-b border-white/5">
      <div className="container mx-auto px-6 relative z-10">
        <div className="max-w-3xl">
          <div className="inline-flex items-center space-x-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 mb-8">
            <span className="w-2 h-2 rounded-full bg-[#d6cdc6]" />
            <span className="text-xs font-medium text-[#d6cdc6] tracking-wide uppercase">MVP Ready</span>
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
            Premium creator
            <br />
            <span className="text-[#889993]">membership platform.</span>
          </h1>
          <p className="text-lg md:text-xl text-[#889993] mb-10 max-w-xl leading-relaxed">
            Fast, robust, and minimal. Users get a curated viewing experience while creators publish posts and stories from a focused command center.
          </p>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <button
              onClick={() => onViewChange('user')}
              className="bg-[#d6cdc6] text-[#050605] px-8 py-3.5 rounded-sm font-medium text-lg hover:bg-[#e8e2de] transition-colors flex items-center"
            >
              Open User Dashboard
              <ArrowRight className="ml-2 w-4 h-4" />
            </button>
            <button
              onClick={() => onViewChange('creator')}
              className="px-8 py-3.5 rounded-sm font-medium text-lg border border-white/20 text-white hover:border-white/40 transition-colors"
            >
              Open Creator Dashboard
            </button>
          </div>
        </div>
      </div>
      <div className="absolute top-20 right-[-10%] w-[600px] h-[600px] bg-[#d6cdc6] rounded-full blur-[120px] opacity-5 mix-blend-screen pointer-events-none" />
    </section>

    <section className="py-20 border-b border-white/5">
      <div className="container mx-auto px-6 grid grid-cols-1 md:grid-cols-3 gap-8">
        {[
          { icon: Shield, title: 'Robust Foundations', desc: 'Node backend with stable JSON endpoints for dashboards, content, and subscriptions.' },
          { icon: TrendingUp, title: 'MVP Performance', desc: 'Small in-memory model for fast iteration while preserving production-minded API boundaries.' },
          { icon: Users, title: 'Dual Dashboards', desc: 'Tailored UX for users and creators with data-backed views and streamlined workflows.' },
        ].map((item) => (
          <div key={item.title} className="p-8 border border-white/5 bg-white/[0.02] rounded-xl">
            <div className="w-12 h-12 flex items-center justify-center bg-[#161c18] rounded-lg mb-6 text-[#d6cdc6]">
              <item.icon size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-3">{item.title}</h3>
            <p className="text-[#889993] leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </section>

    <section className="py-20">
      <div className="container mx-auto px-6">
        <h2 className="text-3xl font-bold mb-8">Subscription Tiers</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {tiers.map((tier) => (
            <div key={tier.id} className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <p className="text-[#d6cdc6] text-sm uppercase tracking-wider mb-2">{tier.name}</p>
              <p className="text-4xl font-bold mb-4">${tier.monthlyPrice}<span className="text-sm text-[#889993]">/mo</span></p>
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

const UserDashboard = ({ users, creators, tiers }) => {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [dashboard, setDashboard] = useState(null);

  useEffect(() => {
    if (users.length && !selectedUserId) {
      setSelectedUserId(users[0].id);
    }
  }, [users, selectedUserId]);

  useEffect(() => {
    if (!selectedUserId) return;
    fetch(`${API_BASE}/api/dashboard/user/${selectedUserId}`)
      .then((response) => response.json())
      .then(setDashboard)
      .catch(() => setDashboard(null));
  }, [selectedUserId]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <h1 className="text-4xl font-bold">User Dashboard</h1>
          <select
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            className="bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm"
          >
            {users.map((user) => (
              <option value={user.id} key={user.id}>{user.name}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-5">
            <h2 className="text-2xl font-semibold border-b border-white/10 pb-3">Content Feed</h2>
            {(dashboard?.feed || []).map((item) => (
              <article key={item.id} className="p-5 border border-white/10 bg-white/[0.02] rounded-lg">
                <p className="text-xs uppercase tracking-wider text-[#d6cdc6] mb-2">{item.type} • {item.creator?.name}</p>
                <h3 className="text-xl font-semibold mb-2">{item.title || item.text}</h3>
                {item.body ? <p className="text-[#889993]">{item.body}</p> : null}
              </article>
            ))}
          </div>
          <aside className="space-y-5">
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <div className="flex items-center mb-3 text-[#d6cdc6]">
                <Lock className="w-5 h-5 mr-2" />
                <h3 className="font-semibold">Current Tier</h3>
              </div>
              <p className="text-2xl font-semibold">{dashboard?.tier?.name || '-'}</p>
            </div>
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Available Creators</h3>
              <ul className="space-y-2">
                {creators.map((creator) => (
                  <li key={creator.id} className="text-sm text-[#889993]">{creator.name} • {creator.niche}</li>
                ))}
              </ul>
            </div>
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Upgrade Options</h3>
              <ul className="space-y-2">
                {tiers.map((tier) => (
                  <li key={tier.id} className="text-sm text-[#889993]">{tier.name} — ${tier.monthlyPrice}/mo</li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </motion.div>
  );
};

const CreatorDashboard = ({ creators }) => {
  const [selectedCreatorId, setSelectedCreatorId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [storyText, setStoryText] = useState('');

  const refreshDashboard = (creatorId) => {
    fetch(`${API_BASE}/api/dashboard/creator/${creatorId}`)
      .then((response) => response.json())
      .then(setDashboard)
      .catch(() => setDashboard(null));
  };

  useEffect(() => {
    if (creators.length && !selectedCreatorId) {
      setSelectedCreatorId(creators[0].id);
    }
  }, [creators, selectedCreatorId]);

  useEffect(() => {
    if (selectedCreatorId) {
      refreshDashboard(selectedCreatorId);
    }
  }, [selectedCreatorId]);

  const handleCreatePost = async (event) => {
    event.preventDefault();
    if (!postTitle.trim() || !postBody.trim()) return;

    try {
      const response = await fetch(`${API_BASE}/api/creators/${selectedCreatorId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: postTitle, body: postBody }),
      });
      if (!response.ok) {
        return;
      }
      setPostTitle('');
      setPostBody('');
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
        body: JSON.stringify({ text: storyText }),
      });
      if (!response.ok) {
        return;
      }
      setStoryText('');
      refreshDashboard(selectedCreatorId);
    } catch {
      return;
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pt-32 pb-20 min-h-screen">
      <div className="container mx-auto px-6 max-w-6xl">
        <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
          <h1 className="text-4xl font-bold">Creator Dashboard</h1>
          <select
            value={selectedCreatorId}
            onChange={(event) => setSelectedCreatorId(event.target.value)}
            className="bg-[#0e1210] border border-white/10 rounded-md px-4 py-2 text-sm"
          >
            {creators.map((creator) => (
              <option value={creator.id} key={creator.id}>{creator.name}</option>
            ))}
          </select>
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
                <button className="inline-flex items-center border border-white/20 px-4 py-2 rounded-sm font-medium">
                  <PlusCircle className="w-4 h-4 mr-2" />
                  Publish Story
                </button>
              </form>
            </div>
          </section>

          <aside className="space-y-5">
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Recent Posts</h3>
              <ul className="space-y-2">
                {(dashboard?.posts || []).slice(0, 5).map((post) => (
                  <li key={post.id} className="text-sm text-[#889993]">{post.title}</li>
                ))}
              </ul>
            </div>
            <div className="p-6 border border-white/10 bg-white/[0.02] rounded-xl">
              <h3 className="font-semibold mb-3">Recent Stories</h3>
              <ul className="space-y-2">
                {(dashboard?.stories || []).slice(0, 5).map((story) => (
                  <li key={story.id} className="text-sm text-[#889993]">{story.text}</li>
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
  const [users, setUsers] = useState([]);
  const [creators, setCreators] = useState([]);
  const [tiers, setTiers] = useState([]);

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

  const viewNode = useMemo(() => {
    if (view === 'user') {
      return <UserDashboard key="user" users={users} creators={creators} tiers={tiers} />;
    }
    if (view === 'creator') {
      return <CreatorDashboard key="creator" creators={creators} />;
    }
    return <LandingView key="landing" onViewChange={setView} tiers={tiers} />;
  }, [view, users, creators, tiers]);

  return (
    <div className="min-h-screen">
      <Navbar onViewChange={setView} currentView={view} />
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
