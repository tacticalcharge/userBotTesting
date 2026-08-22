import pkg from 'discord.js';
const {
  ContextMenuCommandBuilder,
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
export const commands = [msginfo, userinfo];