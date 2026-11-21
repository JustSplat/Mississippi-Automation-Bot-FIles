const {
    Client,
    GatewayIntentBits,
    Partials,
    ActivityType,
    EmbedBuilder,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    StringSelectMenuBuilder,
    PermissionFlagsBits
} = require('discord.js');

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
        throw new Error('Panel API is not configured in environment variables.');
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
// PASSWORD MANAGER UI
// ==========================================

function passwordManagerEmbed() {
    return new EmbedBuilder()
        .setColor(0x2563EB)
        .setTitle('🔐 Mississippi RP Panel Password Manager')
        .setDescription(
            'Use the buttons below to manage your website panel password.\n\n' +
            'This message is sent directly to you.'
        )
        .setFooter({ text: 'DEVID only • Mississippi RP' });
}

function passwordManagerButtons() {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('passreg_set')
            .setLabel('Set / Change Password')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🔑'),

        new ButtonBuilder()
            .setCustomId('passreg_delete')
            .setLabel('Delete Password')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🗑️')
    );
}

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
// ER:LC API COMMAND
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
            result.message || `ER:LC API error: ${response.status}`
        );
    }

    return result;
}

// ==========================================
// ER:LC PLAYER / STAFF DATA
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
// ER:LC EMBEDS & PAGINATION
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

    const items = list.slice(
        start,
        start + LIST_ITEMS_PER_PAGE
    );

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

    const embed = createListEmbed(listType, list, 0);

    const components = totalPages > 1
        ? [createListButtons(listType, 0, totalPages)]
        : [];

    await message.reply({
        embeds: [embed],
        components,
        allowedMentions: { repliedUser: false }
    });
}

// ==========================================
// AUTOMATIC ANNOUNCEMENTS
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
// SLASH COMMANDS
// ==========================================

const commands = [
    new SlashCommandBuilder()
        .setName('tpanel')
        .setDescription('Post the support ticket panel'),

    new SlashCommandBuilder()
        .setName('closerequest')
        .setDescription('Request staff to close this ticket'),

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
        )
].map(command => command.toJSON());

