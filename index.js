import pkg from 'discord.js';

import "dotenv/config"
import OpenAI from "openai"
import fs from "fs"
import { commands } from './commands.js';
import { addReference, listReferences, loadReferenceStore, removeReference } from "./src/references/store.js";
if (process.env.RENDER === "true") {
  await import("./src/render.js");
}
const {
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Partials,
  MessageFlags,
  PermissionFlagsBits,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} = pkg;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [
    Partials.Channel // <-- CRITICAL: Ensures the bot processes uncached DM/GDM channel states
  ]
});


const groq = new OpenAI({
  apiKey: process.env.GROQ_API,
  baseURL: "https://api.groq.com/openai/v1"
});

const recommendations = new Map();
let faqEntries = [];
try {
  const rawFaq = fs.readFileSync("./src/faq/faq.json", "utf8");
  const parsed = JSON.parse(rawFaq);
  if (Array.isArray(parsed)) faqEntries = parsed;
} catch (_error) {
  faqEntries = [];
}

const allowedReferenceUserIds = new Set(
  (process.env.REFERENCE_ALLOWED_USER_IDS ?? "612273903443902515,1340323274453815317")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^\d{5,32}$/.test(id))
);

function tokenize(text) {
  return (text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter(Boolean);
}

function scoreFaqCandidate(messageText, entry) {
  const messageTokens = new Set(tokenize(messageText));
  const haystackTokens = tokenize(`${entry.title ?? ""} ${(entry.tags ?? []).join(" ")}`);
  if (messageTokens.size === 0 || haystackTokens.length === 0) return 0;

  let score = 0;
  for (const token of haystackTokens) {
    if (messageTokens.has(token)) score += 1;
  }
  return score;
}

function pickFaqCandidates(messageText, max = 3) {
  if (!Array.isArray(faqEntries) || faqEntries.length === 0) return [];
  return faqEntries
    .map((entry) => ({ entry, score: scoreFaqCandidate(messageText, entry) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ entry }) => ({
      slug: entry.slug ?? "unknown",
      title: entry.title ?? "Untitled",
      answer: entry.answer ?? "",
      tags: Array.isArray(entry.tags) ? entry.tags : [],
    }));
}

function scoreReferenceCandidate(messageText, entry) {
  const messageTokens = new Set(tokenize(messageText));
  const haystackTokens = tokenize(`${entry.key ?? ""} ${(entry.tags ?? []).join(" ")} ${entry.text ?? ""}`);
  if (messageTokens.size === 0 || haystackTokens.length === 0) return 0;

  let score = 0;
  for (const token of haystackTokens) {
    if (messageTokens.has(token)) score += 1;
  }
  return score;
}

function pickReferenceCandidates(messageText, entries, max = 3) {
  if (!Array.isArray(entries) || entries.length === 0) return [];
  return entries
    .map((entry) => ({ entry, score: scoreReferenceCandidate(messageText, entry) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ entry }) => ({
      key: entry.key ?? "unknown",
      text: entry.text ?? "",
      tags: Array.isArray(entry.tags) ? entry.tags : [],
    }));
}

function truncateEmbedValue(value, maxLen = 900) {
  const text = String(value ?? "");
  if (text.length <= maxLen) return text;
  return text.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function slugifyReferenceKeyFromText(text) {
  const words = tokenize(text).slice(0, 8);
  let base = words.join("-");
  if (!base) base = "ref";
  base = base.slice(0, 64).replace(/^-+|-+$/g, "");
  if (base.length < 2) base = "ref";
  return base;
}

async function generateUniqueReferenceKey(text) {
  const store = await loadReferenceStore();
  const existing = new Set(Object.keys(store.items ?? {}));

  const base = slugifyReferenceKeyFromText(text);
  if (!existing.has(base)) return base;

  for (let i = 2; i < 1000; i++) {
    const suffix = `-${i}`;
    const candidate = (base.slice(0, 64 - suffix.length) + suffix).replace(/^-+|-+$/g, "");
    if (!existing.has(candidate) && candidate.length >= 2) return candidate;
  }
  return `${base.slice(0, 61)}-99`;
}

function canManageReferences(interaction) {
  return allowedReferenceUserIds.has(interaction.user.id);
}

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
  if (interaction.isAutocomplete()) {
    if (interaction.commandName !== "reference") return;
    if (!canManageReferences(interaction)) {
      await interaction.respond([]);
      return;
    }

    const focused = interaction.options.getFocused(true);
    if (focused.name !== "key") {
      await interaction.respond([]);
      return;
    }

    try {
      const typed = String(focused.value ?? "").toLowerCase();
      const store = await loadReferenceStore();
      const keys = Object.keys(store.items ?? {});
      const matches = keys
        .filter((k) => k.toLowerCase().includes(typed))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 25)
        .map((k) => {
          const preview = truncateEmbedValue(store.items?.[k]?.text ?? "", 60);
          const name = truncateEmbedValue(preview ? `${k} — ${preview}` : k, 100);
          return { name, value: k };
        });

      await interaction.respond(matches);
    } catch (error) {
      console.error("Autocomplete failed:", error);
      await interaction.respond([]);
    }
    return;
  }

  if (interaction.isButton()) {
    const [buttonType, recommendationId] = interaction.customId.split(':');
    const recommendation = recommendations.get(recommendationId);

    if (!recommendation) {
      await interaction.reply({
        content: 'This recommendation has expired. Please evaluate the message again.',
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    const { result, targetMessage } = recommendation;
    if (buttonType === 'logging') {
      await interaction.reply({
        content: [
          '```',
          `User: ${targetMessage.author.id}`,
          `Type: ${result.moderation?.action ?? "unknown"}`,
          `Reason: ${result.moderation?.reason ?? "unknown"}`,
          'Proof:',
          '```'
        ].join('\n'),
        flags: MessageFlags.Ephemeral
      });
    } else if (buttonType === 'mute') {
      await interaction.reply({
        content: `\`\`\`\n$mute ${targetMessage.author.id} ${result.moderation?.duration ?? "none"} ${result.moderation?.reason ?? "none"}\n\`\`\``,
        flags: MessageFlags.Ephemeral
      });
    }
    return;
  }

  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === "help") {
      const embed = new EmbedBuilder()
        .setColor("#7289da")
        .setTitle("Help")
        .setDescription("Quick guide to the available commands:")
        .addFields(
          {
            name: "Message context menu (right-click)",
            value: [
              "• **Evaluate** — Evaluate a message (support vs rules vs neither).",
              "• **Get Message Info** — Shows message metadata.",
              "• **Get User Info** — Shows user metadata.",
            ].join("\n"),
          },
          {
            name: "Slash commands",
            value: [
              "• `/reference add` — Add a staff reference snippet (key optional).",
              "• `/reference remove` — Remove a reference (key autocomplete shows preview).",
              "• `/reference list` — List references (optional filter).",
              "",
              "Note: `/reference` is restricted to the allowlisted user IDs.",
            ].join("\n"),
          },
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.commandName === "reference") {
      if (!canManageReferences(interaction)) {
        await interaction.reply({
          content: "You do not have permission to manage references.",
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const subcommand = interaction.options.getSubcommand();
      if (subcommand === "add") {
        const keyProvided = interaction.options.getString("key", false);
        const text = interaction.options.getString("text", true);
        const tagsRaw = interaction.options.getString("tags", false) ?? "";
        const tags = tagsRaw
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean);

        try {
          const key = (keyProvided && keyProvided.trim()) ? keyProvided.trim() : await generateUniqueReferenceKey(text);
          const added = await addReference({ key, text, tags, createdBy: interaction.user.id });
          await interaction.reply({
            content: `Added reference \`${key}\`.\n\n${truncateEmbedValue(added.text, 1500)}`,
            flags: MessageFlags.Ephemeral
          });
        } catch (error) {
          await interaction.reply({
            content: `Failed to add reference: ${error?.message ?? "unknown error"}`,
            flags: MessageFlags.Ephemeral
          });
        }
        return;
      }

      if (subcommand === "remove") {
        const key = interaction.options.getString("key", true);
        try {
          const removed = await removeReference({ key });
          await interaction.reply({
            content: removed ? `Removed reference \`${key}\`.` : `Reference \`${key}\` not found.`,
            flags: MessageFlags.Ephemeral
          });
        } catch (error) {
          await interaction.reply({
            content: `Failed to remove reference: ${error?.message ?? "unknown error"}`,
            flags: MessageFlags.Ephemeral
          });
        }
        return;
      }

      if (subcommand === "list") {
        const filter = interaction.options.getString("filter", false) ?? "";
        try {
          const entries = await listReferences({ filter });

          const lines = [];
          let shown = 0;
          for (const e of entries) {
            const line = `- \`${e.key}\` (${e.tags.join(",") || "no-tags"}): ${truncateEmbedValue(e.text, 120)}`;
            const next = (lines.length ? "\n" : "") + line;
            const prospectiveLength = ("References:\n" + lines.join("\n") + next).length;
            if (prospectiveLength > 1800) break;
            lines.push(line);
            shown++;
            if (shown >= 50) break;
          }

          const suffix = entries.length > shown ? `\n\nShowing ${shown} of ${entries.length}. Use \`filter\` to narrow results.` : "";
          await interaction.reply({
            content: lines.length ? `References:\n${lines.join("\n")}${suffix}` : "No references found.",
            flags: MessageFlags.Ephemeral
          });
        } catch (error) {
          await interaction.reply({
            content: `Failed to list references: ${error?.message ?? "unknown error"}`,
            flags: MessageFlags.Ephemeral
          });
        }
        return;
      }
    }

    return;
  }

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
      case "Evaluate": {
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
          const faqCandidates = pickFaqCandidates(targetMessage.content ?? "");
          const referenceStore = await loadReferenceStore();
          const referenceEntries = Object.entries(referenceStore.items ?? {}).map(([key, value]) => ({
            key,
            text: value?.text ?? "",
            tags: Array.isArray(value?.tags) ? value.tags : [],
          }));
          const referenceCandidates = pickReferenceCandidates(targetMessage.content ?? "", referenceEntries, 3);
       
          prompt = prompt
              .replace("{{SERVER_RULES}}", () => serverRules)
              .replace("{{SERVER_INFO}}", () => serverInfo)
              .replace("{{CHANNEL_INFO}}", () => channelInfo)
              .replace("{{USER_INFO}}", () => userInfo)
              .replace("{{SELECTED_MESSAGE}}", () => targetMessage.content || "")
              .replace("{{FAQ_CANDIDATES}}", () => JSON.stringify(faqCandidates, null, 2))
              .replace("{{REFERENCE_CANDIDATES}}", () => JSON.stringify(referenceCandidates, null, 2))
              .replace("{{RELEVANT_CONTEXT}}", () => relevantContext)
              .replace("{{MODERATION_CONTEXT}}", () => moderationContext);
       
          let res;
          let groqResponse;
          try {
            ({ data: res, response: groqResponse } = await groq.responses.create({
                model: "openai/gpt-oss-20b",
                input: prompt,
                text: {
                  format: {
                    type: "json_schema",
                    name: "message_evaluation",
                    strict: true,
                    schema: {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        primary: { type: "string", enum: ["support", "rules", "neither"] },
                        confidence: { type: "number" },
                        support: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            needed: { type: "boolean" },
                            topic: { type: "string" },
                            reply: { type: "string" },
                            faq_refs: {
                              type: "array",
                              items: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                  slug: { type: "string" },
                                  title: { type: "string" }
                                },
                                required: ["slug", "title"]
                              }
                            },
                            reference_refs: {
                              type: "array",
                              items: {
                                type: "object",
                                additionalProperties: false,
                                properties: {
                                  key: { type: "string" }
                                },
                                required: ["key"]
                              }
                            }
                          },
                          required: ["needed", "topic", "reply", "faq_refs", "reference_refs"]
                        },
                        moderation: {
                          type: "object",
                          additionalProperties: false,
                          properties: {
                            action: { type: "string", enum: ["none", "warn", "mute", "kick", "ban"] },
                            duration: { type: "string" },
                            reason: { type: "string" },
                            rule: { type: "string" }
                          },
                          required: ["action", "duration", "reason", "rule"]
                        }
                      },
                      required: ["primary", "confidence", "support", "moderation"]
                    }
                  }
                }
                }).withResponse());
          } catch (error) {
            console.error("Groq request failed:", error);
            await interaction.reply({
              content: "The moderation recommendation could not be generated. Please try again.",
              flags: MessageFlags.Ephemeral
            });
            break;
          }

              const tokensRemaining = groqResponse.headers.get('x-ratelimit-remaining-tokens') ?? 'unknown';
              const requestsRemaining = groqResponse.headers.get('x-ratelimit-remaining-requests') ?? 'unknown';

          let result;
          try {
            result = JSON.parse(res.output_text);
            if (!Number.isFinite(result.confidence) || result.confidence < 0 || result.confidence > 1) {
              throw new Error("Confidence must be a number between 0 and 1");
            }
          } catch (error) {
            console.error("The moderation model returned invalid JSON:", res.output_text, error);
            await interaction.reply({
              content: "The moderation recommendation could not be read. Please try again.",
              flags: MessageFlags.Ephemeral
            });
            break;
          }

          if (result.primary === "rules" && result.moderation?.action === "none") {
            result.primary = result.support?.needed ? "support" : "neither";
          }

          const embed = new EmbedBuilder()
            .setTitle(targetMessage.author.tag)
            .setThumbnail(interaction.targetMessage.author.displayAvatarURL())
            .setAuthor({ name: interaction.user.displayName, iconURL: interaction.user.displayAvatarURL() })
            .setTimestamp()
            .setFooter({ text: `Groq rate window: ${tokensRemaining} tokens and ${requestsRemaining} requests remaining` })
            .addFields({ name: 'Message:', value: truncateEmbedValue(targetMessage.content || '[No text content]') })
            .addFields({ name: 'Primary:', value: String(result.primary), inline: true })
            .addFields({ name: 'Confidence:', value: String(result.confidence), inline: true });

          let components = [];
          if (result.primary === "support") {
            embed.setColor("#2ecc71");
            embed.addFields(
              { name: "Support Topic:", value: truncateEmbedValue(result.support?.topic ?? "unknown"), inline: true },
              { name: "Suggested Reply:", value: truncateEmbedValue(result.support?.reply ?? "none") }
            );
            const refs = Array.isArray(result.support?.faq_refs) ? result.support.faq_refs : [];
            embed.addFields({
              name: "Matched FAQs:",
              value: truncateEmbedValue(refs.length ? refs.map((r) => `${r.title} (${r.slug})`).join("\n") : "none"),
            });

            const referenceRefs = Array.isArray(result.support?.reference_refs) ? result.support.reference_refs : [];
            embed.addFields({
              name: "Matched References:",
              value: truncateEmbedValue(referenceRefs.length ? referenceRefs.map((r) => r.key).join("\n") : "none"),
            });
          } else if (result.primary === "rules") {
            embed.setColor("#e67e22");
            embed.addFields(
              { name: 'Action:', value: String(result.moderation?.action ?? "unknown"), inline: true },
              { name: 'Duration', value: String(result.moderation?.duration ?? "unknown"), inline: true },
              { name: 'Reason', value: truncateEmbedValue(result.moderation?.reason ?? "unknown"), inline: false },
              { name: 'Rule Broken:', value: truncateEmbedValue(result.moderation?.rule ?? "unknown"), inline: false }
            );

            const button1 = new ButtonBuilder()
              .setCustomId(`logging:${interaction.id}`)
              .setLabel('Show Logging Format')
              .setStyle(ButtonStyle.Secondary);

            const row = new ActionRowBuilder().addComponents(button1);
            if (result.moderation?.action === "mute") {
              const button2 = new ButtonBuilder()
                .setCustomId(`mute:${interaction.id}`)
                .setLabel('Show Mute Command')
                .setStyle(ButtonStyle.Secondary);
              row.addComponents(button2);
            }

            components = [row];
            recommendations.set(interaction.id, { result, targetMessage });
            setTimeout(() => recommendations.delete(interaction.id), 15 * 60 * 1000);
          } else {
            embed.setColor("#95a5a6");
            embed.addFields({ name: "Result:", value: "No action needed." });
          }

          console.log(result);
          await interaction.reply({
            embeds: [embed],
            components,
            flags: MessageFlags.Ephemeral
          });
         
          break;
      }
    }
  }
});
client.login(process.env.TOKEN)
