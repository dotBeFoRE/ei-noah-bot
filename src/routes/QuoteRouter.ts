import {
  Channel,
  Client,
  Message,
  MessageButton,
  MessageEmbed, NewsChannel, Permissions, Role, TextBasedChannelFields, TextChannel, User as DiscordUser, Util,
} from 'discord.js';
import { GuildUser } from 'entity/GuildUser';
import { parseParams } from '../EiNoah';
import createMenu from '../createMenu';
import Quote from '../entity/Quote';
import { getUserGuildData } from '../data';
import Router, { GuildHandler, HandlerType } from '../router/Router';

const router = new Router('Onthoud al');

const getQuoteEmbed = async (channel : TextBasedChannelFields, quote : Quote, client : Client) : Promise<MessageEmbed> => {
  await Promise.all([(() => {
    if (!quote.guildUser.isInitialized()) return quote.guildUser.init();

    return quote.guildUser;
  })(), (() => {
    if (!quote.creator.isInitialized()) return quote.creator.init();

    return quote.creator;
  })()]);

  const quoted = client.users.fetch(`${BigInt(quote.guildUser.user.id)}`, { cache: true });
  const owner = client.users.fetch(`${BigInt(quote.creator.user.id)}`, { cache: true });

  const text = quote.text.replace('`', '\\`');

  const embed = new MessageEmbed();

  const avatarURL = (await quoted).avatarURL() || undefined;
  let color : number | undefined;
  if (channel instanceof TextChannel) color = channel.guild.me?.displayColor;

  embed.setAuthor((await quoted).username, avatarURL);
  embed.setDescription(text);
  embed.setFooter(`Door ${(await owner).username}`, (await owner).avatarURL() || undefined);
  if (quote.date) embed.setTimestamp(quote.date);
  if (color) embed.setColor(color);

  return embed;
};

const addQuote = (params : (string | DiscordUser | Channel | Role | number | boolean)[], quotedUser : GuildUser, owner : GuildUser) => {
  const text = Util.removeMentions(params.map((param) => {
    if (typeof param === 'string') return param;
    if (param instanceof DiscordUser) return param.username;
    if (param instanceof Role) return param.name;
    if (param instanceof TextChannel || param instanceof NewsChannel) return param.name;
    return '[UNKNOWN]';
  }).join(' '));

  if (text.length > 256) {
    return 'Quotes kunnen niet langer zijn dan 256 karakters';
  }

  const quote = new Quote(text, owner);
  quotedUser.quotes.add(quote);

  return quote;
};

const handler : GuildHandler = async ({
  params, msg, em, guildUser, flags,
}) => {
  const [user] = flags.get('persoon') || params;
  params.shift();
  const quoteToAdd = params.length ? params : flags.get('quote');

  if (!(user instanceof DiscordUser)) {
    return 'Ok, dat is niet een persoon, mention iemand';
  }

  const requestingUser = msg instanceof Message ? msg.author : msg.user;

  let quotedUser : GuildUser;
  if (requestingUser.id === user.id) quotedUser = await guildUser;
  else quotedUser = await getUserGuildData(em, user, msg.guild);

  if (!quotedUser.quotes.isInitialized()) { await quotedUser.quotes.init(); }

  if (!quoteToAdd || quoteToAdd.length === 0) {
    if (quotedUser.quotes.length === 0) {
      return `${user.username} is niet populair en heeft nog geen quotes`;
    }

    if (quotedUser.quotes.length === 1) {
      return getQuoteEmbed(msg.channel, quotedUser.quotes[0], msg.client);
    }

    createMenu({
      list: quotedUser.quotes.getItems(),
      owner: requestingUser,
      msg,
      title: '**Kiest U Maar**',
      mapper: (q) => q.text,
      selectCallback: async (q) => {
        msg.channel.send({ embeds: [await getQuoteEmbed(msg.channel, q, msg.client)] }).catch(() => { });
      },
    });
    return null;
  }

  const quote = addQuote(quoteToAdd, quotedUser, await guildUser);
  if (typeof quote === 'string') return quote;

  return getQuoteEmbed(msg.channel, quote, msg.client);
};

router.use('user', handler, HandlerType.GUILD);
router.use('get', handler, HandlerType.GUILD, {
  description: 'Laat een quote van iemand zien',
  options: [
    {
      name: 'persoon',
      description: 'Persoon waarvan je een quote wil zien',
      type: 'USER',
      required: true,
    },
  ],
});
router.use('add', handler, HandlerType.GUILD, {
  description: 'Sla een quote op van iemand',
  options: [
    {
      name: 'persoon',
      description: 'Degene waarvoor je een quote wil toevoegen',
      type: 'USER',
      required: true,
    }, {
      name: 'quote',
      description: 'Quote die je wil toevoegen',
      type: 'STRING',
      required: true,
    },
  ],
});
router.use('toevoegen', handler, HandlerType.GUILD);

