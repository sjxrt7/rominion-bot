// src/index.js — RoMinion Discord Bot
import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import cron from 'node-cron';
import { runAlertEngine } from './alertEngine.js';
import {
  handleLink, handleAlerts, handleGem,
  handleTop, handleWatchlist, handleUnlink,
} from './commands.js';

const INTERVAL = parseInt(process.env.ALERT_INTERVAL_MINUTES || '15');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
  ],
});

client.once(Events.ClientReady, async () => {
  console.log(`✓ RoMinion Bot logged in as ${client.user.tag}`);
  console.log(`  Alert interval: every ${INTERVAL} minutes`);

  // Run immediately on start
  await runAlertEngine(client);

  // Then on cron
  cron.schedule(`*/${INTERVAL} * * * *`, () => runAlertEngine(client));
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    switch (interaction.commandName) {
      case 'link':      await handleLink(interaction); break;
      case 'alerts':    await handleAlerts(interaction); break;
      case 'gem':       await handleGem(interaction); break;
      case 'top':       await handleTop(interaction); break;
      case 'watchlist': await handleWatchlist(interaction); break;
      case 'unlink':    await handleUnlink(interaction); break;
      default:
        await interaction.reply({ content: '❓ Unknown command.', ephemeral: true });
    }
  } catch (err) {
    console.error(`Command error (${interaction.commandName}):`, err);
    const msg = { content: '⚠️ Something went wrong. Try again.', ephemeral: true };
    interaction.replied || interaction.deferred
      ? await interaction.editReply(msg)
      : await interaction.reply(msg);
  }
});

client.login(process.env.DISCORD_TOKEN);
