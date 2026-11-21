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
    TextInputStyle
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

const PANEL_URL = (process.env.PANEL_URL || '').replace(/\/+$/, '');
const PANEL_SETUP_KEY = process.env.PANEL_SETUP_KEY;

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

const SESSION_ROLE_ID = '1573525177298329692';
const SESSION_BANNER_PATH = path.join(__dirname, 'SESSIONBANNER.png');

const VOTES_REQUIRED = 5;

// Each vote message has its own voting data
const sessionVotes = new Map();

// ==========================================
// PERMISSIONS
// ==========================================

async function hasAccess(interaction) {
    if (interaction.user.id === DEVID) return true;

    if (!INGAME_ROLE_ID || !interaction.guild) return false;

    const member = await interaction.guild.members.fetch(
        interaction.user.id
    );

    return member.roles.cache.has(INGAME_ROLE_ID);
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

    modal.addComponents(
        new ActionRowBuilder().addComponents(input)
    );

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

    if (
        !cleanCommand ||
        cleanCommand.length > 120 ||
        /[\r\n]/.test(cleanCommand)
    ) {
        throw new Error('Invalid command.');
    }

    const finalCommand = cleanCommand.startsWith(':')
        ? cleanCommand
        : `:${cleanCommand}`;

    const response = await fetch(
        'https://api.erlc.gg/v2/server/command',
        {
            method: 'POST',
            headers: {
                'server-key': ERLC_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                command: finalCommand
            })
        }
    );

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.success === false) {
        throw new Error(
            result.message || `ER:LC API error (${response.status})`
        );
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

    const response = await fetch(
        'https://api.erlc.gg/v2/server?Players=true',
        {
            headers: {
                'server-key': ERLC_API_KEY
            }
        }
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.message || `ER:LC API error (${response.status})`
        );
    }

    const players = Array.isArray(data)
        ? data
        : data.Players;

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

    const safePage = Math.max(
        0,
        Math.min(page, totalPages - 1)
    );

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
        : (
            isStaff
                ? 'No staff members are currently in-game.'
                : 'Nobody is currently in-game.'
        );

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

    autoMessageTimer = setInterval(
        sendAutoMessage,
        AUTO_INTERVAL
    );

    console.log('Automatic announcements enabled.');
}

// ==========================================
// SESSION EMBEDS
// ==========================================

function createSessionEmbed(action, voteCount = 0) {

    const joinInfo =
        '`JOIN CODE: hsrUV`\n' +
        '`SERVER: Jackson Mississippi Role Play Strict VC Only`\n' +
        '`OWNER: nateplayzzs`';

    const signoff = '*Signed, JMRP Sessions Team.*';

    // NO BLANK LINES BETWEEN TEXT
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

    if (!selected) {
        throw new Error('Unknown session action.');
    }

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

    return {
        embeds: [embed],
        files
    };
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
        )
].map(command => command.toJSON());

