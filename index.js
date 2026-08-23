import pkg from 'discord.js';
import "dotenv/config"
import OpenAI from "openai"
import fs from "fs"
import { commands } from './commands.js';
const {
  Client,
  EmbedBuilder,
  MessageFlags,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} = pkg;

const client = new Client({
  intents: [
    "Guilds",
    "GuildMessages",
    "MessageContent",
  ],
});

const groq = new OpenAI({
  apiKey: process.env.GROQ_API,
  baseURL: "https://api.groq.com/openai/v1"
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
  if (interaction.isContextMenuCommand()) {
    switch (interaction.commandName) {
      case "Get User Info": {
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
        break;
      }
      case "Evalute Punishment": {
          const serverRules = fs.readFileSync("./src/rules.txt", "utf8");
          const serverInfo = interaction.guild
            ? `Server: ${interaction.guild.name} (${interaction.guild.id})`
            : "Direct message";
          const channelInfo = interaction.channel
            ? `Channel: ${interaction.channel.name ?? "unknown"} (${interaction.channel.id})`
            : "Unknown channel";
          const targetMessage = interaction.targetMessage;
          const userInfo = `Author: ${targetMessage.author.tag} (${targetMessage.author.id})`;
          const relevantContext = "No additional context was provided.";
          const moderationContext = "No previous moderation context was provided.";
          let prompt = fs.readFileSync("./src/prompt.txt", "utf8");
      
          prompt = prompt
              .replace("{{SERVER_RULES}}", () => serverRules)
              .replace("{{SERVER_INFO}}", () => serverInfo)
              .replace("{{CHANNEL_INFO}}", () => channelInfo)
              .replace("{{USER_INFO}}", () => userInfo)
              .replace("{{SELECTED_MESSAGE}}", () => targetMessage.content)
              .replace("{{RELEVANT_CONTEXT}}", () => relevantContext)
              .replace("{{MODERATION_CONTEXT}}", () => moderationContext);
      
          const { data: res, response: groqResponse } = await groq.responses.create({
              model: "openai/gpt-oss-20b",
              input: prompt,
              text: {
                format: {
                  type: "json_schema",
                  name: "moderation_recommendation",
                  strict: true,
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      action: { type: "string", enum: ["none", "warn", "mute", "kick", "ban"] },
                      duration: { type: "string" },
                      reason: { type: "string" },
                      rule: { type: "string" },
                      confidence: { type: "number", minimum: 0, maximum: 1 }
                    },
                    required: ["action", "duration", "reason", "rule", "confidence"]
                  }
                }
              }
              }).withResponse();

              const tokensRemaining = groqResponse.headers.get('x-ratelimit-remaining-tokens') ?? 'unknown';
              const requestsRemaining = groqResponse.headers.get('x-ratelimit-remaining-requests') ?? 'unknown';

          let result;
          try {
            result = JSON.parse(res.output_text);
          } catch (error) {
            console.error("The moderation model returned invalid JSON:", res.output_text, error);
            await interaction.reply({
              content: "The moderation recommendation could not be read. Please try again.",
              flags: MessageFlags.Ephemeral
            });
            break;
          }
          const embed = new EmbedBuilder()
            .setColor('#7289da')
            .setTitle(targetMessage.author.tag)
            .setThumbnail(interaction.targetMessage.author.displayAvatarURL())
            .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp()
            .setFooter({ text: `Groq rate window: ${tokensRemaining} tokens and ${requestsRemaining} requests remaining` })
            .addFields({ name: 'Message:', value: targetMessage.content || '[No text content]' })
            .addFields({ name: 'Action:', value: result.action, inline: true })
            .addFields({ name: 'Duration', value: result.duration, inline: true })
            .addFields({ name: 'Reason', value: result.reason, inline: true})
            .addFields({ name: 'Rule Broken:', value: result.rule, inline: false })
            .addFields({ name: 'Confidence:', value: String(result.confidence), inline: true })

          const button1 = new ButtonBuilder()
              .setLabel('Logging Thread')
              .setURL("https://discord.com/channels/1183526304365158532/1186582943762747392")
              .setStyle(ButtonStyle.Link)

          const button2 = new ButtonBuilder()
              .setLabel('Mute Channel')
              .setURL("https://discord.com/channels/886309080099086336/1201668203365793864")
              .setStyle(ButtonStyle.Link)
          console.log(result);
            const row = new ActionRowBuilder()
              .addComponents(button1, button2);

            
          await interaction.reply({
              embeds: [embed],
              components: [row],
              flags: MessageFlags.Ephemeral
          });
        
          break;
      }
    }
  }
});
client.login(process.env.TOKEN)