# RoMinion Discord Bot

Real-time Roblox hidden gem alerts, delivered to your Discord.

---

## What it does

Runs every 15 minutes. Checks your Supabase `game_metrics` table for:
- 💎 Games that just hit Diamond tier
- 🆕 Brand new hidden gems just indexed
- 📈 Games whose Gem Score jumped 5+ points
- 📉 Games whose Gem Score dropped 5+ points
- 🔥 Games with a 50%+ CCU spike in 15 minutes
- ⚠️ Games whose developer has gone quiet (90+ days no update)

Sends Discord DMs or channel messages to users based on their plan:
- **Studio ($99/mo):** 5 alerts/week
- **Mogul ($299/mo):** Unlimited alerts

---

## Setup (15 minutes)

### Step 1: Create the Discord Bot

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications)
2. "New Application" → name it "RoMinion"
3. Left sidebar → "Bot" → "Add Bot"
4. Copy the **Bot Token** → paste into `.env` as `DISCORD_TOKEN`
5. Left sidebar → "General Information" → copy **Application ID** → paste as `DISCORD_CLIENT_ID`
6. Left sidebar → "Bot" → enable:
   - Server Members Intent
   - Message Content Intent
7. Left sidebar → "OAuth2" → "URL Generator":
   - Scopes: `bot`, `applications.commands`
   - Permissions: `Send Messages`, `Use Slash Commands`, `Send Messages in Threads`
   - Copy the generated URL → open it → add the bot to your server

### Step 2: Supabase setup

Run `supabase_migration.sql` in your Supabase SQL editor.
This creates: `discord_connections`, `alert_log`, `gem_score_alerts_baseline`.

### Step 3: Environment variables

```bash
cp .env.example .env
# Fill in DISCORD_TOKEN, DISCORD_CLIENT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
```

### Step 4: Install and run

```bash
npm install

# Register slash commands (run once)
npm run register

# Start the bot
npm start
```

### Step 5: Deploy to Railway (alongside the API)

1. In your Railway project → "New Service" → "GitHub Repo" (same repo)
2. Set root directory to `/rominion-bot`
3. Add the same env vars
4. Override start command: `npm start`

The bot runs 24/7, checking every 15 minutes alongside the scanner.

---

## Slash Commands

| Command | What it does |
|---|---|
| `/link email` | Links your Discord to your RoMinion account |
| `/alerts status` | Shows your current alert settings |
| `/alerts on` | Turns all alerts on |
| `/alerts off` | Turns all alerts off |
| `/alerts types` | Toggle individual alert types |
| `/gem [name]` | Look up any Roblox game's Gem Score |
| `/top [count]` | See today's top hidden gems (max 10) |
| `/watchlist` | See your saved games from RoMinion |
| `/unlink` | Disconnect your Discord from RoMinion |

---

## Alert types

| Type | Trigger |
|---|---|
| New Diamond | Game just hit 80+ Gem Score |
| New Hidden Gem | Game just appeared in the database |
| Score Up | Gem Score increased by 5+ |
| Score Down | Gem Score dropped by 5+ |
| CCU Spike | Player count spiked 50%+ in 15 min |
| Dev Going Quiet | No update in 90+ days |

---

## Plan limits

| Plan | Alerts/week |
|---|---|
| Scout | ❌ Not available |
| Acquirer | ❌ Not available |
| Studio | 5/week |
| Mogul | Unlimited |

---

## File structure

```
rominion-bot/
├── src/
│   ├── index.js              # Bot entry point, event handlers
│   ├── alertEngine.js        # Runs every 15 min, fires alerts
│   ├── alerts.js             # Discord embed builders (the messages)
│   ├── commands.js           # Slash command handlers
│   └── registerCommands.js   # One-time command registration
├── supabase_migration.sql    # Run in Supabase SQL editor
├── package.json
├── .env.example
└── README.md
```