// ==========================================
// READY
// ==========================================

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);

    client.user.setPresence({
        status: 'online',
        activities: [{
            name: 'WAITING ER:LC API KEY 🗝️',
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

    updateERLCStatus();
    setInterval(updateERLCStatus, 60000);

    startAutoMessages();
});

// ==========================================
// ER:LC BOT PRESENCE
// ==========================================

async function updateERLCStatus() {
    if (!ERLC_API_KEY) {
        client.user.setActivity('WAITING ER:LC API KEY 🗝️', {
            type: ActivityType.Playing
        });
        return;
    }

    try {
        const response = await fetch(
            'https://api.erlc.gg/v2/server',
            {
                headers: {
                    'server-key': ERLC_API_KEY
                }
            }
        );

        if (!response.ok) {
            throw new Error(`API returned ${response.status}`);
        }

        const data = await response.json();

        if (
            typeof data.CurrentPlayers !== 'number' ||
            typeof data.MaxPlayers !== 'number'
        ) {
            throw new Error('Invalid player count response.');
        }

        const playerCount = `${data.CurrentPlayers} Players In-game`;

        client.user.setActivity(playerCount, {
            type: ActivityType.Playing
        });

        console.log(`ER:LC Players: ${playerCount}`);

    } catch (error) {
        console.error('Player count error:', error.message);
    }
}

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on('interactionCreate', async interaction => {

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
            }).catch(() => {});
        }

        if (voteData.completed) {
            return interaction.reply({
                content: 'This vote has already reached its goal.',
                ephemeral: true
            }).catch(() => {});
        }

        if (voteData.users.has(interaction.user.id)) {
            return interaction.reply({
                content: 'You have already voted on this session!',
                ephemeral: true
            }).catch(() => {});
        }

        voteData.users.add(interaction.user.id);

        const voteCount = voteData.users.size;

        if (voteCount >= VOTES_REQUIRED) {
            voteData.completed = true;

            await interaction.deferUpdate();

            await interaction.message.edit({
                embeds: [createSessionEmbed('vote', VOTES_REQUIRED).embeds[0]],
                components: [
                    createVoteButtonRow(voteMessageId, VOTES_REQUIRED, true)
                ]
            });

            // Automatically post SESSION START when 5 votes are reached
            await interaction.channel.send({
                ...createSessionEmbed('start'),
                allowedMentions: { parse: [] }
            });

            await interaction.followUp({
                content: '✅ 5 votes reached! Session Start announcement posted!',
                ephemeral: true
            }).catch(() => {});

            return;
        }

        await interaction.deferUpdate();

        await interaction.message.edit({
            embeds: [createSessionEmbed('vote', voteCount).embeds[0]],
            components: [
                createVoteButtonRow(voteMessageId, voteCount, false)
            ]
        });

        await interaction.followUp({
            content: `Your vote has been counted! **${voteCount}/${VOTES_REQUIRED}**`,
            ephemeral: true
        }).catch(() => {});

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

        if (
            !Number.isInteger(requestedPage) ||
            requestedPage < 0
        ) {
            return interaction.reply({
                content: 'Invalid page.',
                ephemeral: true
            }).catch(() => {});
        }

        try {
            await interaction.deferUpdate();

            const allPlayers = await getERLCPlayers();

            const list = listType === 'staff'
                ? allPlayers.filter(isStaffPlayer)
                : allPlayers.filter(player => !isStaffPlayer(player));

            const totalPages = Math.max(
                1,
                Math.ceil(list.length / LIST_ITEMS_PER_PAGE)
            );

            const page = Math.min(
                requestedPage,
                totalPages - 1
            );

            await interaction.editReply({
                embeds: [createListEmbed(listType, list, page)],
                components: totalPages > 1
                    ? [createListButtons(listType, page, totalPages)]
                    : []
            });

        } catch (error) {
            console.error('ER:LC list pagination error:', error);

            await interaction.followUp({
                content: 'Unable to refresh this list right now.',
                ephemeral: true
            }).catch(() => {});
        }

        return;
    }

    // ======================================
    // PASSWORD MANAGER BUTTONS
    // ======================================

    if (interaction.isButton()) {

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

                return interaction.editReply(
                    '✅ Panel password deletion request completed.'
                );

            } catch (error) {
                return interaction.editReply(
                    `❌ Unable to delete password: ${error.message}`
                );
            }
        }
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

            const password = interaction.fields.getTextInputValue(
                'panel_password'
            );

            try {
                await panelRequest('/api/setup', { password });

                return interaction.editReply(
                    '✅ Your Mississippi RP Panel password has been registered successfully.'
                );

            } catch (error) {
                return interaction.editReply(
                    `❌ Password setup failed: ${error.message}`
                );
            }
        }
    }

    // ======================================
    // SLASH COMMANDS
    // ======================================

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    if (!['ingamecommand', 'announce', 'session'].includes(command)) return;

    try {

        // ==================================
        // SESSION COMMANDS
        // ==================================

        if (command === 'session') {

            const member = await interaction.guild.members.fetch(
                interaction.user.id
            );

            if (!member.roles.cache.has(SESSION_ROLE_ID)) {
                return interaction.reply({
                    content: 'You do not have permission to use /session.',
                    ephemeral: true
                });
            }

            const action = interaction.options.getSubcommand(true);

            // SESSION VOTE
            if (action === 'vote') {
                await interaction.deferReply({ ephemeral: true });

                const voteMessage = await interaction.channel.send({
                    ...createSessionEmbed('vote', 0),
                    allowedMentions: { parse: [] }
                });

                sessionVotes.set(voteMessage.id, {
                    users: new Set(),
                    completed: false,
                    channelId: interaction.channelId
                });

                await voteMessage.edit({
                    components: [
                        createVoteButtonRow(voteMessage.id, 0, false)
                    ]
                });

                return interaction.editReply({
                    content: 'Session vote posted!'
                });
            }

            // START / SHUTDOWN / LOW
            await interaction.deferReply({ ephemeral: true });

            await interaction.channel.send({
                ...createSessionEmbed(action),
                allowedMentions: { parse: [] }
            });

            return interaction.editReply({
                content: 'Session announcement sent.'
            });
        }

        // ==================================
        // OTHER COMMAND PERMISSIONS
        // ==================================

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
        console.error('Command error:', error);

        const reply = {
            content: `❌ ${error.message}`,
            ephemeral: true
        };

        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(reply);
        } else {
            await interaction.reply(reply);
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
                        .setDescription(
                            'Unable to retrieve the requested list right now.'
                        )
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
