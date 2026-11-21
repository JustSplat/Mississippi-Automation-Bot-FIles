const {
    Client,
    GatewayIntentBits,
    Partials,
    ActivityType,
    EmbedBuilder,
    SlashCommandBuilder,
    AttachmentBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const fs = require('node:fs');
const path = require('node:path');

// ==========================================
// ENVIRONMENT
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;
const DEVID = process.env.DEVID;
const ERLC_API_KEY = process.env.ERLC_API_KEY;
const INGAME_ROLE_ID = process.env.INGAME_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;

const SESSION_PING_ROLE_ID = '1567075807619448860';
const SESSION_ROLE_ID = '1573525177298329692';

const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/+$/, '');
const PANEL_SETUP_KEY = process.env.PANEL_SETUP_KEY;

const GENERAL_TICKET_CATEGORY = '1567704667884888084';
const HIGH_RANK_TICKET_CATEGORY = '1573776599512518716';
const TICKET_PING_ROLE_ID = '1567075807829164127';
const TICKET_STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID;

// ==========================================
// FILES
// ==========================================

const SESSION_BANNER_PATH = path.join(__dirname, 'SESSIONBANNER.png');
const PROMO_BANNER_PATH = path.join(__dirname, 'PROMOBANNER.png');

// ==========================================
// STATUS ROTATION
// ==========================================

const ROTATING_STATUSES = [
    'ER:LC Players',
    'JMRP IS DA BEST 👀'
];

let statusIndex = 0;
const STATUS_ROTATION_INTERVAL = 15000;

// ==========================================
// AUTO MESSAGES
// ==========================================

const AUTO_MESSAGES = (process.env.AUTO_MESSAGES || '')
    .split('|')
    .map(m => m.trim())
    .filter(Boolean);

const AUTO_INTERVAL = Math.max(
    1,
    Number(process.env.AUTO_MESSAGE_INTERVAL_MINUTES) || 10
) * 60000;

if (!TOKEN || !DEVID || !GUILD_ID) {
    console.error('Missing DISCORD_TOKEN, DEVID, or GUILD_ID.');
    process.exit(1);
}

// ==========================================
// CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
});

let autoMessageTimer = null;
let autoMessageIndex = 0;

// ==========================================
// SESSION VOTING
// ==========================================

const VOTES_REQUIRED = 5;
const sessionVotes = new Map();

// ==========================================
// PERMISSIONS
// ==========================================

async function hasAccess(interaction) {
    if (interaction.user.id === DEVID) return true;
    if (!INGAME_ROLE_ID || !interaction.guild) return false;

    const member = await interaction.guild.members.fetch(interaction.user.id);
    return member.roles.cache.has(INGAME_ROLE_ID);
}

function hasTicketStaff(member) {
    return Boolean(
        TICKET_STAFF_ROLE_ID &&
        member?.roles?.cache?.has(TICKET_STAFF_ROLE_ID)
    );
}

// ==========================================
// PANEL API
// ==========================================

function panelConfigured() {
    return Boolean(PANEL_URL && PANEL_SETUP_KEY);
}

async function panelRequest(endpoint, body = {}) {
    if (!panelConfigured()) {
        throw new Error('Panel API is not configured.');
    }

    const response = await fetch(`${PANEL_URL}${endpoint}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-bot-setup-key': PANEL_SETUP_KEY
        },
        body: JSON.stringify(body)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Panel API error (${response.status})`);
    }

    return data;
}

// ==========================================
// PASSWORD MANAGER
// ==========================================

function passwordModal() {
    const modal = new ModalBuilder()
        .setCustomId('passreg_password_modal')
        .setTitle('Set Panel Password');

    const input = new TextInputBuilder()
        .setCustomId('panel_password')
        .setLabel('New panel password')
        .setPlaceholder('Enter a new secure password')
        .setStyle(TextInputStyle.Short)
        .setMinLength(12)
        .setMaxLength(128)
        .setRequired(true);

    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return modal;
}

function deleteConfirmationButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('passreg_delete_confirm')
            .setLabel('Confirm Delete')
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId('passreg_delete_cancel')
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );
}

// ==========================================
// ER:LC COMMAND API
// ==========================================

