-- Run this in your Supabase SQL editor

-- Links a Discord user to a RoMinion account
CREATE TABLE IF NOT EXISTS discord_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_username TEXT,
  discord_dm_channel_id TEXT,       -- for DM alerts
  guild_id TEXT,                     -- server they linked from
  channel_id TEXT,                   -- channel for server alerts
  alert_new_diamond BOOLEAN DEFAULT true,
  alert_score_change BOOLEAN DEFAULT true,
  alert_ccu_spike BOOLEAN DEFAULT true,
  alert_new_gem BOOLEAN DEFAULT true,
  alert_dev_slowing BOOLEAN DEFAULT false,
  alerts_sent_this_week INT DEFAULT 0,
  week_reset_at TIMESTAMPTZ DEFAULT NOW(),
  plan TEXT DEFAULT 'scout',         -- 'scout'|'acquirer'|'studio'|'mogul'
  linked_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tracks which gems we've already alerted about (avoids spam)
CREATE TABLE IF NOT EXISTS alert_log (
  id BIGSERIAL PRIMARY KEY,
  discord_user_id TEXT NOT NULL,
  universe_id BIGINT NOT NULL,
  alert_type TEXT NOT NULL,          -- 'new_diamond'|'score_up'|'score_down'|'ccu_spike'|'new_gem'
  sent_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(discord_user_id, universe_id, alert_type, date_trunc('day', sent_at))
);

-- Snapshot of gem scores so we can detect changes
CREATE TABLE IF NOT EXISTS gem_score_alerts_baseline (
  universe_id BIGINT PRIMARY KEY,
  gem_score INT,
  gem_tier TEXT,
  playing INT,
  is_hidden_gem BOOLEAN,
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_discord_plan ON discord_connections(plan);
CREATE INDEX IF NOT EXISTS idx_alert_log_user ON alert_log(discord_user_id, sent_at DESC);
