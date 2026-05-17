import 'dotenv/config';
import { Client, GatewayIntentBits, Events, EmbedBuilder } from 'discord.js';
import cron from 'node-cron';
import { runAlertEngine } from './alertEngine.js';
import { handleLink, handleAlerts, handleGem, handleTop, handleWatchlist, handleUnlink, handleSnipe, handleAnalyze, handleCompare } from './commands.js';

const INTERVAL = parseInt(process.env.ALERT_INTERVAL_MINUTES || '15');
const WELCOME_CHANNEL = process.env.WELCOME_CHANNEL_NAME || 'general';
const ALLOWED_GUILD = '1505367255394025663';

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages, GatewayIntentBits.GuildMembers] });

client.once(Events.ClientReady, async () => {
  console.log(`✓ RoMinion Bot logged in as ${client.user.tag}`);
  await runAlertEngine(client);
  cron.schedule(`*/${INTERVAL} * * * *`, () => runAlertEngine(client));
});

client.on(Events.GuildMemberAdd, async (member) => {
  if (member.guild.id !== ALLOWED_GUILD) return;
  try {
    const channel = member.guild.channels.cache.find(c => c.name === WELCOME_CHANNEL && c.isTextBased());
    if (!channel) return;
    const embed = new EmbedBuilder()
      .setColor(0xF59E0B)
      .setTitle(`👋 Welcome, ${member.user.username}!`)
      .setDescription(`Welcome to **RoMinion** — the Roblox acquisition intelligence platform.\n\n🌐 [rominion.xyz](https://rominion.xyz)\n\`/top\` · \`/gem <name>\` · \`/link your@email.com\``)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setFooter({ text: 'Find. Acquire. Dominate. 💎' });
    await channel.send({ content: `${member}`, embeds: [embed] });
  } catch (err) { console.error('Welcome error:', err); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.guildId !== ALLOWED_GUILD) {
    await interaction.reply({ content: '❌ This bot only works in the official RoMinion server. Join at **discord.gg/2rs4JHtKy8**', ephemeral: true });
    return;
  }
  try {
    switch (interaction.commandName) {
      case 'link':      await handleLink(interaction); break;
      case 'alerts':    await handleAlerts(interaction); break;
      case 'gem':       await handleGem(interaction); break;
      case 'top':       await handleTop(interaction); break;
      case 'watchlist': await handleWatchlist(interaction); break;
      case 'unlink':    await handleUnlink(interaction); break;
      case 'snipe':     await handleSnipe(interaction); break;
      case 'analyze':   await handleAnalyze(interaction); break;
      case 'compare':   await handleCompare(interaction); break;
      default: await interaction.reply({ content: '❓ Unknown command.', ephemeral: true });
    }
  } catch (err) {
    const msg = { content: '⚠️ Something went wrong.', ephemeral: true };
    interaction.replied || interaction.deferred ? await interaction.editReply(msg) : await interaction.reply(msg);
  }
});

client.login(process.env.DISCORD_TOKEN);