async function runERLCCommand(command) {
    if (!ERLC_API_KEY) {
        throw new Error('ER:LC API key is not configured.');
    }

    const cleanCommand = String(command).trim();

    if (!cleanCommand || cleanCommand.length > 120 || /[\r\n]/.test(cleanCommand)) {
        throw new Error('Invalid command.');
    }

    const finalCommand = cleanCommand.startsWith(':')
        ? cleanCommand
        : `:${cleanCommand}`;

    const response = await fetch('https://api.erlc.gg/v2/server/command', {
        method: 'POST',
        headers: {
            'server-key': ERLC_API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ command: finalCommand })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
        throw new Error(result.message || `ER:LC API error (${response.status})`);
    }

    return result;
}

// ==========================================
// ER:LC PLAYERS / STAFF
// ==========================================

async function getERLCPlayers() {
    if (!ERLC_API_KEY) {
        throw new Error('ER:LC API key is not configured.');
    }

    const response = await fetch('https://api.erlc.gg/v2/server?Players=true', {
        headers: { 'server-key': ERLC_API_KEY }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.message || `ER:LC API error (${response.status})`);
    }

    const players = Array.isArray(data) ? data : data.Players;

    if (!Array.isArray(players)) {
        throw new Error('Unexpected ER:LC players response.');
    }

    return players;
}

function playerName(player) {
    if (typeof player === 'string') return player;

    return player?.Username ??
        player?.username ??
        player?.Player ??
        player?.player ??
        player?.Name ??
        player?.name ??
        'Unknown Player';
}

function playerPermission(player) {
    return String(
        player?.Permission ??
        player?.permission ??
        player?.PermissionLevel ??
        player?.permission_level ??
        'Normal'
    ).trim();
}

function isStaffPlayer(player) {
    const permission = playerPermission(player).toLowerCase();

    return permission !== 'normal' &&
        permission !== '' &&
        permission !== 'unknown';
}

function staffLabel(permission) {
    const p = String(permission).toLowerCase();

    if (p.includes('owner')) return 'Owner';
    if (p.includes('admin')) return 'Administrator';
    if (p.includes('moderator') || p.includes('mod')) return 'Moderator';

    return permission || 'Staff';
}

// ==========================================
// ER:LC LISTS / PAGINATION
// ==========================================

const LIST_ITEMS_PER_PAGE = 10;

function createListEmbed(listType, list, page) {
    const totalPages = Math.max(
        1,
        Math.ceil(list.length / LIST_ITEMS_PER_PAGE)
    );

    const safePage = Math.max(0, Math.min(page, totalPages - 1));
    const start = safePage * LIST_ITEMS_PER_PAGE;
    const items = list.slice(start, start + LIST_ITEMS_PER_PAGE);
    const isStaff = listType === 'staff';

    const description = items.length
        ? items.map((item, index) => {
            const name = playerName(item);

            if (isStaff) {
                return `**${start + index + 1}.** ${name} — *${staffLabel(playerPermission(item))}*`;
            }

            return `**${start + index + 1}.** ${name}`;
        }).join('\n')
        : (isStaff
            ? 'No staff members are currently in-game.'
            : 'Nobody is currently in-game.');

    return new EmbedBuilder()
        .setColor(isStaff ? 0xE74C3C : 0x5865F2)
        .setTitle(`${isStaff ? 'Staff' : 'Players'} (${list.length})`)
        .setDescription(description)
        .setFooter({
            text: `Page ${safePage + 1}/${totalPages} • Mississippi RP`
        })
        .setTimestamp();
}

function createListButtons(listType, page, totalPages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`erlc_list:${listType}:${page - 1}`)
            .setLabel('Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page <= 0),

        new ButtonBuilder()
            .setCustomId(`erlc_list:${listType}:${page + 1}`)
            .setLabel('Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(page >= totalPages - 1)
    );
}

async function sendERLCList(message, listType) {
    const allPlayers = await getERLCPlayers();

    const list = listType === 'staff'
        ? allPlayers.filter(isStaffPlayer)
        : allPlayers.filter(player => !isStaffPlayer(player));

    const totalPages = Math.max(
        1,
        Math.ceil(list.length / LIST_ITEMS_PER_PAGE)
    );

    await message.reply({
        embeds: [createListEmbed(listType, list, 0)],
        components: totalPages > 1
            ? [createListButtons(listType, 0, totalPages)]
            : [],
        allowedMentions: { repliedUser: false }
    });
}

