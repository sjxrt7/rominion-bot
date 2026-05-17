// src/registerCommands.js
// Run once: `npm run register`
// Registers all slash commands with Discord globally.

import 'dotenv/config';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Link your Discord account to your RoMinion account')
    .addStringOption(o => o.setName('email').setDescription('Your RoMinion account email').setRequired(true)),

  new SlashCommandBuilder()
    .setName('alerts')
    .setDescription('Manage your gem alert preferences')
    .addSubcommand(s => s.setName('on').setDescription('Turn all alerts on'))
    .addSubcommand(s => s.setName('off').setDescription('Turn all alerts off'))
    .addSubcommand(s => s.setName('status').setDescription('See your current alert settings'))
    .addSubcommand(s => s
      .setName('types')
      .setDescription('Toggle specific alert types')
      .addStringOption(o => o
        .setName('type')
        .setDescription('Alert type')
        .setRequired(true)
        .addChoices(
          { name: '💎 New Diamond gems', value: 'alert_new_diamond' },
          { name: '📈 Gem score increased', value: 'alert_score_change' },
          { name: '🔥 CCU spike detected', value: 'alert_ccu_spike' },
          { name: '🆕 New hidden gem found', value: 'alert_new_gem' },
          { name: '⚠️ Dev going quiet', value: 'alert_dev_slowing' },
        ))
      .addBooleanOption(o => o.setName('enabled').setDescription('On or off').setRequired(true))
    ),

  new SlashCommandBuilder()
    .setName('gem')
    .setDescription('Look up a specific Roblox game\'s Gem Score')
    .addStringOption(o => o.setName('name').setDescription('Game name to search').setRequired(true)),

  new SlashCommandBuilder()
    .setName('watchlist')
    .setDescription('See your RoMinion watchlist'),

  new SlashCommandBuilder()
    .setName('top')
    .setDescription('See today\'s top hidden gems')
    .addIntegerOption(o => o.setName('count').setDescription('How many to show (max 10)').setMinValue(1).setMaxValue(10)),

  new SlashCommandBuilder()
    .setName('unlink')
    .setDescription('Unlink your Discord account from RoMinion'),
].map(c => c.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  console.log('Registering slash commands globally...');
  await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: commands });
  console.log('✓ Commands registered. May take up to 1 hour to appear globally.');
})();
