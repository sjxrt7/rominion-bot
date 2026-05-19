// src/alertEngine.js
// Runs every 15 minutes.
// Checks game_metrics for changes, finds users to notify, fires Discord DMs.
// Plan system: acquirer = 1 alert/week, studio = unlimited, mogul = unlimited

import { createClient } from '@supabase/supabase-js';
import {
  buildNewDiamondEmbed,
  buildNewGemEmbed,
  buildScoreUpEmbed,
  buildScoreDownEmbed,
  buildCCUSpikeEmbed,
  buildDevSlowingEmbed,
} from './alerts.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Plan limits: how many alerts per week (Infinity = unlimited, 0 = none)
const PLAN_LIMITS = {
  free: 0,
  acquirer: 1,
  studio: Infinity,
  mogul: Infinity,
};

// Get the user's current active plan from profiles table via their discord_user_id
async function getUserPlan(discordUserId) {
  // First get the user_id from discord_connections
  const { data: conn } = await supabase
    .from('discord_connections')
    .select('user_id')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();

  if (!conn?.user_id) return 'free';

  // Then get their plan from profiles, check if it's expired
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, plan_expires_at')
    .eq('id', conn.user_id)
    .maybeSingle();

  if (!profile) return 'free';

  // Check if plan has expired
  if (profile.plan_expires_at && new Date(profile.plan_expires_at) < new Date()) {
    return 'free'; // plan expired
  }

  return profile.plan || 'free';
}

function canSendAlert(plan, alertsSentThisWeek, weekResetAt) {
  const limit = PLAN_LIMITS[plan] ?? 0;
  if (limit === 0) return false;
  if (limit === Infinity) return true;

  // Reset weekly counter if it's been 7 days
  const resetAt = new Date(weekResetAt);
  const daysSinceReset = (Date.now() - resetAt.getTime()) / 86400000;
  if (daysSinceReset >= 7) return true; // will reset in DB before sending

  return alertsSentThisWeek < limit;
}

async function resetWeeklyCounterIfNeeded(connection) {
  const resetAt = new Date(connection.week_reset_at);
  const daysSinceReset = (Date.now() - resetAt.getTime()) / 86400000;
  if (daysSinceReset >= 7) {
    await supabase
      .from('discord_connections')
      .update({ alerts_sent_this_week: 0, week_reset_at: new Date().toISOString() })
      .eq('discord_user_id', connection.discord_user_id);
    connection.alerts_sent_this_week = 0;
  }
}

async function alreadyAlerted(discordUserId, universeId, alertType) {
  const { data } = await supabase
    .from('alert_log')
    .select('id')
    .eq('discord_user_id', discordUserId)
    .eq('universe_id', universeId)
    .eq('alert_type', alertType)
    .gte('sent_at', new Date(Date.now() - 86400000).toISOString()) // once per 24h per alert type
    .maybeSingle();
  return !!data;
}

async function logAlert(discordUserId, universeId, alertType) {
  await supabase.from('alert_log').insert({
    discord_user_id: discordUserId,
    universe_id: universeId,
    alert_type: alertType,
  });
  // Increment weekly counter
  const { data: conn } = await supabase
    .from('discord_connections')
    .select('alerts_sent_this_week')
    .eq('discord_user_id', discordUserId)
    .maybeSingle();
  if (conn) {
    await supabase
      .from('discord_connections')
      .update({ alerts_sent_this_week: (conn.alerts_sent_this_week || 0) + 1 })
      .eq('discord_user_id', discordUserId);
  }
}

async function sendDM(client, connection, embed) {
  try {
    const channelId = connection.discord_dm_channel_id || connection.channel_id;
    if (!channelId) {
      const user = await client.users.fetch(connection.discord_user_id);
      const dm = await user.createDM();
      await dm.send({ embeds: [embed] });
      await supabase
        .from('discord_connections')
        .update({ discord_dm_channel_id: dm.id })
        .eq('discord_user_id', connection.discord_user_id);
    } else {
      const channel = await client.channels.fetch(channelId);
      await channel.send({ embeds: [embed] });
    }
    return true;
  } catch (err) {
    console.error(`Failed to DM ${connection.discord_username}: ${err.message}`);
    return false;
  }
}