// ==========================================
// PROMOTIONS & INFRACTIONS
// ==========================================

function createPromotionEmbed(user, newRank, reason, promotedBy) {
    const embed = new EmbedBuilder()
        .setColor(0x6B2C5B)
        .addFields(
            {
                name: '🪪 Staff Member:',
                value: `${user}`,
                inline: false
            },
            {
                name: '📋 Promotion:',
                value: `**${newRank}**`,
                inline: false
            },
            {
                name: '📌 Reason:',
                value: reason,
                inline: false
            }
        )
        .setFooter({
            text: promotedBy.username,
            iconURL: promotedBy.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(PROMO_BANNER_PATH)) {
        embed.setImage('attachment://PROMOBANNER.png');
    }

    return embed;
}

function createInfractionEmbed(user, type, reason, issuedBy) {
    const embed = new EmbedBuilder()
        .setColor(0xA83232)
        .addFields(
            {
                name: '🪪 Staff Member:',
                value: `${user}`,
                inline: false
            },
            {
                name: '⚠️ Infraction:',
                value: `**${type}**`,
                inline: false
            },
            {
                name: '📌 Reason:',
                value: reason,
                inline: false
            }
        )
        .setFooter({
            text: issuedBy.username,
            iconURL: issuedBy.displayAvatarURL()
        })
        .setTimestamp();

    if (fs.existsSync(PROMO_BANNER_PATH)) {
        embed.setImage('attachment://PROMOBANNER.png');
    }

    return embed;
}

function getPromoBannerFiles() {
    if (!fs.existsSync(PROMO_BANNER_PATH)) {
        console.warn('PROMOBANNER.png not found. Sending embed without banner.');
        return [];
    }

    return [
        new AttachmentBuilder(PROMO_BANNER_PATH, {
            name: 'PROMOBANNER.png'
        })
    ];
}

// ==========================================
// AUTO ANNOUNCEMENTS
// ==========================================

async function sendAutoMessage() {
    if (AUTO_MESSAGES.length === 0) return;

    const message = AUTO_MESSAGES[autoMessageIndex];

    try {
        await runERLCCommand(`h ${message}`);
        console.log(`Automatic message sent: ${message}`);

        autoMessageIndex =
            (autoMessageIndex + 1) % AUTO_MESSAGES.length;

    } catch (error) {
        console.error('Automatic message error:', error.message);
    }
}

function startAutoMessages() {
    if (AUTO_MESSAGES.length === 0) {
        console.log('No automatic messages configured.');
        return;
    }

    if (autoMessageTimer) clearInterval(autoMessageTimer);

    autoMessageTimer = setInterval(sendAutoMessage, AUTO_INTERVAL);
    console.log('Automatic announcements enabled.');
}

// ==========================================
// SESSION EMBEDS
// ==========================================

function createSessionEmbed(action, voteCount = 0) {
    const joinInfo =
        'JOIN CODE: hsrUV\n' +
        'SERVER: Jackson Mississippi Role Play Strict VC Only\n' +
        'OWNER: nateplayzz';

    const signoff = '*Signed, JMRP Sessions Team.*';

    const details = {
        start: {
            title: '🟢 SESSION START UP',
            color: 0x2ECC71,
            text:
                'SESSION START UP!\n' +
            'Jackson Mississippi Roleplay Session!\n\n' +
            joinInfo + '\n' +
            signoff
        },
        low: {
            title: '🟡 SESSION LOW',
            color: 0xF1C40F,
            text:
                'Session Low on Players!\n' +
            'Join up to keep the session awake!\n\n' +
            joinInfo + '\n' +
            signoff
        },
        vote: {
            title: '🗳️ SESSION VOTE',
            color: 0x3498DB,
            text:
                'Session Vote in place!\n' +
            'Vote to get us to start the session!\n' +
            `Votes: ${voteCount}/${VOTES_REQUIRED}\n` +
            'If you voted you MUST join!\n\n' +
            joinInfo + '\n' +
            signoff
        },
        shutdown: {
            title: '🔴 SESSION SHUTDOWN',
            color: 0xE74C3C,
            text:
                'Session Shutdown!\n' +
            'Thanks for joining us for this session!\n' +
            'Vote up our next session!\n\n' +
            joinInfo + '\n' +
            signoff
        }
    };

    const selected = details[action];

    if (!selected) throw new Error('Unknown session action.');

    const embed = new EmbedBuilder()
        .setColor(selected.color)
        .setTitle(selected.title)
        .setDescription(selected.text)
        .setFooter({ text: 'JMRP Sessions Team' })
        .setTimestamp();

    if (fs.existsSync(SESSION_BANNER_PATH)) {
        embed.setImage('attachment://SESSIONBANNER.png');
    }

    const files = fs.existsSync(SESSION_BANNER_PATH)
        ? [
            new AttachmentBuilder(SESSION_BANNER_PATH, {
                name: 'SESSIONBANNER.png'
            })
        ]
        : [];

    return { embeds: [embed], files };
}

// ==========================================
// SESSION ANNOUNCEMENT PING
// ==========================================

async function sendSessionAnnouncement(channel, action, voteCount = 0) {
    return channel.send({
        content: `<@&${SESSION_PING_ROLE_ID}>`,
        ...createSessionEmbed(action, voteCount),
        allowedMentions: {
            roles: [SESSION_PING_ROLE_ID]
        }
    });
}

// ==========================================
// SESSION VOTE BUTTON
// ==========================================

function createVoteButtonRow(messageId, voteCount, completed = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`session_vote:${messageId}`)
            .setLabel(`Vote (${voteCount}/${VOTES_REQUIRED})`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(completed)
    );
}

