// src/alerts.js
// Builds Discord embeds for each alert type.
// These are what users actually see in their DMs / channels.

import { EmbedBuilder } from 'discord.js';

const COLORS = {
  diamond: 0xF59E0B, // gold
  sapphire: 0x3B82F6, // blue
  emerald: 0x10B981, // green
  raw: 0x64748B,     // grey
  spike: 0xEF4444,   // red
  up: 0x10B981,
  down: 0xEF4444,
};

function tierEmoji(tier) {
  return { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[tier] || '🎮';
}

function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toString();
}

function robloxUrl(placeId) {
  return `https://www.roblox.com/games/${placeId}`;
}

function daysSince(d) {
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

// ── 💎 NEW DIAMOND GEM ──────────────────────────────────────────
export function buildNewDiamondEmbed(game, metrics) {
  return new EmbedBuilder()
    .setColor(COLORS.diamond)
    .setTitle(`💎 New Diamond Gem Found`)
    .setDescription(`**${game.name}** just hit Diamond tier — and it's flying under the radar.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '🎮 Game', value: `[${game.name}](${robloxUrl(game.place_id)})`, inline: true },
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? 'Solo Dev' : 'Studio'}`, inline: true },
      { name: '💎 Gem Score', value: `**${metrics.gem_score}/100**`, inline: true },
      { name: '👥 Live Players', value: fmt(metrics.playing), inline: true },
      { name: '👁 Total Visits', value: fmt(metrics.visits), inline: true },
      { name: '⭐ Favorites', value: fmt(metrics.favorited_count), inline: true },
      { name: '💰 Est. Monthly Revenue', value: `$${fmt(metrics.est_monthly_revenue_low)} – $${fmt(metrics.est_monthly_revenue_high)}`, inline: true },
      { name: '💵 Suggested Acquisition', value: `$${fmt(metrics.est_acquisition_price_low)} – $${fmt(metrics.est_acquisition_price_high)}`, inline: true },
      { name: '🔄 Last Updated', value: `${daysSince(game.updated_at)} days ago`, inline: true },
    )
    .setFooter({ text: 'RoMinion · Find. Acquire. Dominate.' })
    .setTimestamp();
}

// ── 🆕 NEW HIDDEN GEM (first time detected) ─────────────────────
export function buildNewGemEmbed(game, metrics) {
  const tier = metrics.gem_tier;
  return new EmbedBuilder()
    .setColor(COLORS[tier?.toLowerCase()] || COLORS.sapphire)
    .setTitle(`🆕 New Hidden Gem Discovered`)
    .setDescription(`**${game.name}** just appeared on RoMinion's radar. ${tierEmoji(tier)} ${tier} tier — ${metrics.gem_score}/100.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '🎮 Game', value: `[${game.name}](${robloxUrl(game.place_id)})`, inline: true },
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? '👤 Solo' : '🏢 Studio'}`, inline: true },
      { name: '🎯 Genre', value: game.primary_genre || 'Unknown', inline: true },
      { name: '👥 Players Now', value: fmt(metrics.playing), inline: true },
      { name: '👁 Visits', value: fmt(metrics.visits), inline: true },
      { name: '📈 Fav/Visit', value: `${((metrics.engagement_ratio || 0) * 100).toFixed(2)}%`, inline: true },
      { name: '💰 Est. Revenue', value: `$${fmt(metrics.est_monthly_revenue_low)} – $${fmt(metrics.est_monthly_revenue_high)}/mo`, inline: false },
    )
    .setFooter({ text: 'RoMinion · Strike before anyone else does.' })
    .setTimestamp();
}

// ── 📈 GEM SCORE INCREASED ───────────────────────────────────────
export function buildScoreUpEmbed(game, metrics, oldScore, newScore) {
  const delta = newScore - oldScore;
  return new EmbedBuilder()
    .setColor(COLORS.up)
    .setTitle(`📈 Gem Score Rising — ${game.name}`)
    .setDescription(`A game on your watchlist just jumped **+${delta} points**. Momentum is building — this could be the right time to reach out.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '🎮 Game', value: `[${game.name}](${robloxUrl(game.place_id)})`, inline: true },
      { name: '👤 Creator', value: game.creator_name || 'Unknown', inline: true },
      { name: '💎 Score', value: `~~${oldScore}~~ → **${newScore}** (+${delta})`, inline: true },
      { name: '👥 Players', value: fmt(metrics.playing), inline: true },
      { name: '💰 Est. Revenue', value: `$${fmt(metrics.est_monthly_revenue_low)} – $${fmt(metrics.est_monthly_revenue_high)}/mo`, inline: true },
      { name: '💵 Acquisition Est.', value: `$${fmt(metrics.est_acquisition_price_low)} – $${fmt(metrics.est_acquisition_price_high)}`, inline: true },
    )
    .setFooter({ text: 'RoMinion · Watchlist alert' })
    .setTimestamp();
}

// ── 📉 GEM SCORE DROPPED ─────────────────────────────────────────
export function buildScoreDownEmbed(game, metrics, oldScore, newScore) {
  const delta = oldScore - newScore;
  return new EmbedBuilder()
    .setColor(COLORS.down)
    .setTitle(`📉 Gem Score Dropping — ${game.name}`)
    .setDescription(`A game on your watchlist dropped **-${delta} points**. Developer may be going quiet — could mean lower price, or higher risk.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '🎮 Game', value: `[${game.name}](${robloxUrl(game.place_id)})`, inline: true },
      { name: '💎 Score', value: `~~${oldScore}~~ → **${newScore}** (-${delta})`, inline: true },
      { name: '🔄 Last Updated', value: `${daysSince(game.updated_at)} days ago`, inline: true },
      { name: '👥 Players', value: fmt(metrics.playing), inline: true },
      { name: '💰 Est. Revenue', value: `$${fmt(metrics.est_monthly_revenue_low)} – $${fmt(metrics.est_monthly_revenue_high)}/mo`, inline: true },
    )
    .setFooter({ text: 'RoMinion · Consider striking while price is low.' })
    .setTimestamp();
}

