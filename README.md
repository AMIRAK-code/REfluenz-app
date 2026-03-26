# REfluenz

A platform for creators who value depth over reach.

## Design Philosophy

- **Aesthetic**: "Adult Money" Energy. Calm, Confident, Professional.
- **Palette**: Deep Forest Green, Charcoal, Champagne/Sand.
- **Typography**: Outfit (Headings), Inter (Body).

## Tech Stack

- **Framework**: React + Vite
- **Styling**: Vanilla CSS (Variables + Flexbox/Grid) + Framer Motion (Animations)
- **Icons**: Lucide React

## Getting Started

1. Install dependencies (if not already installed):
   ```bash
   npm install
   ```

2. Start the backend API (serves mock users, creators, tiers, posts, stories, and mock auth/payment):
   ```bash
   npm run server
   ```

3. Run the frontend development server:
   ```bash
   npm run dev
   ```

4. Build for production:
   ```bash
   npm run build
   ```

## MVP API (Mock Data)

- `GET /api/users` → 5 mock users
- `GET /api/creators` → 5 mock creators
- `GET /api/subscription-tiers` → 3 subscription tiers
- `POST /api/auth/login` → mock login for `user` or `creator` role
- `GET /api/dashboard/user/:id` → user dashboard feed (posts + stories)
- `GET /api/dashboard/creator/:id` → creator dashboard data
- `POST /api/creators/:id/posts` → creator post publishing
- `POST /api/creators/:id/stories` → creator story publishing
- `POST /api/users/:id/purchase-tier` → mock subscription purchase with mock payment response

### Mock Credentials

- User: `aria@refluenz.app` / `user123`
- Creator: `julian@refluenz.app` / `creator123`
