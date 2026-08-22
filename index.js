import pkg from 'discord.js';
import "dotenv/config"
import { commands } from './commands.js';
const {
  Client,
  EmbedBuilder,
} = pkg;

const client = new Client({
  intents: [
    "Guilds",
    "GuildMessages",
    "MessageContent",
  ],
});

client.on("clientReady", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  try {
    await client.application.commands.set(commands);
    console.log('Application commands registered successfully.');
  } catch (error) {
    console.error('Failed to register application commands:', error);
  }
})


client.on('interactionCreate', async (interaction) => {
  if (!interaction.isContextMenuCommand()) return;
  if (interaction.commandName === 'Get User Info') {
    const user = interaction.options.getUser('user');
    const embed = new EmbedBuilder()
    .setColor('#7289da')
    .setTitle(user.tag)
    .addFields(
      { name: 'Display Name', value: user.displayName, inline: true },
      { name: 'Username', value: user.username, inline: true },
      { name: 'User ID', value: user.id, inline: true },
      { name: 'Creation Date', value: user.createdAt.toDateString(), inline: true }
    )
    .setThumbnail(user.displayAvatarURL())
    .setFooter({ text: 'Author name', iconURL: interaction.user.displayAvatarURL() })

    await interaction.reply({ embeds: [embed] });
  }
});
client.login(process.env.TOKEN);