const removeHandler : GuildHandler = async ({
  msg, em, params, guildUser, flags,
}) => {
  const [user] = flags.get('user') || params;
  if (!(user instanceof DiscordUser)) {
    return 'Hoe moeilijk is het om daar een mention neer te zetten?';
  }

  if (params.length > 1) {
    return 'Alleen de gebruiker graag';
  }

  const requestingUser = msg instanceof Message ? msg.author : msg.user;

  const guToRemoveFrom = requestingUser.id === user.id ? (await guildUser) : await getUserGuildData(em, user, msg.guild);

  // Als iemand zijn eigen quotes ophaalt laat hij alles zien (of als degene admin is)
  // Anders laad alleen de quotes waar hij de creator van is
  const constraint = guToRemoveFrom.user.id === requestingUser.id || msg.member?.permissions.has(Permissions.FLAGS.ADMINISTRATOR)
    ? undefined : { where: { creator: await guildUser } };

  if (!guToRemoveFrom.quotes.isInitialized()) { await guToRemoveFrom.quotes.init(constraint); }

  const quotes = guToRemoveFrom.quotes.getItems();

  if (quotes.length < 1) {
    return 'Jij hebt geen quotes aangemaakt voor deze user';
  }

  const quotesToRemove : Set<Quote> = new Set<Quote>();

  const menuEm = em.fork();

  createMenu({
    list: quotes,
    owner: requestingUser,
    msg,
    title: '**Selecteer welke quote(s) je wil verwijderen**',
    mapper: (q) => `${quotesToRemove.has(q) ? '✅' : ''}${q.text}`,
    selectCallback: (q) => {
      if (quotesToRemove.has(q)) quotesToRemove.delete(q);
      else quotesToRemove.add(q);
      return false;
    },
    extraButtons: [
      [
        new MessageButton({
          label: '❌',
          customID: 'delete',
          style: 'DANGER',
        }),
        () => {
          quotesToRemove.forEach((q) => { menuEm.remove(q); });
          if (quotesToRemove.size > 0) msg.channel.send(`${quotesToRemove.size} quote${quotesToRemove.size !== 1 ? 's' : ''} verwijderd`);
          else msg.channel.send('Geen quote(s) verwijderd');
          menuEm.flush();
          return true;
        },
      ],
    ],
  });

  return null;
};

router.use('remove', removeHandler, HandlerType.GUILD, {
  description: 'Verwijder een quote van iemand',
  options: [
    {
      name: 'user',
      description: 'Gebruiker waarvan je een quote wil verwijderen',
      type: 'USER',
      required: true,
    },
  ],
});
router.use('delete', removeHandler, HandlerType.GUILD);
router.use('verwijder', removeHandler, HandlerType.GUILD);
router.use('verwijderen', removeHandler, HandlerType.GUILD);
router.use('manage', removeHandler, HandlerType.GUILD);

router.use('random', async ({ msg, em, guildUser }) => {
  const reference = msg instanceof Message ? msg.reference : undefined;
  const requestingUser = msg instanceof Message ? msg.author : msg.user;

  if (reference?.messageID) {
    const toQuote = await msg.channel.messages.fetch(`${BigInt(reference.messageID)}`, { cache: true }).catch(() => null);
    if (!toQuote) return 'Ik heb hard gezocht, maar kon het gegeven bericht is niet vinden';
    if (!toQuote.content) return 'Bericht heeft geen inhoud';

    const quotedUser = toQuote.author.id === requestingUser.id ? await guildUser : await getUserGuildData(em, toQuote.author, msg.guild);

    const splitted = toQuote.content.split(' ').filter((param) => param);

    const resolved = await parseParams(splitted, msg.client, msg.guild);

    const quote = addQuote(resolved, quotedUser, await guildUser);
    if (typeof quote === 'string') return quote;

    quote.date = new Date(toQuote.createdTimestamp);

    return getQuoteEmbed(msg.channel, quote, msg.client);
  }

  const quotes = await em.find(Quote, { guildUser: { guild: { id: msg.guild.id } } }, { populate: { guildUser: true, creator: true } });

  const quote = quotes[Math.floor(Math.random() * quotes.length)];

  if (quote) {
    return getQuoteEmbed(msg.channel, quote, msg.client);
  }

  return 'Deze server heeft nog geen quotes';
}, HandlerType.GUILD, {
  description: 'Krijg een random quote van de server',
});

router.use('help', () => [
  '**Hou quotes van je makkermaten bij!**',
  'Mogelijke Commandos:',
  '`ei quote random`: Verstuur een random quote van de server',
  '`ei quote get <@member>`: Verstuur een quote van dat persoon',
  '`ei quote add <@member> <quote>`: Sla een nieuwe quote op van dat persoon',
  '`ei quote remove <@member>`: Verwijder een selectie aan quotes van dat persoon',
  '> Je kan alleen de quotes verwijderen die je voor dat persoon geschreven hebt',
  '> Alleen quotes van jezelf kan je volledig beheren',
].join('\n'), HandlerType.BOTH, {
  description: 'Hulp menu voor quote\'s',
});

export default router;
