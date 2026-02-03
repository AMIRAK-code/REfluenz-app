import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, TrendingUp, Users, ArrowRight, Lock, Check, Zap, Menu, X } from 'lucide-react';

const Navbar = ({ onViewChange, currentView }) => {
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    return (
        <nav className="fixed top-0 left-0 right-0 z-50 transition-all duration-300 backdrop-blur-md border-b border-white/5 bg-opacity-80 bg-[#050605]">
            <div className="container mx-auto px-6 h-20 flex items-center justify-between">
                <div
                    className="text-2xl font-bold font-heading tracking-tight cursor-pointer"
                    onClick={() => onViewChange('landing')}
                >
                    REfluenz<span className="text-[#d6cdc6]">.</span>
                </div>

                <div className="hidden md:flex items-center space-x-8">
                    <button onClick={() => onViewChange('landing')} className={`text-sm font-medium transition-colors ${currentView === 'landing' ? 'text-white' : 'text-[#889993] hover:text-white'}`}>Platform</button>
                    <button onClick={() => onViewChange('profile')} className={`text-sm font-medium transition-colors ${currentView === 'profile' ? 'text-white' : 'text-[#889993] hover:text-white'}`}>Explore Creators</button>
                    <a href="#" className="text-sm font-medium text-[#889993] hover:text-white transition-colors">Pricing</a>
                    <button className="text-sm font-medium bg-[#d6cdc6] text-[#050605] px-5 py-2.5 rounded-sm hover:bg-[#e8e2de] transition-all">
                        Get Started
                    </button>
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

const Hero = ({ onViewChange }) => {
    return (
        <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
            <div className="container mx-auto px-6 relative z-10">
                <motion.div
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                    className="max-w-3xl"
                >
                    <div className="inline-flex items-center space-x-2 bg-white/5 border border-white/10 rounded-full px-3 py-1 mb-8">
                        <span className="w-2 h-2 rounded-full bg-[#d6cdc6]"></span>
                        <span className="text-xs font-medium text-[#d6cdc6] tracking-wide uppercase">Private Beta Access</span>
                    </div>

                    <h1 className="text-5xl md:text-7xl font-bold mb-6 leading-tight">
                        Influence with <br />
                        <span className="text-[#889993]">Intent.</span>
                    </h1>

                    <p className="text-lg md:text-xl text-[#889993] mb-10 max-w-xl leading-relaxed">
                        The platform for creators who value depth over reach. Build a sustainable business on your terms, without the noise.
                    </p>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center space-y-4 sm:space-y-0 sm:space-x-4">
                        <button
                            onClick={() => onViewChange('profile')}
                            className="bg-[#d6cdc6] text-[#050605] px-8 py-3.5 rounded-sm font-medium text-lg hover:bg-[#e8e2de] transition-colors flex items-center"
                        >
                            View Creator Demo
                            <ArrowRight className="ml-2 w-4 h-4" />
                        </button>
                        <button className="px-8 py-3.5 rounded-sm font-medium text-lg border border-white/20 text-white hover:border-white/40 transition-colors">
                            Request Access
                        </button>
                    </div>
                </motion.div>
            </div>

            {/* Abstract Background Element */}
            <div className="absolute top-0 right-0 w-[50%] h-full bg-gradient-to-b from-[#0e1210] to-[#050605] opacity-50 -z-10 pointer-events-none" />
            <div className="absolute top-20 right-[-10%] w-[600px] h-[600px] bg-[#d6cdc6] rounded-full blur-[120px] opacity-5 mix-blend-screen pointer-events-none"></div>
        </section>
    );
};

const FeatureItem = ({ icon: Icon, title, desc }) => (
    <div className="p-8 border border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-colors rounded-xl">
        <div className="w-12 h-12 flex items-center justify-center bg-[#161c18] rounded-lg mb-6 text-[#d6cdc6]">
            <Icon size={24} />
        </div>
        <h3 className="text-xl font-semibold mb-3">{title}</h3>
        <p className="text-[#889993] leading-relaxed">{desc}</p>
    </div>
);

const Features = () => {
    return (
        <section className="py-24 border-t border-white/5">
            <div className="container mx-auto px-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <FeatureItem
                        icon={Shield}
                        title="Creator Sovereignty"
                        desc="You own your audience data. No algorithm roulette. Direct connection, always."
                    />
                    <FeatureItem
                        icon={TrendingUp}
                        title="Sustainable Growth"
                        desc="Tools designed for long-term retention, not just viral spikes. Predictable revenue."
                    />
                    <FeatureItem
                        icon={Users}
                        title="Curated Community"
                        desc="A noise-free environment for your most dedicated followers to engage deeply."
                    />
                </div>
            </div>
        </section>
    );
};

const ProfileView = () => {
    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pt-32 pb-20 min-h-screen"
        >
            <div className="container mx-auto px-6 max-w-4xl">
                {/* Profile Header */}
                <div className="flex flex-col md:flex-row items-start md:items-center gap-8 mb-16">
                    <div className="w-32 h-32 md:w-40 md:h-40 bg-[#161c18] rounded-full overflow-hidden border-2 border-white/10 relative">
                        {/* Gradient placeholder for avatar */}
                        <div className="absolute inset-0 bg-gradient-to-br from-[#2f3e35] to-[#0e1210]"></div>
                        <div className="absolute inset-0 flex items-center justify-center text-2xl font-heading text-[#889993]">JD</div>
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
                    <button className="bg-[#d6cdc6] text-[#050605] px-6 py-3 rounded-sm font-medium hover:bg-[#e8e2de] transition-colors w-full md:w-auto">
                        Subscribe • $12/mo
                    </button>
                </div>

                {/* Content Section */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                    {/* Main Feed */}
                    <div className="md:col-span-2 space-y-12">
                        <h2 className="text-2xl font-semibold border-b border-white/10 pb-4 mb-8">Latest Essays</h2>

                        {[1, 2, 3].map((item) => (
                            <div key={item} className="group cursor-pointer">
                                <div className="aspect-[16/9] bg-[#161c18] rounded-lg mb-4 overflow-hidden relative">
                                    {/* Abstract placeholder */}
                                    <div className="absolute inset-0 bg-neutral-900 opacity-50 group-hover:opacity-40 transition-opacity"></div>
                                </div>
                                <div className="text-xs text-[#d6cdc6] mb-2 uppercase tracking-wider">Architecture • 5 min read</div>
                                <h3 className="text-2xl font-bold mb-3 group-hover:text-[#d6cdc6] transition-colors">
                                    The Psychology of Brutalist Spaces
                                </h3>
                                <p className="text-[#889993] leading-relaxed mb-4">
                                    Why do we feel calm in concrete? Looking at the raw honesty of materials and how they affect our cognitive load...
                                </p>
                                <div className="flex items-center text-sm font-medium text-white group-hover:underline decoration-[#d6cdc6]">
                                    Read full essay <ArrowRight className="ml-2 w-4 h-4" />
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Sidebar */}
                    <div className="space-y-8">
                        <div className="p-6 border border-white/5 bg-white/[0.02] rounded-xl">
                            <div className="flex items-center mb-4 text-[#d6cdc6]">
                                <Lock className="w-5 h-5 mr-2" />
                                <h3 className="font-semibold">Member Benefits</h3>
                            </div>
                            <ul className="space-y-3">
                                {['Weekly Deep Dives', 'High-Res Image Library', 'Monthly Q&A Calls', 'Community Discord'].map((benefit, i) => (
                                    <li key={i} className="flex items-start text-sm text-[#889993]">
                                        <Check className="w-4 h-4 mr-3 mt-1 text-[#4E9F76]" />
                                        {benefit}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        </motion.div>
    );
};

const App = () => {
    const [view, setView] = useState('landing'); // 'landing' | 'profile'

    return (
        <div className="min-h-screen">
            <Navbar onViewChange={setView} currentView={view} />

            <AnimatePresence mode="wait">
                {view === 'landing' ? (
                    <motion.div
                        key="landing"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.5 }}
                    >
                        <Hero onViewChange={setView} />
                        <Features />
                    </motion.div>
                ) : (
                    <ProfileView key="profile" />
                )}
            </AnimatePresence>

            <footer className="py-12 border-t border-white/5 mt-auto">
                <div className="container mx-auto px-6 text-center text-[#889993] text-sm">
                    <p>© 2024 REfluenz. All rights reserved.</p>
                </div>
            </footer>
        </div>
    );
};

export default App;