// ── 🔥 CCU SPIKE ─────────────────────────────────────────────────
export function buildCCUSpikeEmbed(game, metrics, oldPlaying, newPlaying) {
  const pct = Math.round(((newPlaying - oldPlaying) / Math.max(oldPlaying, 1)) * 100);
  return new EmbedBuilder()
    .setColor(COLORS.spike)
    .setTitle(`🔥 Player Spike Detected — ${game.name}`)
    .setDescription(`**${game.name}** just gained **+${pct}% players** in 15 minutes. Something's driving traffic — could go viral. Reach out NOW before studios notice.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '🎮 Game', value: `[${game.name}](${robloxUrl(game.place_id)})`, inline: true },
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? 'Solo' : 'Studio'}`, inline: true },
      { name: '👥 Players', value: `~~${fmt(oldPlaying)}~~ → **${fmt(newPlaying)}** (+${pct}%)`, inline: true },
      { name: '💎 Gem Score', value: `${metrics.gem_score}/100 ${tierEmoji(metrics.gem_tier)}`, inline: true },
      { name: '💰 Est. Revenue', value: `$${fmt(metrics.est_monthly_revenue_low)} – $${fmt(metrics.est_monthly_revenue_high)}/mo`, inline: true },
      { name: '💵 Acquisition Est.', value: `$${fmt(metrics.est_acquisition_price_low)} – $${fmt(metrics.est_acquisition_price_high)}`, inline: true },
    )
    .setFooter({ text: 'RoMinion · Act fast. Viral windows close.' })
    .setTimestamp();
}

// ── ⚠️ DEV GOING QUIET ──────────────────────────────────────────
export function buildDevSlowingEmbed(game, metrics) {
  const days = daysSince(game.updated_at);
  return new EmbedBuilder()
    .setColor(0xF59E0B)
    .setTitle(`⚠️ Developer Going Quiet — ${game.name}`)
    .setDescription(`**${game.name}** hasn't been updated in **${days} days**. The developer may be losing interest — this is often the best time to negotiate a low acquisition price.`)
    .setThumbnail(game.thumbnail_url || null)
    .addFields(
      { name: '🎮 Game', value: `[${game.name}](${robloxUrl(game.place_id)})`, inline: true },
      { name: '👤 Creator', value: `${game.creator_name || 'Unknown'} · ${game.creator_type === 'User' ? 'Solo Dev' : 'Studio'}`, inline: true },
      { name: '🔄 Last Update', value: `${days} days ago`, inline: true },
      { name: '👥 Still Active', value: `${fmt(metrics.playing)} players online`, inline: true },
      { name: '💎 Gem Score', value: `${metrics.gem_score}/100`, inline: true },
      { name: '💵 Acquisition Est.', value: `$${fmt(metrics.est_acquisition_price_low)} – $${fmt(metrics.est_acquisition_price_high)}`, inline: true },
    )
    .setFooter({ text: 'RoMinion · Abandoned games = motivated sellers.' })
    .setTimestamp();
}

// ── 🏆 TOP GEMS (for /top command) ──────────────────────────────
export function buildTopGemsEmbed(games) {
  const embed = new EmbedBuilder()
    .setColor(COLORS.diamond)
    .setTitle(`💎 Today\'s Top Hidden Gems`)
    .setDescription('Highest Gem Score hidden games right now on Roblox.')
    .setFooter({ text: 'RoMinion · Updated every 15 minutes.' })
    .setTimestamp();

  games.forEach((g, i) => {
    const emoji = { Diamond: '💎', Sapphire: '💠', Emerald: '🟢', Raw: '⚪' }[g.gem_tier] || '🎮';
    embed.addFields({
      name: `${i + 1}. ${emoji} ${g.name} — ${g.gem_score}/100`,
      value: `👥 ${fmt(g.playing)} players · 👁 ${fmt(g.visits)} visits · 💰 $${fmt(g.est_monthly_revenue_low)}–$${fmt(g.est_monthly_revenue_high)}/mo · [View](${robloxUrl(g.place_id)})`,
      inline: false,
    });
  });

  return embed;
}
