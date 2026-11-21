
const {
    EmbedBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const GENERAL_CATEGORY_ID = '1567704667884888084';
const HIGH_RANK_CATEGORY_ID = '1573776599512518716';
const PING_ROLE_ID = '1567075807829164127';

const DEVID = process.env.DEVID;
const STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID;

const ticketCommands = [
    new SlashCommandBuilder()
        .setName('tpanel')
        .setDescription('Post the ticket support panel'),

    new SlashCommandBuilder()
        .setName('closerequest')
        .setDescription('Request staff to close this ticket')
];

function isTicket(channel) {
    return channel &&
        channel.type === ChannelType.GuildText &&
        channel.topic &&
        channel.topic.includes('ticket-owner=');
}

function setupTickets(client) {

    client.on('interactionCreate', async interaction => {
        try {

            // ==========================================
            // /TPANEL
            // ==========================================

            if (interaction.isChatInputCommand() &&
                interaction.commandName === 'tpanel') {

                if (interaction.user.id !== DEVID) {
                    return interaction.reply({
                        content: 'You are not authorized to use this command.',
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setColor(0x5865F2)
                    .setTitle('Support Tickets')
                    .setDescription(
                        'Need assistance? Select a category below to open a support ticket.\n\n' +
                        '⚙️ **General Support** — Questions, support, and assistance from staff.\n' +
                        '👤 **High Rank Support** — Escalated concerns requiring senior staff attention.'
                    )
                    .setFooter({ text: 'Mississippi Support' });

                const menu = new StringSelectMenuBuilder()
                    .setCustomId('ticket_category_select')
                    .setPlaceholder('Choose your category')
                    .addOptions([
                        {
                            label: 'General Support',
                            description: 'Questions, support, and staff assistance',
                            value: 'general',
                            emoji: '⚙️'
                        },
                        {
                            label: 'High Rank Support',
                            description: 'Escalated concerns for senior staff',
                            value: 'highrank',
                            emoji: '👤'
                        }
                    ]);

                const row = new ActionRowBuilder()
                    .addComponents(menu);

                await interaction.reply({
                    content: 'Ticket panel posted.',
                    ephemeral: true
                });

                await interaction.channel.send({
                    embeds: [embed],
                    components: [row]
                });

                return;
            }

            // ==========================================
            // /CLOSEREQUEST
            // ==========================================

            if (interaction.isChatInputCommand() &&
                interaction.commandName === 'closerequest') {

                if (!isTicket(interaction.channel)) {
                    return interaction.reply({
                        content: 'This command only works inside a ticket.',
                        ephemeral: true
                    });
                }

                if (!STAFF_ROLE_ID ||
                    !interaction.member.roles.cache.has(STAFF_ROLE_ID)) {
                    return interaction.reply({
                        content: 'Only staff members can request ticket closure.',
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle('Ticket Closure Requested')
                    .setDescription(
                        `A staff member has requested that this ticket be closed.\n\n` +
                        `**Requested by:** ${interaction.user}\n` +
                        `Please review this ticket and close it when appropriate.`
                    )
                    .setTimestamp();

                await interaction.reply({
                    content: `<@&${STAFF_ROLE_ID}>`,
                    embeds: [embed]
                });

                return;
            }

            // ==========================================
            // CATEGORY SELECT MENU
            // ==========================================

            if (interaction.isStringSelectMenu() &&
                interaction.customId === 'ticket_category_select') {

                await interaction.deferReply({ ephemeral: true });

                const guild = interaction.guild;
                const selected = interaction.values[0];

                const categoryID =
                    selected === 'general'
                        ? GENERAL_CATEGORY_ID
                        : HIGH_RANK_CATEGORY_ID;

                const categoryName =
                    selected === 'general'
                        ? 'General Support'
                        : 'High Rank Support';

                const category = guild.channels.cache.get(categoryID);

                if (!category) {
                    return interaction.editReply(
                        'The configured ticket category could not be found.'
                    );
                }

                // Prevent multiple open tickets
                const existing = guild.channels.cache.find(channel =>
                    channel.type === ChannelType.GuildText &&
                    channel.topic &&
                    channel.topic.includes(`ticket-owner=${interaction.user.id}`)
                );

                if (existing) {
                    return interaction.editReply(
                        `You already have an open ticket: ${existing}`
                    );
                }

                const safeName = interaction.user.username
                    .toLowerCase()
                    .replace(/[^a-z0-9]/g, '-')
                    .slice(0, 20);

                const channel = await guild.channels.create({
                    name: `ticket-${safeName}`,
                    type: ChannelType.GuildText,
                    parent: categoryID,
                    topic: `ticket-owner=${interaction.user.id};ticket-type=${selected}`,
                    permissionOverwrites: [
                        {
                            id: guild.roles.everyone.id,
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
                            id: PING_ROLE_ID,
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
                    .setTitle(`${categoryName}`)
                    .setDescription(
                        `Welcome ${interaction.user}!\n\n` +
                        `Please explain your issue and a staff member will assist you.\n\n` +
                        `**Ticket Category:** ${categoryName}`
                    )
                    .setTimestamp();

                const closeButton = new ButtonBuilder()
                    .setCustomId('ticket_close')
                    .setLabel('Close Ticket')
                    .setEmoji('🔒')
                    .setStyle(ButtonStyle.Danger);

                const buttonRow = new ActionRowBuilder()
                    .addComponents(closeButton);

                await channel.send({
                    content: `<@&${PING_ROLE_ID}> ${interaction.user}`,
                    embeds: [ticketEmbed],
                    components: [buttonRow]
                });

                await interaction.editReply(
                    `Your ticket has been created: ${channel}`
                );

                return;
            }

            // ==========================================
            // CLOSE BUTTON (ANYONE)
            // ==========================================

            if (interaction.isButton() &&
                interaction.customId === 'ticket_close') {

                if (!isTicket(interaction.channel)) {
                    return interaction.reply({
                        content: 'This button can only be used in a ticket.',
                        ephemeral: true
                    });
                }

                await interaction.reply({
                    content: `🔒 Ticket closed by ${interaction.user}.`
                });

                setTimeout(async () => {
                    try {
                        await interaction.channel.delete(
                            `Ticket closed by ${interaction.user.tag}`
                        );
                    } catch (err) {
                        console.error('Ticket close error:', err);
                    }
                }, 3000);

                return;
            }

        } catch (error) {
            console.error('Ticket system error:', error);

            if (interaction.isRepliable() &&
                !interaction.replied &&
                !interaction.deferred) {
                await interaction.reply({
                    content: 'An error occurred while processing this ticket interaction.',
                    ephemeral: true
                }).catch(() => {});
            }
        }
    });
}

module.exports = {
    setupTickets,
    ticketCommands
};
