# Nightfall: Last Survivors (Next.js)

## Project overview
Nightfall: Last Survivors is a multiplayer-capable 3D survival game built with **Next.js 14 + React + TypeScript + Three.js**.

Core features include:
- Real-time play loop (gather/craft/build/survive)
- Multiplayer server rooms with presence/ghost syncing
- Persistent saves via Prisma + PostgreSQL
- Optional desktop launcher packaging via Electron

Project root:
- `/home/ubuntu/nightfall_last_survivors/nextjs_space`

---

## File structure (important paths)

```text
nextjs_space/
├─ app/
│  ├─ page.tsx                     # Home page
│  ├─ play/                        # Main game client + canvas engine + HUD/inventory/build UI
│  └─ api/                         # Save/server/presence/world/version APIs
├─ lib/
│  ├─ game/                        # Game store, types, items, audio, logic helpers
│  ├─ auth.ts                      # NextAuth config
│  └─ db.ts                        # Prisma client setup
├─ prisma/
│  └─ schema.prisma                # DB schema
├─ public/
│  ├─ items/                       # Item icons/assets
│  ├─ branding/                    # Brand/logo/icon assets
│  └─ downloads/                   # Published desktop launcher artifacts
├─ desktop/                        # Electron desktop wrapper
├─ scripts/                        # Build/publish helper scripts
├─ next.config.js
└─ package.json
```

---

## Local development

### Prerequisites
- Node.js 20+ (project currently runs with Node 22 in this VM)
- npm 10+
- PostgreSQL database reachable from the app

### Environment variables
Create `.env` with at least:

```bash
DATABASE_URL="postgresql://..."
NEXTAUTH_SECRET="your-random-secret"
# for deployed auth callbacks + metadata links
NEXTAUTH_URL="https://your-domain.com"
```

### Install and run
```bash
cd /home/ubuntu/nightfall_last_survivors/nextjs_space
npm install
npx prisma generate
npm run dev
```

The app runs on port `3000` by default.

---

## Preview URL (Abacus AI Agent VM)

When running in Abacus AI Agent VM, use:

```bash
echo $PREVIEW_URL
```

Current VM preview URL:
- `https://128a8e9754.na103.preview.abacusai.app`

Important:
- This preview URL is tied to the VM lifecycle (it stops working when the VM goes inactive).
- If the server is not running, start it again from project root.
- For the VM browser, `http://localhost:3000` works directly.

---

## Keep preview available without retyping commands every time

From project root, run a background dev server:

```bash
nohup ./node_modules/.bin/next dev -H 0.0.0.0 -p 3000 > /home/ubuntu/nightfall_next_dev.log 2>&1 < /dev/null &
```

Check it:

```bash
ss -ltnp | grep ':3000'
curl -I http://127.0.0.1:3000
```

Stop it (if needed):

```bash
pkill -f "next dev -H 0.0.0.0 -p 3000"
```

---

## Permanent deployment options

## 1) Vercel (recommended for Next.js)

### Why this is a good fit
- Native Next.js hosting
- Easy Git-based CI/CD
- Simple environment variable management

### Steps
1. Push this project to GitHub/GitLab/Bitbucket.
2. Import repo into Vercel.
3. Set framework preset to Next.js.
4. Add env vars in Vercel project settings:
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` = your Vercel production URL (or custom domain)
5. Build command: `npm run build`
6. Start command: `npm run start`
7. After first deploy, run Prisma migrations against production DB:
   - Prefer adding a deploy step with `npx prisma migrate deploy`

### Notes
- You need a persistent external Postgres (Neon/Supabase/Railway Postgres/etc).
- If using auth providers later, also configure provider callback URLs.

---

## 2) Railway (good full-stack option)

### Steps
1. Create new Railway project from your repo.
2. Add a PostgreSQL service (or connect existing DB).
3. Add env vars:
   - `DATABASE_URL`
   - `NEXTAUTH_SECRET`
   - `NEXTAUTH_URL` (your Railway app URL/custom domain)
4. Build command: `npm run build`
5. Start command: `npm run start`
6. Add migration step (predeploy or release command):
   - `npx prisma migrate deploy`

### Notes
- Railway can host both app and DB in one platform.
- Confirm DB networking rules allow app access.

---

## 3) Other platforms

### Render
- Web Service with Node runtime
- Same env vars + `npm run build` / `npm run start`
- Add migration step `npx prisma migrate deploy`

### Fly.io / VPS / Docker
- Works well for long-running multiplayer workloads
- Requires your own process + DB + TLS + monitoring setup

---

## Desktop launcher deployment flow (optional)

If you want downloadable Windows launcher artifacts served by the web app:

```bash
npm run dist:win:publish
```

This:
1. Builds portable Windows exe
2. Copies it into `public/downloads/`
3. Generates `public/downloads/launcher-manifest.json`

Then `/download` page can expose latest launcher metadata.

---

## Continue development in a new Abacus AI Agent conversation

When opening a new conversation, paste something like:

```text
Continue my Nightfall: Last Survivors project.
Project path: /home/ubuntu/nightfall_last_survivors/nextjs_space
Please first run git status, review README.md, then restart dev server and verify preview URL.
Context: This is a Next.js + Prisma + Three.js multiplayer survival game. Keep existing game logic and focus only on requested changes.
```

Also include:
- What you were working on last (feature/bug/task)
- Any files recently changed
- Whether you need local preview only or permanent deployment changes
- Any runtime issues from logs

Recommended startup checklist for the new agent:
1. `cd /home/ubuntu/nightfall_last_survivors/nextjs_space`
2. `git status`
3. Read `README.md`
4. Start or verify server (`next dev -H 0.0.0.0 -p 3000`)
5. Confirm `echo $PREVIEW_URL`

---

## Deployment checklist (quick)
- [ ] Code pushed to remote git repo
- [ ] Production Postgres ready
- [ ] `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` set in host
- [ ] Prisma migrations applied (`npx prisma migrate deploy`)
- [ ] Production URL tested (`/`, `/play`, `/api/version`)
- [ ] Multiplayer save/join/presence endpoints verified

---

## Notes on persistence
- Abacus VM preview is temporary (session/VM lifecycle).
- For permanent public access, deploy to Vercel/Railway/Render/Fly/VPS.
- Keep this README updated as scripts or deployment flow evolve.
