import pkg from 'discord.js';
const {
  ContextMenuCommandBuilder,
  SlashCommandBuilder,
  ApplicationCommandType,
  InteractionContextType,
} = pkg;

const userinfo = new ContextMenuCommandBuilder()
  .setName('Get User Info')
  .setType(ApplicationCommandType.User)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  );

const msginfo = new ContextMenuCommandBuilder()
  .setName(`Get Message Info`)
  .setType(ApplicationCommandType.Message)
  .setContexts(
	InteractionContextType.Guild,
	InteractionContextType.BotDM,
	InteractionContextType.PrivateChannel,
  )
const evaluate = new ContextMenuCommandBuilder()
  .setName("Evaluate")
  .setType(ApplicationCommandType.Message)
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.PrivateChannel,
  )

const helpCommand = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Show help for bot commands")
  .setIntegrationTypes([1]) // 1 = USER_INSTALL
  .setContexts(
    InteractionContextType.Guild,
    InteractionContextType.BotDM,
    InteractionContextType.PrivateChannel,
  );

const referenceCommand = new SlashCommandBuilder()
  .setName("reference")
  .setDescription("Manage staff reference snippets")
  .setIntegrationTypes([1]) // 1 = USER_INSTALL
  .setContexts([1, 2])     // 1 = BOT_DM, 2 = PRIVATE_CHANNEL 
  .addSubcommand((subcommand) =>
    subcommand
      .setName("add")
      .setDescription("Add a reference snippet")
      .addStringOption((option) =>
        option
          .setName("text")
          .setDescription("Reference text")
          .setRequired(true)
      )
      .addStringOption((option) =>
        option
          .setName("key")
          .setDescription("Optional reference key (slug). Leave blank to auto-generate")
          .setRequired(false)
      )
      .addStringOption((option) =>
        option
          .setName("tags")
          .setDescription("Comma-separated tags")
          .setRequired(false)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("remove")
      .setDescription("Remove a reference snippet")
      .addStringOption((option) =>
        option
          .setName("key")
          .setDescription("Reference key (slug)")
          .setAutocomplete(true)
          .setRequired(true)
      )
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName("list")
      .setDescription("List reference snippets")
      .addStringOption((option) =>
        option
          .setName("filter")
          .setDescription("Optional text filter")
          .setRequired(false)
      )
  );

export const commands = [msginfo, userinfo, evaluate, helpCommand, referenceCommand];