export async function runAlertEngine(client) {
  console.log(`[${new Date().toISOString()}] Running alert engine…`);

  // Get all connected Discord users
  const { data: connections } = await supabase
    .from('discord_connections')
    .select('*');

  if (!connections?.length) {
    console.log('  No Discord connections found.');
    return;
  }

  // Filter to users with an active paid plan (check profiles table)
  const eligibleConnections = [];
  for (const conn of connections) {
    const plan = await getUserPlan(conn.discord_user_id);
    conn.activePlan = plan; // attach plan to connection object
    if (plan !== 'free') {
      eligibleConnections.push(conn);
    }
  }

  if (!eligibleConnections.length) {
    console.log('  No users with active paid plans.');
    return;
  }

  console.log(`  Found ${eligibleConnections.length} eligible users.`);

  // Get current gem metrics (top 200 hidden gems)
  const { data: currentGems } = await supabase
    .from('games')
    .select(`*, game_metrics!inner(*)`)
    .eq('game_metrics.is_hidden_gem', true)
    .gte('game_metrics.gem_score', 40)
    .order('game_metrics(gem_score)', { ascending: false })
    .limit(200);

  if (!currentGems?.length) return;

  // Get baseline (previous scan state)
  const universeIds = currentGems.map(g => g.universe_id);
  const { data: baselines } = await supabase
    .from('gem_score_alerts_baseline')
    .select('*')
    .in('universe_id', universeIds);

  const baselineMap = Object.fromEntries((baselines || []).map(b => [b.universe_id, b]));
  const isFirstRun = !baselines?.length;

  // Process each gem, detect changes, fire alerts
  for (const game of currentGems) {
    const metrics = game.game_metrics;
    const baseline = baselineMap[game.universe_id];
    const isNew = !baseline;

    for (const conn of eligibleConnections) {
      await resetWeeklyCounterIfNeeded(conn);

      // Check plan limit using the active plan from profiles
      if (!canSendAlert(conn.activePlan, conn.alerts_sent_this_week, conn.week_reset_at)) {
        continue;
      }

      // ── 💎 NEW DIAMOND GEM ──────────────────────────────────
      if (
        conn.alert_new_diamond &&
        metrics.gem_tier === 'Diamond' &&
        (!baseline || baseline.gem_tier !== 'Diamond') &&
        !isFirstRun
      ) {
        if (!(await alreadyAlerted(conn.discord_user_id, game.universe_id, 'new_diamond'))) {
          const sent = await sendDM(client, conn, buildNewDiamondEmbed(game, metrics));
          if (sent) await logAlert(conn.discord_user_id, game.universe_id, 'new_diamond');
        }
      }

      // ── 🆕 BRAND NEW HIDDEN GEM ─────────────────────────────
      if (conn.alert_new_gem && isNew && !isFirstRun) {
        if (!(await alreadyAlerted(conn.discord_user_id, game.universe_id, 'new_gem'))) {
          const sent = await sendDM(client, conn, buildNewGemEmbed(game, metrics));
          if (sent) await logAlert(conn.discord_user_id, game.universe_id, 'new_gem');
        }
      }

      // ── 📈 SCORE JUMPED +5 OR MORE ──────────────────────────
      if (conn.alert_score_change && baseline) {
        const delta = metrics.gem_score - baseline.gem_score;
        if (delta >= 5) {
          if (!(await alreadyAlerted(conn.discord_user_id, game.universe_id, 'score_up'))) {
            const sent = await sendDM(client, conn, buildScoreUpEmbed(game, metrics, baseline.gem_score, metrics.gem_score));
            if (sent) await logAlert(conn.discord_user_id, game.universe_id, 'score_up');
          }
        } else if (delta <= -5) {
          if (!(await alreadyAlerted(conn.discord_user_id, game.universe_id, 'score_down'))) {
            const sent = await sendDM(client, conn, buildScoreDownEmbed(game, metrics, baseline.gem_score, metrics.gem_score));
            if (sent) await logAlert(conn.discord_user_id, game.universe_id, 'score_down');
          }
        }
      }

      // ── 🔥 CCU SPIKE (+50% in 15 min) ───────────────────────
      if (conn.alert_ccu_spike && baseline) {
        const oldPlaying = baseline.playing || 0;
        const newPlaying = metrics.playing || 0;
        const pct = oldPlaying > 0 ? (newPlaying - oldPlaying) / oldPlaying : 0;
        if (pct >= 0.5 && newPlaying >= 20) {
          if (!(await alreadyAlerted(conn.discord_user_id, game.universe_id, 'ccu_spike'))) {
            const sent = await sendDM(client, conn, buildCCUSpikeEmbed(game, metrics, oldPlaying, newPlaying));
            if (sent) await logAlert(conn.discord_user_id, game.universe_id, 'ccu_spike');
          }
        }
      }

      // ── ⚠️ DEV GOING QUIET (90+ days no update) ─────────────
      if (conn.alert_dev_slowing) {
        const days = Math.floor((Date.now() - new Date(game.updated_at).getTime()) / 86400000);
        if (days >= 90) {
          if (!(await alreadyAlerted(conn.discord_user_id, game.universe_id, 'dev_slowing'))) {
            const sent = await sendDM(client, conn, buildDevSlowingEmbed(game, metrics));
            if (sent) await logAlert(conn.discord_user_id, game.universe_id, 'dev_slowing');
          }
        }
      }
    }
  }

  // Update baseline for next run
  const upserts = currentGems.map(g => ({
    universe_id: g.universe_id,
    gem_score: g.game_metrics.gem_score,
    gem_tier: g.game_metrics.gem_tier,
    playing: g.game_metrics.playing,
    is_hidden_gem: g.game_metrics.is_hidden_gem,
    recorded_at: new Date().toISOString(),
  }));

  await supabase.from('gem_score_alerts_baseline').upsert(upserts);
  console.log(`  Alert engine done. Checked ${currentGems.length} gems for ${eligibleConnections.length} users.`);
}
