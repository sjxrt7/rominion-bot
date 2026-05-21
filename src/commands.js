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

  // Look up user directly from profiles table by email
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, plan, username, plan_expires_at')
    .ilike('email', email.toLowerCase())
    .maybeSingle();

  if (!profile) {
    return interaction.editReply({
      content: `❌ No RoMinion account found with email \`${email}\`. Sign up at **rominion.xyz** first.`,
    });
  }

  // Use profile.id as match.id going forward
  const match = { id: profile.id };

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

// /gem — look up a game by name from Supabase
export async function handleGem(interaction) {
  await interaction.deferReply();
  const query = interaction.options.getString('name');

  const { data: games } = await supabase
    .from('games')
    .select('*')
    .ilike('name', `%${query}%`)
    .order('gem_score', { ascending: false })
    .limit(1);

  const game = games?.[0];
  if (!game) {
    return interaction.editReply({ content: `❌ No game found matching \`${query}\`. Try scanning on rominion.xyz first.` });
  }

  const tier = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[game.gem_tier] || '🎮';
  const colors = { Diamond: 0xF59E0B, Sapphire: 0x3B82F6, Emerald: 0x10B981, Raw: 0x64748B };

  const embed = new EmbedBuilder()
    .setColor(colors[game.gem_tier] || 0x64748B)
    .setTitle(`${tier} ${game.name}`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? 'Solo Dev' : 'Studio'}`, inline: true },
      { name: '💎 Gem Score', value: `${game.gem_score}/100 ${tier}`, inline: true },
      { name: '👥 Live Players', value: fmt(game.playing), inline: true },
      { name: '👁 Total Visits', value: fmt(game.visits), inline: true },
      { name: '⭐ Favorites', value: fmt(game.favorited_count), inline: true },
      { name: '📈 Like Ratio', value: game.like_ratio ? `${(game.like_ratio * 100).toFixed(1)}%` : '—', inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(game.est_monthly_revenue_low)} – $${fmt(game.est_monthly_revenue_high)}`, inline: true },
      { name: '💵 Acquisition Est.', value: `$${fmt(game.est_monthly_revenue_low * 12)} – $${fmt(game.est_monthly_revenue_high * 36)}`, inline: true },
      { name: '🔗 Roblox', value: `[Open game](https://www.roblox.com/games/${game.place_id})`, inline: true },
      { name: '💎 Hidden Gem', value: game.is_hidden_gem ? '✅ Yes' : '❌ No', inline: true },
    )
    .setFooter({ text: 'RoMinion · Find. Acquire. Dominate.' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /top — top hidden gems from Supabase
export async function handleTop(interaction) {
  await interaction.deferReply();
  const count = interaction.options.getInteger('count') || 5;

  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('is_hidden_gem', true)
    .order('gem_score', { ascending: false })
    .limit(count);

  if (!games?.length) {
    return interaction.editReply({ content: '❌ No hidden gems indexed yet. Scan on rominion.xyz first.' });
  }

  const tierEmoji = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' };
  const lines = games.map((g, i) => {
    const tier = tierEmoji[g.gem_tier] || '🎮';
    return `${i + 1}. ${tier} **[${g.name}](https://www.roblox.com/games/${g.place_id})** — Score ${g.gem_score} · 👥 ${fmt(g.playing)} · 💰 $${fmt(g.est_monthly_revenue_low)}–$${fmt(g.est_monthly_revenue_high)}/mo`;
  });

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle('💎 Top Hidden Gems — RoMinion')
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'RoMinion · Find. Acquire. Dominate.' })
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

  const { data: games } = await supabase
    .from('games')
    .select('*')
    .eq('is_hidden_gem', true)
    .order('gem_score', { ascending: false })
    .limit(1);

  const game = games?.[0];
  if (!game) return interaction.editReply({ content: '❌ No gems indexed yet. Scan on rominion.xyz first.' });

  const tierEmoji = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[game.gem_tier] || '💎';
  const colors = { Diamond: 0xF59E0B, Sapphire: 0x3B82F6, Emerald: 0x10B981, Raw: 0x64748B };

  const embed = new EmbedBuilder()
    .setColor(colors[game.gem_tier] || 0xF59E0B)
    .setTitle(`👀 SNIPE — Best Gem Right Now`)
    .setDescription(`This is your highest-opportunity acquisition target at this exact moment. Strike before anyone else.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: `${tierEmoji} ${game.name}`, value: `by **${game.creator_name || 'Unknown'}** · ${game.creator_type === 'User' ? '👤 Solo Dev' : '🏢 Studio'}`, inline: false },
      { name: '💎 Gem Score', value: `**${game.gem_score}/100** ${tierEmoji} ${game.gem_tier}`, inline: true },
      { name: '👥 Live Players', value: fmt(game.playing), inline: true },
      { name: '👁 Total Visits', value: fmt(game.visits), inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(game.est_monthly_revenue_low)} – $${fmt(game.est_monthly_revenue_high)}`, inline: true },
      { name: '💵 Acquisition Price', value: `$${fmt(game.est_monthly_revenue_low * 12)} – $${fmt(game.est_monthly_revenue_high * 36)}`, inline: true },
      { name: '🔗 Roblox', value: `[Open game](https://www.roblox.com/games/${game.place_id})`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · Updates every scan · RoMinion' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

// /analyze
export async function handleAnalyze(interaction) {
  await interaction.deferReply();
  if (!(await requireMogul(interaction))) return;

  const query = interaction.options.getString('name');
  const { data: games } = await supabase
    .from('games')
    .select('*')
    .ilike('name', `%${query}%`)
    .order('gem_score', { ascending: false })
    .limit(1);

  const game = games?.[0];
  if (!game) return interaction.editReply({ content: `❌ No game found matching \`${query}\`. Try scanning on rominion.xyz first.` });

  const tierEmoji = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[game.gem_tier] || '🎮';
  const colors = { Diamond: 0xF59E0B, Sapphire: 0x3B82F6, Emerald: 0x10B981, Raw: 0x64748B };
  const acquirability = game.creator_type === 'User' ? '🟢 High (Solo Dev)' : '🟡 Medium (Studio)';
  const likeRatio = game.like_ratio ? `${(game.like_ratio * 100).toFixed(1)}%` : '—';

  const embed = new EmbedBuilder()
    .setColor(colors[game.gem_tier] || 0x64748B)
    .setTitle(`📊 Deep Analysis — ${game.name}`)
    .setDescription(`Full acquisition intelligence report. Mogul exclusive. 👑`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '💎 Gem Score', value: `${game.gem_score}/100 ${tierEmoji} ${game.gem_tier}`, inline: true },
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? 'Solo' : 'Studio'}`, inline: true },
      { name: '👥 Live Players', value: fmt(game.playing), inline: true },
      { name: '👁 Total Visits', value: fmt(game.visits), inline: true },
      { name: '⭐ Favorites', value: fmt(game.favorited_count), inline: true },
      { name: '❤️ Like Ratio', value: likeRatio, inline: true },
      { name: '🤝 Acquirability', value: acquirability, inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(game.est_monthly_revenue_low)} – $${fmt(game.est_monthly_revenue_high)}/mo`, inline: true },
      { name: '💵 Suggested Offer', value: `$${fmt(game.est_monthly_revenue_low * 12)} – $${fmt(game.est_monthly_revenue_high * 36)}`, inline: true },
      { name: '🔗 View on Roblox', value: `[Open game](https://www.roblox.com/games/${game.place_id})`, inline: true },
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

  const fetchGame = async (q) => {
    const { data } = await supabase
      .from('games')
      .select('*')
      .ilike('name', `%${q}%`)
      .order('gem_score', { ascending: false })
      .limit(1);
    return data?.[0] || null;
  };

  const [g1, g2] = await Promise.all([fetchGame(q1), fetchGame(q2)]);

  if (!g1) return interaction.editReply({ content: `❌ No game found matching \`${q1}\`.` });
  if (!g2) return interaction.editReply({ content: `❌ No game found matching \`${q2}\`.` });

  const winner = g1.gem_score >= g2.gem_score ? g1.name : g2.name;

  const compare = (val1, val2) => val1 >= val2 ? ['✅', '—'] : ['—', '✅'];

  const [s1, s2] = compare(g1.gem_score, g2.gem_score);
  const [p1, p2] = compare(g1.playing, g2.playing);
  const [v1, v2] = compare(g1.visits, g2.visits);
  const [r1, r2] = compare(g1.est_monthly_revenue_high, g2.est_monthly_revenue_high);

  const embed = new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`⚔️ Acquisition Comparison`)
    .setDescription(`**${g1.name}** vs **${g2.name}**\n\n🏆 Better acquisition target: **${winner}**`)
    .addFields(
      { name: '\u200B', value: `**${g1.name}**`, inline: true },
      { name: '\u200B', value: '**Metric**', inline: true },
      { name: '\u200B', value: `**${g2.name}**`, inline: true },
      { name: '\u200B', value: `${s1} ${g1.gem_score}/100`, inline: true },
      { name: '\u200B', value: '💎 Gem Score', inline: true },
      { name: '\u200B', value: `${s2} ${g2.gem_score}/100`, inline: true },
      { name: '\u200B', value: `${p1} ${fmt(g1.playing)}`, inline: true },
      { name: '\u200B', value: '👥 Live Players', inline: true },
      { name: '\u200B', value: `${p2} ${fmt(g2.playing)}`, inline: true },
      { name: '\u200B', value: `${v1} ${fmt(g1.visits)}`, inline: true },
      { name: '\u200B', value: '👁 Total Visits', inline: true },
      { name: '\u200B', value: `${v2} ${fmt(g2.visits)}`, inline: true },
      { name: '\u200B', value: `${r1} $${fmt(g1.est_monthly_revenue_high)}/mo`, inline: true },
      { name: '\u200B', value: '💰 Est. Revenue', inline: true },
      { name: '\u200B', value: `${r2} $${fmt(g2.est_monthly_revenue_high)}/mo`, inline: true },
    )
    .setFooter({ text: '👑 Mogul Exclusive · RoMinion Compare' })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}
