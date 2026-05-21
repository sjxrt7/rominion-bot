// src/commands.js
// Handles all slash command interactions

import { createClient } from '@supabase/supabase-js';
import { EmbedBuilder } from 'discord.js';
import { buildTopGemsEmbed } from './alerts.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
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

function generateKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const seg = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `RMN-${seg(6)}-${seg(6)}`;
}

// Fetch games from Roblox API
async function fetchRobloxGames(keyword = '', limit = 10) {
  try {
    const url = keyword
      ? `https://games.roblox.com/v1/games/list?model.keyword=${encodeURIComponent(keyword)}&model.maxRows=${limit}&model.startRows=0`
      : `https://games.roblox.com/v1/games/list?model.sortToken=&model.gameFilter=0&model.timeFilter=0&model.genreFilter=0&model.maxRows=${limit}&model.startRows=0&model.contextCountryRegionId=1&model.sortOrder=2`;

    const res = await fetch(url);
    const data = await res.json();
    return data?.games || [];
  } catch (err) {
    console.error('Roblox API error:', err);
    return [];
  }
}

// Calculate a simple gem score from Roblox data
function calcGemScore(game) {
  const ccu = game.playerCount || 0;
  const visits = game.totalUpVotes + game.totalDownVotes > 0
    ? Math.round((game.totalUpVotes / (game.totalUpVotes + game.totalDownVotes)) * 100)
    : 50;
  const likeRatio = visits / 100;
  const score = Math.min(100, Math.round((ccu * 0.3) + (likeRatio * 40) + 20));
  return score;
}

// Estimate revenue from CCU
function estimateRevenue(ccu) {
  const base = ccu * 0.175 * 4 * 0.55;
  return { low: Math.round(base * 0.4), high: Math.round(base * 2.2) };
}