// ==========================================
// TICKET SYSTEM
// ==========================================

function isTicketChannel(channel) {
    return channel?.type === ChannelType.GuildText &&
        typeof channel.topic === 'string' &&
        channel.topic.includes('ticket-owner=');
}

function ticketPanelEmbed() {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('🎫 Mississippi RP Support')
        .setDescription(
            'Need help? Select a ticket type from the menu below.\n\n' +
            '• **General Support** — General questions and assistance.\n' +
            '• **High Rank Support** — Support for high-ranking members.'
        )
        .setFooter({ text: 'Mississippi RP Support' });
}

function ticketPanelMenu() {
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId('ticket_create')
            .setPlaceholder('Select a ticket type...')
            .addOptions(
                {
                    label: 'General Support',
                    description: 'Open a general support ticket',
                    value: 'general',
                    emoji: '📩'
                },
                {
                    label: 'High Rank Support',
                    description: 'Open a high rank support ticket',
                    value: 'highrank',
                    emoji: '⭐'
                }
            )
    );
}

function ticketCloseRow() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('Close Ticket')
            .setEmoji('🔒')
            .setStyle(ButtonStyle.Danger)
    );
}

function ticketSafeName(name) {
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 25) || 'user';
}

function ticketCloseRequestEmbed(user) {
    return new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle('📨 Ticket Closure Requested')
        .setDescription(`${user} has requested that staff close this ticket.`)
        .setTimestamp();
}

function ticketWelcomeEmbed(user, ticketType) {
    return new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(ticketType === 'highrank'
            ? '⭐ High Rank Support'
            : '📩 General Support')
        .setDescription(
            `Welcome ${user}!\n\n` +
            'Please explain your issue below. Staff will respond when available.\n\n' +
            'Use the button below when you are finished.'
        )
        .setFooter({ text: 'Mississippi RP Support' })
        .setTimestamp();
}

// ==========================================
// SLASH COMMANDS
// ==========================================

