// src/commands.js
// Handles all slash command interactions

import { createClient } from '@supabase/supabase-js';
import { EmbedBuilder } from 'discord.js';
import { buildTopGemsEmbed } from './alerts.js';

// Lovable Supabase — users, profiles, plan_keys, discord_connections
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Your Supabase — games, game_metrics, game_snapshots
const gamesDb = createClient(
  process.env.GAMES_SUPABASE_URL,
  process.env.GAMES_SUPABASE_KEY
);

// Admin Discord user IDs — only these users can use /genkey
const ADMIN_IDS = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(id => id.trim());

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString();
}

// Generate a random key like RMN-XXXXXX-XXXXXX
function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `RMN-${seg(6)}-${seg(6)}`;
}

// /genkey — generate a plan key (admin only)
export async function handleGenKey(interaction) {
  await interaction.deferReply({ ephemeral: true });

  // Check if user is an admin
  if (!ADMIN_IDS.includes(interaction.user.id)) {
    return interaction.editReply({
      content: '❌ You do not have permission to use this command.',
    });
  }

  const plan = interaction.options.getString('plan');
  const key = generateKey();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days from now (after activation)

  // Store the key in Supabase
  const { error } = await supabase.from('plan_keys').insert({
    key,
    plan,
    is_used: false,
    created_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to generate key:', error);
    return interaction.editReply({ content: '⚠️ Failed to generate key. Please try again.' });
  }

  const planEmoji = { acquirer: '🔑', studio: '🏠', mogul: '👑' }[plan] || '🎟️';
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`${planEmoji} Key Generated — ${planLabel} Plan`)
    .setDescription(`Send this key to the user. It activates a **30-day ${planLabel} plan** from the moment they enter it.`)
    .addFields(
      { name: '🔐 Key', value: `\`\`\`${key}\`\`\``, inline: false },
      { name: '📋 Plan', value: planLabel, inline: true },
      { name: '⏳ Valid for', value: '30 days after activation', inline: true },
      { name: '🔂 Single use', value: 'Yes — locked to one account', inline: true },
    )
    .setFooter({ text: 'RoMinion Admin · Keep this key secure until delivered' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// Discord role IDs per plan
const PLAN_ROLES = {
  scout: '1505649803399397610',
  acquirer: '1505649049372590171',
  studio: '1505648979998802122',
  mogul: '1505648750775763116',
};

// Assign Discord role based on plan
async function assignPlanRole(interaction, plan) {
  try {
    const guild = interaction.guild;
    if (!guild) return;
    const member = await guild.members.fetch(interaction.user.id);

    // Remove all plan roles first
    for (const roleId of Object.values(PLAN_ROLES)) {
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId).catch(() => {});
      }
    }

    // Assign the correct role
    const roleId = PLAN_ROLES[plan];
    if (roleId) {
      const role = guild.roles.cache.get(roleId);
      if (role) await member.roles.add(role);
    }
  } catch (err) {
    console.error(`Failed to assign role: ${err.message}`);
  }
}

// /link — connect Discord to RoMinion account
export async function handleLink(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const email = interaction.options.getString('email');

  // Look up the user by email in Supabase auth
  const { data: users } = await supabase.auth.admin.listUsers();
  const match = users?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

  if (!match) {
    return interaction.editReply({
      content: `❌ No RoMinion account found with email \`${email}\`. Sign up at **rominion.xyz** first.`,
    });
  }

  // Check their plan and expiry
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, username, plan_expires_at')
    .eq('id', match.id)
    .maybeSingle();

  const plan = profile?.plan || 'free';
  const expired = profile?.plan_expires_at && new Date(profile.plan_expires_at) < new Date();

  // Assign role regardless of plan (including scout/free)
  await assignPlanRole(interaction, expired ? 'scout' : plan);

  if (plan === 'free' || expired) {
    return interaction.editReply({
      content: `✅ **Linked!** Your Discord account is connected to RoMinion.\n\n⚠️ Your current plan: **${expired ? 'Expired' : 'Free'}**\n\nJoin our Discord and purchase a plan: **discord.gg/2rs4JHtKy8**\nThen enter your key at **rominion.xyz/keycode**`,
    });
  }

  // Upsert the connection
  await supabase.from('discord_connections').upsert({
    user_id: match.id,
    discord_user_id: interaction.user.id,
    discord_username: interaction.user.tag,
    guild_id: interaction.guildId,
    channel_id: interaction.channelId,
    plan,
    alerts_sent_this_week: 0,
    week_reset_at: new Date().toISOString(),
  });

  const limit = plan === 'acquirer' ? '1/week' : 'Unlimited';
  const planEmoji = { acquirer: '🔑', studio: '🏠', mogul: '👑' }[plan] || '🎟️';

  return interaction.editReply({
    content: `✅ **Linked!** Your Discord is now connected to RoMinion.\n\n${planEmoji} **Plan:** ${plan.charAt(0).toUpperCase() + plan.slice(1)}\n📬 **Alert limit:** ${limit}\n🎭 **Role assigned:** ${plan.charAt(0).toUpperCase() + plan.slice(1)}\n\nUse \`/alerts status\` to see your alert settings.`,
  });
}

// /alerts — manage alert preferences
export async function handleAlerts(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const sub = interaction.options.getSubcommand();

  const { data: conn } = await supabase
    .from('discord_connections')
    .select('*')
    .eq('discord_user_id', interaction.user.id)
    .maybeSingle();

  if (!conn) {
    return interaction.editReply({ content: '❌ You haven\'t linked your account yet. Use `/link` first.' });
  }

  if (sub === 'status') {
    const plan = conn.plan || 'free';
    const limit = plan === 'acquirer' ? `${conn.alerts_sent_this_week}/1 this week` : plan === 'free' ? 'No alerts (free plan)' : 'Unlimited';
    return interaction.editReply({
      content: [
        `**📬 Alert Settings for ${interaction.user.username}**`,
        `**Plan:** ${plan} · **Alerts sent:** ${limit}`,
        ``,
        `💎 New Diamond gems: ${conn.alert_new_diamond ? '✅' : '❌'}`,
        `🆕 New hidden gems: ${conn.alert_new_gem ? '✅' : '❌'}`,
        `📈 Score increased: ${conn.alert_score_change ? '✅' : '❌'}`,
        `🔥 CCU spikes: ${conn.alert_ccu_spike ? '✅' : '❌'}`,
        `⚠️ Dev going quiet: ${conn.alert_dev_slowing ? '✅' : '❌'}`,
      ].join('\n'),
    });
  }

  if (sub === 'on') {
    await supabase.from('discord_connections').update({
      alert_new_diamond: true, alert_score_change: true,
      alert_ccu_spike: true, alert_new_gem: true,
    }).eq('discord_user_id', interaction.user.id);
    return interaction.editReply({ content: '✅ All alerts turned on.' });
  }

  if (sub === 'off') {
    await supabase.from('discord_connections').update({
      alert_new_diamond: false, alert_score_change: false,
      alert_ccu_spike: false, alert_new_gem: false, alert_dev_slowing: false,
    }).eq('discord_user_id', interaction.user.id);
    return interaction.editReply({ content: '🔕 All alerts turned off.' });
  }

  if (sub === 'types') {
    const type = interaction.options.getString('type');
    const enabled = interaction.options.getBoolean('enabled');
    await supabase.from('discord_connections').update({ [type]: enabled }).eq('discord_user_id', interaction.user.id);
    return interaction.editReply({ content: `${enabled ? '✅' : '❌'} Alert \`${type}\` is now ${enabled ? 'ON' : 'OFF'}.` });
  }
}

// /gem — look up a game by name
export async function handleGem(interaction) {
  await interaction.deferReply();
  const query = interaction.options.getString('name');

  const { data: games } = await gamesDb
    .from('games')
    .select('*, game_metrics(*)')
    .ilike('name', `%${query}%`)
    .not('game_metrics', 'is', null)
    .order('game_metrics(gem_score)', { ascending: false })
    .limit(1);

  const game = games?.[0];
  if (!game) {
    return interaction.editReply({ content: `❌ No game found matching \`${query}\`. It may not have been indexed yet.` });
  }

  const m = game.game_metrics;
  const tier = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[m.gem_tier] || '🎮';
  const colors = { Diamond: 0xF59E0B, Sapphire: 0x3B82F6, Emerald: 0x10B981, Raw: 0x64748B };

  const embed = new EmbedBuilder()
    .setColor(colors[m.gem_tier] || 0x64748B)
    .setTitle(`${tier} ${game.name}`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? 'Solo Dev' : 'Studio'}`, inline: true },
      { name: '🎯 Genre', value: game.primary_genre || 'Unknown', inline: true },
      { name: '💎 Gem Score', value: `${m.gem_score}/100 ${tier}`, inline: true },
      { name: '👥 Live Players', value: fmt(m.playing), inline: true },
      { name: '👁 Total Visits', value: fmt(m.visits), inline: true },
      { name: '⭐ Favorites', value: fmt(m.favorited_count), inline: true },
      { name: '📈 Like Ratio', value: m.like_ratio ? `${(m.like_ratio * 100).toFixed(1)}%` : '—', inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(m.est_monthly_revenue_low)} – $${fmt(m.est_monthly_revenue_high)}`, inline: true },
      { name: '💵 Acquisition Est.', value: `$${fmt(m.est_acquisition_price_low)} – $${fmt(m.est_acquisition_price_high)}`, inline: true },
      { name: '🔗 Roblox', value: `[Open game](https://www.roblox.com/games/${game.place_id})`, inline: true },
      { name: '💎 Hidden Gem', value: m.is_hidden_gem ? '✅ Yes' : '❌ No', inline: true },
    )
    .setFooter({ text: 'RoMinion · Find. Acquire. Dominate.' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /top — today's top hidden gems
export async function handleTop(interaction) {
  await interaction.deferReply();
  const count = interaction.options.getInteger('count') || 5;

  const { data: games } = await gamesDb
    .from('games')
    .select('*, game_metrics!inner(*)')
    .eq('game_metrics.is_hidden_gem', true)
    .order('game_metrics(gem_score)', { ascending: false })
    .limit(count);

  if (!games?.length) {
    return interaction.editReply({ content: '❌ No hidden gems indexed yet. Scanner may still be running.' });
  }

  const flat = games.map(g => ({ ...g, ...g.game_metrics }));
  return interaction.editReply({ embeds: [buildTopGemsEmbed(flat)] });
}

// /watchlist — show user's watchlist
export async function handleWatchlist(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const { data: conn } = await supabase
    .from('discord_connections')
    .select('user_id')
    .eq('discord_user_id', interaction.user.id)
    .maybeSingle();

  if (!conn) {
    return interaction.editReply({ content: '❌ Link your account first with `/link`.' });
  }

  const { data: items } = await supabase
    .from('watchlist')
    .select('*, games(name, place_id, thumbnail_url, game_metrics(gem_score, gem_tier, playing, est_monthly_revenue_low, est_monthly_revenue_high))')
    .eq('user_id', conn.user_id)
    .order('added_at', { ascending: false })
    .limit(10);

  if (!items?.length) {
    return interaction.editReply({ content: '⭐ Your watchlist is empty. Visit rominion.xyz to start saving gems.' });
  }

  const tierEmoji = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' };
  const lines = items.map((w, i) => {
    const g = w.games;
    const m = g?.game_metrics?.[0] || g?.game_metrics;
    const tier = tierEmoji[m?.gem_tier] || '🎮';
    return `${i + 1}. ${tier} **[${g?.name}](https://www.roblox.com/games/${g?.place_id})** — Score ${m?.gem_score || '?'} · 👥 ${fmt(m?.playing)} · 💰 $${fmt(m?.est_monthly_revenue_low)}–$${fmt(m?.est_monthly_revenue_high)}/mo`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle('⭐ Your Watchlist')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Manage your full watchlist at rominion.xyz' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /unlink
export async function handleUnlink(interaction) {
  await interaction.deferReply({ ephemeral: true });
  await supabase.from('discord_connections').delete().eq('discord_user_id', interaction.user.id);
  return interaction.editReply({ content: '✅ Your Discord has been unlinked from RoMinion.' });
}

// ── MOGUL GUARD ──────────────────────────────────────────────────
async function requireMogul(interaction) {
  const { data: conn } = await supabase
    .from('discord_connections')
    .select('plan')
    .eq('discord_user_id', interaction.user.id)
    .maybeSingle();

  if (!conn) {
    await interaction.editReply({ content: '❌ Link your account first with `/link your@email.com`.' });
    return false;
  }
  if (conn.plan !== 'mogul') {
    await interaction.editReply({
      content: `👑 This command is exclusive to **Mogul ($69/mo)** subscribers.\n\nJoin Discord to purchase: **discord.gg/2rs4JHtKy8**\nThen enter your key at **rominion.xyz/keycode**`,
    });
    return false;
  }
  return true;
}

// ── /snipe — single best gem RIGHT NOW (Mogul only) ──────────────
export async function handleSnipe(interaction) {
  await interaction.deferReply();
  if (!(await requireMogul(interaction))) return;

  const { data: games } = await gamesDb
    .from('games')
    .select(`*, game_metrics!inner(*)`)
    .eq('game_metrics.is_hidden_gem', true)
    .order('game_metrics(gem_score)', { ascending: false })
    .limit(1);

  const game = games?.[0];
  if (!game) return interaction.editReply({ content: '❌ No gems indexed yet. Scanner may still be running.' });

  const m = game.game_metrics;
  const tierEmoji = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[m.gem_tier] || '💎';
  const colors = { Diamond: 0xF59E0B, Sapphire: 0x3B82F6, Emerald: 0x10B981, Raw: 0x64748B };

  const embed = new EmbedBuilder()
    .setColor(colors[m.gem_tier] || 0xF59E0B)
    .setTitle(`👀 SNIPE — Best Gem Right Now`)
    .setDescription(`This is your highest-opportunity acquisition target at this exact moment. Strike before anyone else.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: `${tierEmoji} ${game.name}`, value: `by **${game.creator_name || 'Unknown'}** · ${game.creator_type === 'User' ? '👤 Solo Dev' : '🏢 Studio'}`, inline: false },
      { name: '💎 Gem Score', value: `**${m.gem_score}/100** ${tierEmoji} ${m.gem_tier}`, inline: true },
      { name: '👥 Live Players', value: `${fmt(m.playing)}`, inline: true },
      { name: '👁 Total Visits', value: `${fmt(m.visits)}`, inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(m.est_monthly_revenue_low)} – $${fmt(m.est_monthly_revenue_high)}`, inline: true },
      { name: '💵 Acquisition Price', value: `$${fmt(m.est_acquisition_price_low)} – $${fmt(m.est_acquisition_price_high)}`, inline: true },
      { name: '🔗 Roblox', value: `[Open game](https://www.roblox.com/games/${game.place_id})`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · Updates every 15 minutes · RoMinion' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ── /analyze — deep acquisition report (Mogul only) ──────────────
export async function handleAnalyze(interaction) {
  await interaction.deferReply();
  if (!(await requireMogul(interaction))) return;

  const query = interaction.options.getString('name');
  const { data: games } = await gamesDb
    .from('games')
    .select(`*, game_metrics(*)`)
    .ilike('name', `%${query}%`)
    .not('game_metrics', 'is', null)
    .order('game_metrics(gem_score)', { ascending: false })
    .limit(1);

  const game = games?.[0];
  if (!game) return interaction.editReply({ content: `❌ No game found matching \`${query}\`.` });

  const m = game.game_metrics;
  const tierEmoji = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[m.gem_tier] || '🎮';
  const colors = { Diamond: 0xF59E0B, Sapphire: 0x3B82F6, Emerald: 0x10B981, Raw: 0x64748B };

  const { data: history } = await gamesDb
    .from('game_snapshots')
    .select('playing, visits, recorded_at')
    .eq('universe_id', game.universe_id)
    .gte('recorded_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('recorded_at', { ascending: true });

  const peakCCU = history?.length ? Math.max(...history.map(h => h.playing || 0)) : m.playing;
  const avgCCU = history?.length ? Math.round(history.reduce((a, h) => a + (h.playing || 0), 0) / history.length) : m.playing;
  const dsu = Math.floor((Date.now() - new Date(game.updated_at).getTime()) / 86400000);

  const activityScore = dsu < 7 ? '🟢 Very Active' : dsu < 30 ? '🟡 Active' : dsu < 90 ? '🟠 Slowing' : '🔴 Inactive';
  const acquirability = game.creator_type === 'User' ? '🟢 High (Solo Dev)' : '🟡 Medium (Studio)';
  const likeRatio = m.like_ratio ? `${(m.like_ratio * 100).toFixed(1)}%` : '—';
  const engRatio = m.engagement_ratio ? `${(m.engagement_ratio * 100).toFixed(2)}%` : '—';

  const embed = new EmbedBuilder()
    .setColor(colors[m.gem_tier] || 0x64748B)
    .setTitle(`📊 Deep Analysis — ${game.name}`)
    .setDescription(`Full acquisition intelligence report. Mogul exclusive. 👑`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '💎 Gem Score', value: `${m.gem_score}/100 ${tierEmoji} ${m.gem_tier}`, inline: true },
      { name: '🎯 Genre', value: game.primary_genre || 'Unknown', inline: true },
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? 'Solo' : 'Studio'}`, inline: true },
      { name: '👥 Live Now', value: fmt(m.playing), inline: true },
      { name: '📈 Peak CCU (30d)', value: fmt(peakCCU), inline: true },
      { name: '📊 Avg CCU (30d)', value: fmt(avgCCU), inline: true },
      { name: '👁 Total Visits', value: fmt(m.visits), inline: true },
      { name: '⭐ Favorites', value: fmt(m.favorited_count), inline: true },
      { name: '❤️ Like Ratio', value: likeRatio, inline: true },
      { name: '📌 Fav/Visit Ratio', value: engRatio, inline: true },
      { name: '🔄 Last Updated', value: `${dsu} days ago`, inline: true },
      { name: '⚡ Dev Activity', value: activityScore, inline: true },
      { name: '🤝 Acquirability', value: acquirability, inline: false },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(m.est_monthly_revenue_low)} – $${fmt(m.est_monthly_revenue_high)}/mo`, inline: true },
      { name: '💵 Suggested Offer', value: `$${fmt(m.est_acquisition_price_low)} – $${fmt(m.est_acquisition_price_high)}`, inline: true },
      { name: '🔗 View on Roblox', value: `[Open game](https://www.roblox.com/games/${game.place_id})`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · RoMinion Deep Analysis' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// ── /compare — side by side comparison (Mogul only) ──────────────
export async function handleCompare(interaction) {
  await interaction.deferReply();
  if (!(await requireMogul(interaction))) return;

  const q1 = interaction.options.getString('game1');
  const q2 = interaction.options.getString('game2');

  const fetchGame = async (q) => {
    const { data } = await gamesDb
      .from('games')
      .select(`*, game_metrics(*)`)
      .ilike('name', `%${q}%`)
      .not('game_metrics', 'is', null)
      .order('game_metrics(gem_score)', { ascending: false })
      .limit(1);
    return data?.[0] || null;
  };

  const [g1, g2] = await Promise.all([fetchGame(q1), fetchGame(q2)]);

  if (!g1) return interaction.editReply({ content: `❌ No game found matching \`${q1}\`.` });
  if (!g2) return interaction.editReply({ content: `❌ No game found matching \`${q2}\`.` });

  const m1 = g1.game_metrics;
  const m2 = g2.game_metrics;
  const winner = m1.gem_score >= m2.gem_score ? g1.name : g2.name;

  const compare = (val1, val2, higherBetter = true) => {
    const better = higherBetter ? val1 >= val2 : val1 <= val2;
    return better ? ['✅', '—'] : ['—', '✅'];
  };

  const [s1, s2] = compare(m1.gem_score, m2.gem_score);
  const [p1, p2] = compare(m1.playing, m2.playing);
  const [v1, v2] = compare(m1.visits, m2.visits);
  const [e1, e2] = compare(m1.engagement_ratio, m2.engagement_ratio);
  const [r1, r2] = compare(m1.est_monthly_revenue_high, m2.est_monthly_revenue_high);

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`⚔️ Acquisition Comparison`)
    .setDescription(`**${g1.name}** vs **${g2.name}**\n\n🏆 Better acquisition target: **${winner}**`)
    .addFields(
      { name: '\u200B', value: `**${g1.name}**`, inline: true },
      { name: '\u200B', value: '**Metric**', inline: true },
      { name: '\u200B', value: `**${g2.name}**`, inline: true },
      { name: '\u200B', value: `${s1} ${m1.gem_score}/100`, inline: true },
      { name: '\u200B', value: '💎 Gem Score', inline: true },
      { name: '\u200B', value: `${s2} ${m2.gem_score}/100`, inline: true },
      { name: '\u200B', value: `${p1} ${fmt(m1.playing)}`, inline: true },
      { name: '\u200B', value: '👥 Live Players', inline: true },
      { name: '\u200B', value: `${p2} ${fmt(m2.playing)}`, inline: true },
      { name: '\u200B', value: `${v1} ${fmt(m1.visits)}`, inline: true },
      { name: '\u200B', value: '👁 Total Visits', inline: true },
      { name: '\u200B', value: `${v2} ${fmt(m2.visits)}`, inline: true },
      { name: '\u200B', value: `${e1} ${((m1.engagement_ratio||0)*100).toFixed(2)}%`, inline: true },
      { name: '\u200B', value: '📌 Engagement', inline: true },
      { name: '\u200B', value: `${e2} ${((m2.engagement_ratio||0)*100).toFixed(2)}%`, inline: true },
      { name: '\u200B', value: `${r1} $${fmt(m1.est_monthly_revenue_high)}/mo`, inline: true },
      { name: '\u200B', value: '💰 Est. Revenue', inline: true },
      { name: '\u200B', value: `${r2} $${fmt(m2.est_monthly_revenue_high)}/mo`, inline: true },
      { name: '\u200B', value: `$${fmt(m1.est_acquisition_price_low)}–$${fmt(m1.est_acquisition_price_high)}`, inline: true },
      { name: '\u200B', value: '💵 Acq. Price', inline: true },
      { name: '\u200B', value: `$${fmt(m2.est_acquisition_price_low)}–$${fmt(m2.est_acquisition_price_high)}`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · RoMinion Compare' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