// /genkey — generate a plan key (admin only)
export async function handleGenKey(interaction) {
  await interaction.deferReply({ ephemeral: true });

  if (!ADMIN_IDS.includes(interaction.user.id)) {
    return interaction.editReply({ content: '❌ You do not have permission to use this command.' });
  }

  const plan = interaction.options.getString('plan');
  const key = generateKey();

  const { error } = await supabase.from('plan_keys').insert({
    key, plan, is_used: false, created_at: new Date().toISOString(),
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

async function assignPlanRole(interaction, plan) {
  try {
    const guild = interaction.guild;
    if (!guild) return;
    const member = await guild.members.fetch(interaction.user.id);
    for (const roleId of Object.values(PLAN_ROLES)) {
      if (member.roles.cache.has(roleId)) await member.roles.remove(roleId).catch(() => {});
    }
    const roleId = PLAN_ROLES[plan];
    if (roleId) {
      const role = guild.roles.cache.get(roleId);
      if (role) await member.roles.add(role);
    }
  } catch (err) {
    console.error(`Failed to assign role: ${err.message}`);
  }
}

// /link
export async function handleLink(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const email = interaction.options.getString('email');

  const { data: users } = await supabase.auth.admin.listUsers();
  const match = users?.users?.find(u => u.email?.toLowerCase() === email.toLowerCase());

  if (!match) {
    return interaction.editReply({
      content: `❌ No RoMinion account found with email \`${email}\`. Sign up at **rominion.xyz** first.`,
    });
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('plan, username, plan_expires_at')
    .eq('id', match.id)
    .maybeSingle();

  const plan = profile?.plan || 'free';
  const expired = profile?.plan_expires_at && new Date(profile.plan_expires_at) < new Date();

  await assignPlanRole(interaction, expired ? 'scout' : plan);

  if (plan === 'free' || expired) {
    return interaction.editReply({
      content: `✅ **Linked!** Your Discord account is connected to RoMinion.\n\n⚠️ Your current plan: **${expired ? 'Expired' : 'Free'}**\n\nJoin our Discord and purchase a plan: **discord.gg/2rs4JHtKy8**\nThen enter your key at **rominion.xyz/keycode**`,
    });
  }

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

// /alerts
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

// /gem — look up a game by name from Roblox API
export async function handleGem(interaction) {
  await interaction.deferReply();
  const query = interaction.options.getString('name');

  const games = await fetchRobloxGames(query, 1);
  const game = games?.[0];

  if (!game) {
    return interaction.editReply({ content: `❌ No game found matching \`${query}\` on Roblox.` });
  }

  const gemScore = calcGemScore(game);
  const rev = estimateRevenue(game.playerCount || 0);
  const likeRatio = game.totalUpVotes + game.totalDownVotes > 0
    ? ((game.totalUpVotes / (game.totalUpVotes + game.totalDownVotes)) * 100).toFixed(1)
    : '—';

  const tier = gemScore >= 80 ? '💎 Diamond' : gemScore >= 60 ? '💠 Sapphire' : gemScore >= 40 ? '🟢 Emerald' : '⚪ Raw';

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`🎮 ${game.name}`)
    .setThumbnail(game.imageToken ? `https://tr.rbxcdn.com/${game.imageToken}/150/150/Image/Png` : null)
    .addFields(
      { name: '👤 Creator', value: game.creatorName || 'Unknown', inline: true },
      { name: '💎 Gem Score', value: `${gemScore}/100 ${tier}`, inline: true },
      { name: '👥 Live Players', value: fmt(game.playerCount), inline: true },
      { name: '👁 Total Visits', value: fmt(game.totalUpVotes), inline: true },
      { name: '📈 Like Ratio', value: `${likeRatio}%`, inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(rev.low)} – $${fmt(rev.high)}`, inline: true },
      { name: '🔗 Roblox', value: `[Open game](https://www.roblox.com/games/${game.placeId})`, inline: true },
    )
    .setFooter({ text: 'RoMinion · Find. Acquire. Dominate.' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /top — top games from Roblox right now
export async function handleTop(interaction) {
  await interaction.deferReply();
  const count = interaction.options.getInteger('count') || 5;

  const games = await fetchRobloxGames('', 50);

  if (!games?.length) {
    return interaction.editReply({ content: '❌ Could not fetch games from Roblox. Try again in a moment.' });
  }

  // Score and sort
  const scored = games
    .map(g => ({ ...g, gemScore: calcGemScore(g) }))
    .sort((a, b) => b.gemScore - a.gemScore)
    .slice(0, count);

  const lines = scored.map((g, i) => {
    const tier = g.gemScore >= 80 ? '💎' : g.gemScore >= 60 ? '💠' : g.gemScore >= 40 ? '🟢' : '⚪';
    return `${i + 1}. ${tier} **[${g.name}](https://www.roblox.com/games/${g.placeId})** — Score ${g.gemScore} · 👥 ${fmt(g.playerCount)}`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle('💎 Top Hidden Gems Right Now')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'RoMinion · Live from Roblox API' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /watchlist
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
    .select('*')
    .eq('user_id', conn.user_id)
    .order('added_at', { ascending: false })
    .limit(10);

  if (!items?.length) {
    return interaction.editReply({ content: '⭐ Your watchlist is empty. Visit rominion.xyz to start saving gems.' });
  }

  const lines = items.map((w, i) => `${i + 1}. 🎮 **${w.game_name || 'Unknown'}** — [View on Roblox](https://www.roblox.com/games/${w.place_id || ''})`);

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
      content: `👑 This command is exclusive to **Mogul ($159/mo)** subscribers.\n\nJoin Discord to purchase: **discord.gg/2rs4JHtKy8**\nThen enter your key at **rominion.xyz/keycode**`,
    });
    return false;
  }
  return true;
}

// /snipe
export async function handleSnipe(interaction) {
  await interaction.deferReply();
  if (!(await requireMogul(interaction))) return;

  const games = await fetchRobloxGames('', 50);
  if (!games?.length) return interaction.editReply({ content: '❌ Could not fetch games from Roblox. Try again.' });

  const best = games
    .map(g => ({ ...g, gemScore: calcGemScore(g) }))
    .sort((a, b) => b.gemScore - a.gemScore)[0];

  const rev = estimateRevenue(best.playerCount || 0);
  const tier = best.gemScore >= 80 ? '💎' : best.gemScore >= 60 ? '💠' : '🟢';

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`👀 SNIPE — Best Gem Right Now`)
    .setDescription(`This is your highest-opportunity acquisition target at this exact moment.`)
    .addFields(
      { name: `${tier} ${best.name}`, value: `by **${best.creatorName || 'Unknown'}**`, inline: false },
      { name: '💎 Gem Score', value: `**${best.gemScore}/100**`, inline: true },
      { name: '👥 Live Players', value: fmt(best.playerCount), inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(rev.low)} – $${fmt(rev.high)}`, inline: true },
      { name: '🔗 Roblox', value: `[Open game](https://www.roblox.com/games/${best.placeId})`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · RoMinion' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /analyze
export async function handleAnalyze(interaction) {
  await interaction.deferReply();
  if (!(await requireMogul(interaction))) return;

  const query = interaction.options.getString('name');
  const games = await fetchRobloxGames(query, 1);
  const game = games?.[0];

  if (!game) return interaction.editReply({ content: `❌ No game found matching \`${query}\`.` });

  const gemScore = calcGemScore(game);
  const rev = estimateRevenue(game.playerCount || 0);
  const likeRatio = game.totalUpVotes + game.totalDownVotes > 0
    ? ((game.totalUpVotes / (game.totalUpVotes + game.totalDownVotes)) * 100).toFixed(1)
    : '—';
  const acquirability = game.creatorType === 'User' ? '🟢 High (Solo Dev)' : '🟡 Medium (Studio)';

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`📊 Deep Analysis — ${game.name}`)
    .setDescription(`Full acquisition intelligence report. Mogul exclusive. 👑`)
    .addFields(
      { name: '💎 Gem Score', value: `${gemScore}/100`, inline: true },
      { name: '👤 Creator', value: game.creatorName || 'Unknown', inline: true },
      { name: '👥 Live Players', value: fmt(game.playerCount), inline: true },
      { name: '❤️ Like Ratio', value: `${likeRatio}%`, inline: true },
      { name: '🤝 Acquirability', value: acquirability, inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(rev.low)} – $${fmt(rev.high)}/mo`, inline: true },
      { name: '💵 Suggested Offer', value: `$${fmt(rev.low * 12)} – $${fmt(rev.high * 36)}`, inline: true },
      { name: '🔗 View on Roblox', value: `[Open game](https://www.roblox.com/games/${game.placeId})`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · RoMinion Deep Analysis' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /compare
export async function handleCompare(interaction) {
  await interaction.deferReply();
  if (!(await requireMogul(interaction))) return;

  const q1 = interaction.options.getString('game1');
  const q2 = interaction.options.getString('game2');

  const [games1, games2] = await Promise.all([
    fetchRobloxGames(q1, 1),
    fetchRobloxGames(q2, 1),
  ]);

  const g1 = games1?.[0];
  const g2 = games2?.[0];

  if (!g1) return interaction.editReply({ content: `❌ No game found matching \`${q1}\`.` });
  if (!g2) return interaction.editReply({ content: `❌ No game found matching \`${q2}\`.` });

  const s1 = calcGemScore(g1);
  const s2 = calcGemScore(g2);
  const winner = s1 >= s2 ? g1.name : g2.name;

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`⚔️ Acquisition Comparison`)
    .setDescription(`**${g1.name}** vs **${g2.name}**\n\n🏆 Better acquisition target: **${winner}**`)
    .addFields(
      { name: '\u200B', value: `**${g1.name}**`, inline: true },
      { name: '\u200B', value: '**Metric**', inline: true },
      { name: '\u200B', value: `**${g2.name}**`, inline: true },
      { name: '\u200B', value: `${s1 >= s2 ? '✅' : '—'} ${s1}/100`, inline: true },
      { name: '\u200B', value: '💎 Gem Score', inline: true },
      { name: '\u200B', value: `${s2 > s1 ? '✅' : '—'} ${s2}/100`, inline: true },
      { name: '\u200B', value: `${g1.playerCount >= g2.playerCount ? '✅' : '—'} ${fmt(g1.playerCount)}`, inline: true },
      { name: '\u200B', value: '👥 Live Players', inline: true },
      { name: '\u200B', value: `${g2.playerCount > g1.playerCount ? '✅' : '—'} ${fmt(g2.playerCount)}`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · RoMinion Compare' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