const commands = [
    new SlashCommandBuilder()
        .setName('ingamecommand')
        .setDescription('Run an ER:LC server command')
        .addStringOption(option =>
            option.setName('command')
                .setDescription('ER:LC command to execute')
                .setRequired(true)
                .setMaxLength(120)
        ),

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send an announcement in ER:LC')
        .addStringOption(option =>
            option.setName('message')
                .setDescription('Announcement message')
                .setRequired(true)
                .setMaxLength(120)
        ),

    new SlashCommandBuilder()
        .setName('promote')
        .setDescription('Promote a staff member')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Staff member being promoted')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('newrank')
                .setDescription('New staff rank')
                .setRequired(true)
                .setMaxLength(100)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for promotion')
                .setRequired(true)
                .setMaxLength(1000)
        ),

    new SlashCommandBuilder()
        .setName('infraction')
        .setDescription('Record a staff infraction')
        .addUserOption(option =>
            option.setName('user')
                .setDescription('Staff member receiving the infraction')
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Infraction type')
                .setRequired(true)
                .setMaxLength(100)
        )
        .addStringOption(option =>
            option.setName('reason')
                .setDescription('Reason for infraction')
                .setRequired(true)
                .setMaxLength(1000)
        ),

    new SlashCommandBuilder()
        .setName('session')
        .setDescription('Post a JMRP session announcement')
        .addSubcommand(sub =>
            sub.setName('start')
                .setDescription('Announce session start')
        )
        .addSubcommand(sub =>
            sub.setName('shutdown')
                .setDescription('Announce session shutdown')
        )
        .addSubcommand(sub =>
            sub.setName('vote')
                .setDescription('Post a session vote')
        )
        .addSubcommand(sub =>
            sub.setName('low')
                .setDescription('Announce low session population')
        ),

    new SlashCommandBuilder()
        .setName('tpanel')
        .setDescription('Post the Mississippi RP ticket panel'),

    new SlashCommandBuilder()
        .setName('closerequest')
        .setDescription('Request staff to close the current ticket')
].map(command => command.toJSON());

// ==========================================
// READY
// ==========================================

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
        status: 'dnd',
        activities: [{
            name: 'Loading status...',
            type: ActivityType.Playing
        }]
    });

    try {
        await client.application.commands.set([]);

        const guild = await client.guilds.fetch(GUILD_ID);
        await guild.commands.set(commands);

        console.log('Slash commands successfully refreshed.');
    } catch (error) {
        console.error('Command refresh failed:', error);
    }

    rotateStatus();
    setInterval(rotateStatus, STATUS_ROTATION_INTERVAL);

    startAutoMessages();
});

// ==========================================
// ROTATING ER:LC BOT PRESENCE (DND)
// ==========================================