// ==========================================
// READY / COMMAND REFRESH
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
// PLAYER COUNT / BOT PRESENCE
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
    // DEVID ONLY
    // ======================================

    if (
        interaction.isButton() &&
        ['passreg_set', 'passreg_delete', 'passreg_delete_cancel', 'passreg_delete_confirm'].includes(interaction.customId)
    ) {
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
    // PASSWORD MODAL HANDLER
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
    // SLASH COMMAND HANDLER
    // ======================================

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    if (!['ingamecommand', 'announce'].includes(command)) return;

    try {
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
    // SECRET PASSWORD COMMAND
    // DEVID ONLY
    // ======================================

    // ======================================
    // ER:LC PLAYER / STAFF COMMANDS
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
    // PUBLIC -PING
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
// TICKET SYSTEM
// ==========================================

const GENERAL_TICKET_CATEGORY = '1567704667884888084';
const HIGH_RANK_TICKET_CATEGORY = '1573776599512518716';
const TICKET_PING_ROLE = '1567075807829164127';
const TICKET_STAFF_ROLE = process.env.TICKET_STAFF_ROLE_ID;

function isTicketChannel(channel) {
    return channel?.type === 0 && typeof channel.topic === 'string' && channel.topic.includes('ticket-owner=');
}

client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand() && interaction.commandName === 'tpanel') {
            if (interaction.user.id !== DEVID) {
                return interaction.reply({ content: 'You are not authorized to use this command.', ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle('Support Tickets')
                .setDescription(
                    'Choose your category below to open a ticket.\n\n' +
                    '⚙️ **General Support:** Questions, support, and assistance from staff members.\n' +
                    '👤 **High Rank Support:** Escalated concerns requiring senior staff attention.'
                );

            const menu = new StringSelectMenuBuilder()
                .setCustomId('ticket_category_select')
                .setPlaceholder('Choose your category')
                .addOptions(
                    {
                        label: 'General Support',
                        description: 'Questions and staff assistance',
                        value: 'general',
                        emoji: '⚙️'
                    },
                    {
                        label: 'High Rank Support',
                        description: 'Escalated concerns for senior staff',
                        value: 'highrank',
                        emoji: '👤'
                    }
                );

            await interaction.channel.send({
                embeds: [embed],
                components: [
                    new ActionRowBuilder().addComponents(menu)
                ]
            });

            return interaction.reply({
                content: 'Ticket panel posted.',
                ephemeral: true
            });
        }

        if (interaction.isChatInputCommand() && interaction.commandName === 'closerequest') {
            if (!isTicketChannel(interaction.channel)) {
                return interaction.reply({
                    content: 'This command only works inside a ticket.',
                    ephemeral: true
                });
            }

            if (
                !TICKET_STAFF_ROLE ||
                !interaction.member.roles.cache.has(TICKET_STAFF_ROLE)
            ) {
                return interaction.reply({
                    content: 'Only staff can use this command.',
                    ephemeral: true
                });
            }

            const embed = new EmbedBuilder()
                .setColor(0xED4245)
                .setTitle('Ticket Closure Requested')
                .setDescription(
                    `A staff member has requested this ticket be closed.\n\n` +
                    `**Requested by:** ${interaction.user}\n` +
                    `Please review and close this ticket when appropriate.`
                )
                .setTimestamp();

            return interaction.reply({
                content: `<@&${TICKET_STAFF_ROLE}>`,
                embeds: [embed]
            });
        }

        if (interaction.isStringSelectMenu() && interaction.customId === 'ticket_category_select') {
            await interaction.deferReply({ ephemeral: true });

            const choice = interaction.values[0];

            const categoryId = choice === 'general'
                ? GENERAL_TICKET_CATEGORY
                : HIGH_RANK_TICKET_CATEGORY;

            const categoryLabel = choice === 'general'
                ? 'General Support'
                : 'High Rank Support';

            const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);

            if (!category || category.type !== 4) {
                return interaction.editReply(
                    'Ticket category is missing or is not a category channel.'
                );
            }

            const alreadyOpen = interaction.guild.channels.cache.find(
                ch => ch.type === 0 && ch.topic?.includes(`ticket-owner=${interaction.user.id}`)
            );

            if (alreadyOpen) {
                return interaction.editReply(
                    `You already have a ticket open: ${alreadyOpen}`
                );
            }

            const channel = await interaction.guild.channels.create({
                name: `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20)}`,
                type: 0,
                parent: categoryId,
                topic: `ticket-owner=${interaction.user.id};ticket-type=${choice}`,
                permissionOverwrites: [
                    {
                        id: interaction.guild.roles.everyone.id,
                        deny: [PermissionFlagsBits.ViewChannel]
                    },
                    {
                        id: interaction.user.id,
                        allow: [
                            PermissionFlagsBits.ViewChannel,
                            PermissionFlagsBits.SendMessages,
                            PermissionFlagsBits.ReadMessageHistory,
                            PermissionFlagsBits.AttachFiles
                        ]
                    },
                    {
                        id: TICKET_PING_ROLE,
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
                ]
            });

            const ticketEmbed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(categoryLabel)
                .setDescription(
                    `Welcome ${interaction.user}!\n\n` +
                    `Please describe your issue and staff will assist you.\n\n` +
                    `**Category:** ${categoryLabel}`
                )
                .setTimestamp();

            const close = new ButtonBuilder()
                .setCustomId('ticket_close')
                .setLabel('Close Ticket')
                .setEmoji('🔒')
                .setStyle(ButtonStyle.Danger);

            await channel.send({
                content: `<@&${TICKET_PING_ROLE}> ${interaction.user}`,
                embeds: [ticketEmbed],
                components: [
                    new ActionRowBuilder().addComponents(close)
                ],
                allowedMentions: {
                    roles: [TICKET_PING_ROLE],
                    users: [interaction.user.id]
                }
            });

            return interaction.editReply(
                `Ticket created: ${channel}`
            );
        }

        if (interaction.isButton() && interaction.customId === 'ticket_close') {
            if (!isTicketChannel(interaction.channel)) {
                return interaction.reply({
                    content: 'This button only works in tickets.',
                    ephemeral: true
                });
            }

            await interaction.reply({
                content: `🔒 Ticket closed by ${interaction.user}.`
            });

            const ticketChannel = interaction.channel;

            setTimeout(() => {
                ticketChannel.delete(
                    `Ticket closed by ${interaction.user.tag}`
                ).catch(err => console.error('Ticket close error:', err));
            }, 3000);
        }

    } catch (err) {
        console.error('Ticket system error:', err);

        if (
            interaction.isRepliable() &&
            !interaction.replied &&
            !interaction.deferred
        ) {
            interaction.reply({
                content: 'Ticket interaction failed.',
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN).catch(error => {
    console.error('Bot login failed:', error);
});