async function rotateStatus() {
    const currentStatus = ROTATING_STATUSES[statusIndex];

    if (currentStatus === 'ER:LC Players') {
        if (!ERLC_API_KEY) {
            client.user.setActivity('WAITING ER:LC API KEY 🗝️', {
                type: ActivityType.Playing
            });
        } else {
            try {
                const response = await fetch('https://api.erlc.gg/v2/server', {
                    headers: { 'server-key': ERLC_API_KEY }
                });

                if (!response.ok) {
                    throw new Error(`API returned ${response.status}`);
                }

                const data = await response.json();

                if (typeof data.CurrentPlayers !== 'number') {
                    throw new Error('Invalid player count response.');
                }

                client.user.setActivity(`ER:LC Players: ${data.CurrentPlayers}`, {
                    type: ActivityType.Playing
                });

                console.log(`ER:LC Players: ${data.CurrentPlayers}`);

            } catch (error) {
                console.error('Player count error:', error.message);

                client.user.setActivity('ER:LC Players Unavailable', {
                    type: ActivityType.Playing
                });
            }
        }
    } else {
        client.user.setActivity(currentStatus, {
            type: ActivityType.Playing
        });
    }

    statusIndex = (statusIndex + 1) % ROTATING_STATUSES.length;
}

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on('interactionCreate', async interaction => {
    try {

        // ======================================
        // TICKET SELECT MENU
        // ======================================

        if (
            interaction.isStringSelectMenu() &&
            interaction.customId === 'ticket_create'
        ) {
            const ticketType = interaction.values[0];

            const categoryId = ticketType === 'highrank'
                ? HIGH_RANK_TICKET_CATEGORY
                : GENERAL_TICKET_CATEGORY;

            const ticketLabel = ticketType === 'highrank'
                ? 'high-rank'
                : 'general';

            const existing = interaction.guild.channels.cache.find(channel =>
                isTicketChannel(channel) &&
                channel.topic.includes(`ticket-owner=${interaction.user.id}`) &&
                channel.topic.includes(`ticket-type=${ticketType}`)
            );

            if (existing) {
                return interaction.reply({
                    content: `You already have an open ticket: ${existing}`,
                    ephemeral: true
                });
            }

            await interaction.deferReply({ ephemeral: true });

            const overwrites = [
                {
                    id: interaction.guild.id,
                    deny: [PermissionFlagsBits.ViewChannel]
                },
                {
                    id: interaction.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                },
                {
                    id: TICKET_PING_ROLE_ID,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                },
                {
                    id: client.user.id,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.ManageChannels
                    ]
                }
            ];

            if (TICKET_STAFF_ROLE_ID) {
                overwrites.push({
                    id: TICKET_STAFF_ROLE_ID,
                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory
                    ]
                });
            }

            const ticketChannel = await interaction.guild.channels.create({
                name: `ticket-${ticketLabel}-${ticketSafeName(interaction.user.username)}`,
                type: ChannelType.GuildText,
                parent: categoryId,
                topic: `ticket-owner=${interaction.user.id};ticket-type=${ticketType}`,
                permissionOverwrites: overwrites
            });

            await ticketChannel.send({
                content: `<@${TICKET_PING_ROLE_ID}> <@${interaction.user.id}>`,
                embeds: [ticketWelcomeEmbed(interaction.user, ticketType)],
                components: [ticketCloseRow()],
                allowedMentions: {
                    users: [interaction.user.id],
                    roles: [TICKET_PING_ROLE_ID]
                }
            });

            return interaction.editReply({
                content: `✅ Your ticket has been created: ${ticketChannel}`
            });
        }

        // ======================================
        // TICKET CLOSE BUTTON
        // ======================================

        if (
            interaction.isButton() &&
            interaction.customId === 'ticket_close'
        ) {
            if (!isTicketChannel(interaction.channel)) {
                return interaction.reply({
                    content: 'This button can only be used in a ticket.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: '🔒 This ticket is being closed...',
                ephemeral: true
            });

            await interaction.channel.send({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xE74C3C)
                        .setTitle('🔒 Ticket Closed')
                        .setDescription(`Closed by ${interaction.user}.`)
                        .setTimestamp()
                ]
            }).catch(() => {});

            setTimeout(() => {
                interaction.channel.delete('Ticket closed by ticket participant').catch(() => {});
            }, 3000);

            return;
        }

        // ======================================
        // ER:LC PLAYER / STAFF PAGINATION
        // ======================================

        if (
            interaction.isButton() &&
            interaction.customId.startsWith('erlc_list:')
        ) {
            const [, listType, requestedPageRaw] =
                interaction.customId.split(':');

            if (!['players', 'staff'].includes(listType)) return;

            const requestedPage = Number(requestedPageRaw);

            if (!Number.isInteger(requestedPage) || requestedPage < 0) {
                return interaction.reply({
                    content: 'Invalid page.',
                    ephemeral: true
                }).catch(() => {});
            }

            await interaction.deferUpdate();

            const allPlayers = await getERLCPlayers();

            const list = listType === 'staff'
                ? allPlayers.filter(isStaffPlayer)
                : allPlayers.filter(player => !isStaffPlayer(player));

            const totalPages = Math.max(
                1,
                Math.ceil(list.length / LIST_ITEMS_PER_PAGE)
            );

            const page = Math.min(requestedPage, totalPages - 1);

            await interaction.editReply({
                embeds: [createListEmbed(listType, list, page)],
                components: totalPages > 1
                    ? [createListButtons(listType, page, totalPages)]
                    : []
            });

            return;
        }

        // ======================================
        // SESSION VOTE BUTTON
        // ======================================

        if (
            interaction.isButton() &&
            interaction.customId.startsWith('session_vote:')
        ) {
            const voteMessageId = interaction.customId.split(':')[1];
            const voteData = sessionVotes.get(voteMessageId);

            if (!voteData) {
                return interaction.reply({
                    content: 'This vote is no longer available.',
                    ephemeral: true
                });
            }

            if (voteData.completed) {
                return interaction.reply({
                    content: 'This vote has already reached its goal.',
                    ephemeral: true
                });
            }

            if (voteData.users.has(interaction.user.id)) {
                return interaction.reply({
                    content: 'You have already voted on this session!',
                    ephemeral: true
                });
            }

            voteData.users.add(interaction.user.id);
            const voteCount = voteData.users.size;

            await interaction.deferUpdate();

            await interaction.message.edit({
                embeds: [createSessionEmbed('vote', voteCount).embeds[0]],
                components: [
                    createVoteButtonRow(voteMessageId, voteCount, voteCount >= VOTES_REQUIRED)
                ]
            });

            if (voteCount >= VOTES_REQUIRED) {
                voteData.completed = true;

                await sendSessionAnnouncement(interaction.channel, 'start');

                await interaction.followUp({
                    content: '✅ 5 votes reached! Session Start announcement posted!',
                    ephemeral: true
                }).catch(() => {});

                return;
            }

            await interaction.followUp({
                content: `Your vote has been counted! **${voteCount}/${VOTES_REQUIRED}**`,
                ephemeral: true
            }).catch(() => {});

            return;
        }

        // ======================================
        // PASSWORD MANAGER BUTTONS (DEVID ONLY)
        // ======================================

        if (interaction.isButton() && interaction.customId.startsWith('passreg_')) {
            if (interaction.user.id !== DEVID) {
                return interaction.reply({
                    content: 'You are not authorized to use this panel.',
                    ephemeral: true
                }).catch(() => {});
            }

            if (interaction.customId === 'passreg_set') {
                return interaction.showModal(passwordModal());
            }

            if (interaction.customId === 'passreg_delete') {
                return interaction.reply({
                    content:
                        '⚠️ **Are you sure you want to delete the panel password?**\n' +
                        'This may prevent access to the website until a new password is registered.',
                    components: [deleteConfirmationButtons()],
                    ephemeral: true
                });
            }

            if (interaction.customId === 'passreg_delete_cancel') {
                return interaction.update({
                    content: 'Password deletion cancelled.',
                    components: []
                });
            }

            if (interaction.customId === 'passreg_delete_confirm') {
                await interaction.deferReply({ ephemeral: true });

                try {
                    await panelRequest('/api/delete-password');
                    return interaction.editReply('✅ Panel password deletion request completed.');
                } catch (error) {
                    return interaction.editReply(`❌ Unable to delete password: ${error.message}`);
                }
            }

            return;
        }

        // ======================================
        // PASSWORD MODAL
        // ======================================

        if (interaction.isModalSubmit()) {
            if (interaction.user.id !== DEVID) {
                return interaction.reply({
                    content: 'You are not authorized.',
                    ephemeral: true
                });
            }

            if (interaction.customId === 'passreg_password_modal') {
                await interaction.deferReply({ ephemeral: true });

                const password = interaction.fields.getTextInputValue('panel_password');

                try {
                    await panelRequest('/api/setup', { password });

                    return interaction.editReply(
                        '✅ Your Mississippi RP Panel password has been registered successfully.'
                    );
                } catch (error) {
                    return interaction.editReply(`❌ Password setup failed: ${error.message}`);
                }
            }
        }

        // ======================================
        // SLASH COMMANDS
        // ======================================

        if (!interaction.isChatInputCommand()) return;

        const command = interaction.commandName;

        // ======================================
        // /TPANEL - DEVID ONLY
        // ======================================

        if (command === 'tpanel') {
            if (interaction.user.id !== DEVID) {
                return interaction.reply({
                    content: 'Only DEVID can post the ticket panel.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                embeds: [ticketPanelEmbed()],
                components: [ticketPanelMenu()]
            });

            return;
        }

        // ======================================
        // /CLOSEREQUEST - STAFF ONLY
        // ======================================

        if (command === 'closerequest') {
            if (!isTicketChannel(interaction.channel)) {
                return interaction.reply({
                    content: 'This command can only be used inside a ticket.',
                    ephemeral: true
                });
            }

            const member = await interaction.guild.members.fetch(interaction.user.id);

            if (!hasTicketStaff(member)) {
                return interaction.reply({
                    content: 'Only ticket staff can request ticket closure.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: `<@&${TICKET_STAFF_ROLE_ID}>`,
                embeds: [ticketCloseRequestEmbed(interaction.user)],
                allowedMentions: { roles: [TICKET_STAFF_ROLE_ID] }
            });

            return;
        }

        if (![
            'ingamecommand',
            'announce',
            'session',
            'promote',
            'infraction'
        ].includes(command)) return;

        // ======================================
        // PROMOTION / INFRACTION COMMANDS
        // ======================================

        if (command === 'promote' || command === 'infraction') {
            if (!await hasAccess(interaction)) {
                return interaction.reply({
                    content: 'You do not have permission to use this command.',
                    ephemeral: true
                });
            }

            const targetUser = interaction.options.getUser('user');
            const reason = interaction.options.getString('reason');

            await interaction.deferReply();

            if (command === 'promote') {
                const newRank = interaction.options.getString('newrank');

                const embed = createPromotionEmbed(
                    targetUser,
                    newRank,
                    reason,
                    interaction.user
                );

                return interaction.editReply({
                    embeds: [embed],
                    files: getPromoBannerFiles()
                });
            }

            if (command === 'infraction') {
                const type = interaction.options.getString('type');

                const embed = createInfractionEmbed(
                    targetUser,
                    type,
                    reason,
                    interaction.user
                );

                return interaction.editReply({
                    embeds: [embed],
                    files: getPromoBannerFiles()
                });
            }
        }

        // ======================================
        // SESSION COMMANDS
        // ======================================

        if (command === 'session') {
            const member = await interaction.guild.members.fetch(interaction.user.id);

            if (!member.roles.cache.has(SESSION_ROLE_ID)) {
                return interaction.reply({
                    content: 'You do not have permission to use /session.',
                    ephemeral: true
                });
            }

            const action = interaction.options.getSubcommand(true);

            if (action === 'vote') {
                await interaction.deferReply({ ephemeral: true });

                const voteMessage = await sendSessionAnnouncement(
                    interaction.channel,
                    'vote',
                    0
                );

                sessionVotes.set(voteMessage.id, {
                    users: new Set(),
                    completed: false,
                    channelId: interaction.channelId
                });

                await voteMessage.edit({
                    components: [createVoteButtonRow(voteMessage.id, 0, false)]
                });

                return interaction.editReply({
                    content: 'Session vote posted!'
                });
            }

            await interaction.deferReply({ ephemeral: true });
            await sendSessionAnnouncement(interaction.channel, action);

            return interaction.editReply({
                content: 'Session announcement sent.'
            });
        }

        // ======================================
        // OTHER COMMAND PERMISSIONS
        // ======================================

        if (!await hasAccess(interaction)) {
            return interaction.reply({
                content: 'You do not have permission to use this command.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        if (command === 'ingamecommand') {
            const input = interaction.options.getString('command');
            const result = await runERLCCommand(input);

            return interaction.editReply(
                `✅ Command sent to ER:LC.\n${result.message || ''}`
            );
        }

        if (command === 'announce') {
            const message = interaction.options.getString('message');
            const result = await runERLCCommand(`h ${message}`);

            return interaction.editReply(
                `✅ Announcement sent!\n${result.message || ''}`
            );
        }

    } catch (error) {
        console.error('Interaction error:', error);

        const reply = {
            content: `❌ ${error.message}`,
            ephemeral: true
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(reply).catch(() => {});
        } else {
            await interaction.reply(reply).catch(() => {});
        }
    }
});

// ==========================================
// MESSAGE COMMANDS
// ==========================================

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    const content = message.content.trim().toLowerCase();

    // ======================================
    // ER:LC PLAYER / STAFF
    // ======================================

    if (
        content === '-erlc players' ||
        content === '-erlc staff'
    ) {
        const listType = content.endsWith('staff')
            ? 'staff'
            : 'players';

        try {
            await sendERLCList(message, listType);
        } catch (error) {
            console.error('ER:LC list command error:', error);

            await message.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0xED4245)
                        .setTitle('ER:LC API Error')
                        .setDescription('Unable to retrieve the requested list right now.')
                ]
            }).catch(() => {});
        }

        return;
    }

    // ======================================
    // -PING
    // ======================================

    if (content !== '-ping') return;

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Mississippi Automation | Pong!')
        .setDescription('Mississippi Automation is online and operational.')
        .addFields(
            {
                name: 'Bot Latency',
                value: `${client.ws.ping}ms`,
                inline: true
            },
            {
                name: 'Status',
                value: '🟢 Online',
                inline: true
            }
        )
        .setFooter({ text: 'Mississippi Automation' })
        .setTimestamp();

    await message.reply({
        embeds: [embed],
        allowedMentions: { repliedUser: false }
    });
});

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN).catch(error => {
    console.error('Bot login failed:', error);
});
