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
    StringSelectMenuBuilder,
    ChannelType,
    PermissionFlagsBits
} = require("discord.js");

const https = require("https");

// ==================================================
// ENVIRONMENT
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const DEVID = process.env.DEVID;
const ERLC_API_KEY = process.env.ERLC_API_KEY;
const GUILD_ID = process.env.GUILD_ID;

const INGAME_ROLE_ID = process.env.INGAME_ROLE_ID;
const TICKET_STAFF_ROLE_ID = process.env.TICKET_STAFF_ROLE_ID;

const PROMOTION_ROLE_ID = "1573769800872632492";
const SESSION_HOST_ROLE_ID = "1573525177298329692";
const SESSION_PING_ROLE_ID = "1567075807619448860";

const GENERAL_SUPPORT_CATEGORY = "1567704667884888084";
const HIGH_RANK_SUPPORT_CATEGORY = "1573776599512518716";
const TICKET_PING_ROLE = "1567075807829164127";

const PANEL_URL = process.env.PANEL_URL;
const PANEL_SETUP_KEY = process.env.PANEL_SETUP_KEY;

const SESSION_CODE = "hsrUV";
const SESSION_SERVER = "Jackson Mississippi Role Play Strict VC Only";
const SESSION_OWNER = "nateplayzzs";

const PREFIX = "-";

// ==================================================
// CLIENT
// ==================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

// ==================================================
// HELPERS
// ==================================================

function isDeveloper(userId) {
    return userId === DEVID;
}

function hasRole(member, roleId) {
    return member?.roles?.cache?.has(roleId) ?? false;
}

function erlcRequest(path, method = "GET", body = null) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;

        const req = https.request(
            `https://api.erlc.gg/v2${path}`,
            {
                method,
                headers: {
                    "server-key": ERLC_API_KEY,
                    "Content-Type": "application/json"
                }
            },
            res => {
                let response = "";

                res.on("data", chunk => response += chunk);
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(response));
                    } catch {
                        resolve(response);
                    }
                });
            }
        );

        req.on("error", reject);

        if (data) req.write(data);
        req.end();
    });
}

function makeEmbed(title, description, color = 0x5865F2) {
    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();
}

function makeBannerEmbed(title, fields, bannerName) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(title)
        .setTimestamp();

    for (const field of fields) {
        embed.addFields({
            name: field.name,
            value: field.value || "N/A",
            inline: field.inline ?? false
        });
    }

    const attachment = new AttachmentBuilder(`./${bannerName}`);

    embed.setImage(`attachment://${bannerName}`);

    return { embed, attachment };
}

// ==================================================
// SLASH COMMANDS
// ==================================================

const commands = [

    new SlashCommandBuilder()
        .setName("promote")
        .setDescription("Promote a staff member")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Staff member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("rank")
                .setDescription("New rank")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Promotion reason")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("infraction")
        .setDescription("Issue a staff infraction")
        .addUserOption(option =>
            option.setName("user")
                .setDescription("Staff member")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("type")
                .setDescription("Infraction type")
                .setRequired(true)
        )
        .addStringOption(option =>
            option.setName("reason")
                .setDescription("Reason")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("session")
        .setDescription("Manage server sessions")
        .addSubcommand(sub =>
            sub.setName("start")
                .setDescription("Start a session")
        )
        .addSubcommand(sub =>
            sub.setName("shutdown")
                .setDescription("Shutdown a session")
        )
        .addSubcommand(sub =>
            sub.setName("vote")
                .setDescription("Start a session vote")
        )
        .addSubcommand(sub =>
            sub.setName("low")
                .setDescription("Announce low session activity")
        ),

    new SlashCommandBuilder()
        .setName("ingamecommand")
        .setDescription("Execute an ERLC server command")
        .addStringOption(option =>
            option.setName("command")
                .setDescription("ERLC command")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("announce")
        .setDescription("Send an announcement")
        .addStringOption(option =>
            option.setName("message")
                .setDescription("Announcement message")
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName("tpanel")
        .setDescription("Create a support ticket panel"),

    new SlashCommandBuilder()
        .setName("closerequest")
        .setDescription("Close the current support ticket")
];


// ==================================================
// SESSION VOTES
// ==================================================

const sessionVotes = new Map();

function createSessionEmbed() {
    return new EmbedBuilder()
        .setColor(0x3498DB)
        .setTitle("Mississippi Roleplay | Session")
        .setDescription(
            `**Server:** ${SESSION_SERVER}\n` +
            `**Owner:** ${SESSION_OWNER}\n` +
            `**Join Code:** \`${SESSION_CODE}\`\n\n` +
            `Join the server and participate in the session!`
        )
        .setImage("attachment://SESSIONBANNER.png")
        .setTimestamp();
}

async function announceSession(channel, startedBy) {
    const embed = createSessionEmbed();

    await channel.send({
        content: `<@&${SESSION_PING_ROLE_ID}>`,
        embeds: [embed],
        files: ["./SESSIONBANNER.png"]
    });
}

async function shutdownSession(channel, user) {
    const embed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle("Mississippi Roleplay | Session Shutdown")
        .setDescription(
            `The session has officially shut down.\n\n` +
            `**Shutdown by:** ${user}\n` +
            `Thank you for attending!`
        )
        .setTimestamp();

    await channel.send({
        content: `<@&${SESSION_PING_ROLE_ID}>`,
        embeds: [embed]
    });
}

function createVoteEmbed(votes) {
    return new EmbedBuilder()
        .setColor(0xF1C40F)
        .setTitle("Mississippi Roleplay | Session Vote")
        .setDescription(
            `A session vote is currently running!\n\n` +
            `**Votes:** ${votes}/5\n\n` +
            `Click the button below to vote for a session.`
        )
        .setTimestamp();
}

async function startSessionVote(channel) {
    const voteData = {
        voters: new Set(),
        channelId: channel.id,
        messageId: null
    };

    const button = new ButtonBuilder()
        .setCustomId("session_vote_button")
        .setLabel("Vote for Session")
        .setStyle(ButtonStyle.Success);

    const row = new ActionRowBuilder().addComponents(button);

    const message = await channel.send({
        content: `<@&${SESSION_PING_ROLE_ID}>`,
        embeds: [createVoteEmbed(0)],
        components: [row]
    });

    voteData.messageId = message.id;
    sessionVotes.set(message.id, voteData);
}

// ==================================================
// TICKET SYSTEM
// ==================================================

async function createTicketPanel(channel) {
    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle("Mississippi RP | Support")
        .setDescription(
            "Select a ticket category from the dropdown below.\n\n" +
            "**General Support** — General questions and assistance.\n" +
            "**High Rank Support** — High-ranking staff assistance."
        )
        .setTimestamp();

    const menu = new StringSelectMenuBuilder()
        .setCustomId("ticket_category_select")
        .setPlaceholder("Select a ticket category")
        .addOptions(
            {
                label: "General Support",
                description: "Get general help and support",
                value: "general"
            },
            {
                label: "High Rank Support",
                description: "Contact high-ranking staff",
                value: "highrank"
            }
        );

    await channel.send({
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu)
        ]
    });
}

async function createTicket(interaction, type) {
    const categoryId = type === "general"
        ? GENERAL_SUPPORT_CATEGORY
        : HIGH_RANK_SUPPORT_CATEGORY;

    const categoryName = type === "general"
        ? "General Support"
        : "High Rank Support";

    const existing = interaction.guild.channels.cache.find(channel =>
        channel.topic?.includes(`ticket-owner=${interaction.user.id}`)
    );

    if (existing) {
        return interaction.reply({
            content: `You already have an open ticket: ${existing}`,
            ephemeral: true
        });
    }

    const ticketChannel = await interaction.guild.channels.create({
        name: `${type}-${interaction.user.username}`
            .toLowerCase()
            .replace(/[^a-z0-9-]/g, ""),
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: `ticket-owner=${interaction.user.id};ticket-type=${type}`,
        permissionOverwrites: [
            {
                id: interaction.guild.id,
                deny: [PermissionFlagsBits.ViewChannel]
            },
            {
                id: interaction.user.id,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            },
            ...(TICKET_STAFF_ROLE_ID ? [{
                id: TICKET_STAFF_ROLE_ID,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            }] : [])
        ]
    });

    const closeButton = new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Close Ticket")
        .setStyle(ButtonStyle.Danger);

    const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`${categoryName}`)
        .setDescription(
            `Welcome ${interaction.user}!\n\n` +
            `Please explain your issue and wait for a staff member to respond.`
        )
        .setTimestamp();

    await ticketChannel.send({
        content: `<@${interaction.user.id}> <@&${TICKET_PING_ROLE}>`,
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(closeButton)
        ]
    });

    await interaction.reply({
        content: `Your ticket has been created: ${ticketChannel}`,
        ephemeral: true
    });
}

// ==================================================
// ERLC PLAYERS / STAFF
// ==================================================

async function getPlayers() {
    const data = await erlcRequest("/server?Players=true");
    return data?.Players || [];
}

async function getStaff() {
    const data = await erlcRequest("/server?Staff=true");
    return data?.Staff || [];
}

async function sendList(message, title, entries) {
    const items = Array.isArray(entries) ? entries : [];

    if (!items.length) {
        return message.reply(`${title}: Nobody found.`);
    }

    const chunks = [];

    for (let i = 0; i < items.length; i += 10) {
        chunks.push(items.slice(i, i + 10));
    }

    let page = 0;

    const buildEmbed = () => {
        const current = chunks[page];

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle(`${title} (${items.length})`)
            .setDescription(
                current.map((player, index) =>
                    `**${(page * 10) + index + 1}.** ` +
                    `${typeof player === "string" ? player : player.Player || player.Name || "Unknown"}`
                ).join("\n")
            )
            .setFooter({ text: `Page ${page + 1}/${chunks.length}` })
            .setTimestamp();

        return embed;
    };

    const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("list_previous")
            .setLabel("Previous")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(true),
        new ButtonBuilder()
            .setCustomId("list_next")
            .setLabel("Next")
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(chunks.length <= 1)
    );

    const response = await message.reply({
        embeds: [buildEmbed()],
        components: [buttons]
    });

    const collector = response.createMessageComponentCollector({
        time: 120000
    });

    collector.on("collect", async interaction => {
        if (interaction.user.id !== message.author.id) {
            return interaction.reply({
                content: "This list belongs to someone else.",
                ephemeral: true
            });
        }

        if (interaction.customId === "list_previous") page--;
        if (interaction.customId === "list_next") page++;

        page = Math.max(0, Math.min(page, chunks.length - 1));

        const updatedButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("list_previous")
                .setLabel("Previous")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === 0),
            new ButtonBuilder()
                .setCustomId("list_next")
                .setLabel("Next")
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(page === chunks.length - 1)
        );

        await interaction.update({
            embeds: [buildEmbed()],
            components: [updatedButtons]
        });
    });

    collector.on("end", async () => {
        try {
            await response.edit({ components: [] });
        } catch {}
    });
}

// ==================================================
// READY
// ==================================================

client.once("ready", async () => {
    console.log(`${client.user.tag} is online.`);

    try {
        const guild = await client.guilds.fetch(GUILD_ID);

        await client.application.commands.set([]);

        await guild.commands.set(commands.map(command => command.toJSON()));

        console.log("Slash commands registered.");
    } catch (error) {
        console.error("Command registration error:", error);
    }

    // Presence
    async function updatePresence() {
        try {
            const data = await erlcRequest("/server");

            const players = data?.CurrentPlayers ?? 0;

            client.user.setPresence({
                activities: [{
                    name: `${players} Players In-game`,
                    type: ActivityType.Playing
                }],
                status: "online"
            });
        } catch {
            client.user.setPresence({
                activities: [{
                    name: "Mississippi RP",
                    type: ActivityType.Playing
                }],
                status: "online"
            });
        }
    }

    updatePresence();
    setInterval(updatePresence, 60000);

    // Auto announcements
    const autoMessages = process.env.AUTO_MESSAGES;

    if (autoMessages) {
        const messages = autoMessages.split("|").filter(Boolean);

        const interval = Number(
            process.env.AUTO_MESSAGE_INTERVAL_MINUTES || 10
        ) * 60000;

        if (messages.length > 0) {
            setInterval(async () => {
                try {
                    const data = await erlcRequest("/server");

                    const channelId = data?.DiscordCode
                        ? data.DiscordCode
                        : null;

                    if (!channelId) return;

                    const channel = await client.channels.fetch(channelId);

                    if (!channel) return;

                    const randomMessage =
                        messages[Math.floor(Math.random() * messages.length)];

                    await channel.send(randomMessage);
                } catch (error) {
                    console.log("Auto message error:", error.message);
                }
            }, interval);
        }
    }
});

// ==================================================
// MESSAGE COMMANDS
// ==================================================

client.on("messageCreate", async message => {
    if (message.author.bot) return;

    const content = message.content.trim();

    // PING
    if (content === "-ping") {
        return message.reply(`Pong! **${client.ws.ping}ms**`);
    }

    // ERLC PLAYERS
    if (content.toLowerCase() === "-erlc players") {
        try {
            const players = await getPlayers();
            return sendList(message, "Players", players);
        } catch {
            return message.reply("Unable to retrieve ER:LC players.");
        }
    }

    // ERLC STAFF
    if (content.toLowerCase() === "-erlc staff") {
        try {
            const staff = await getStaff();
            return sendList(message, "Staff", staff);
        } catch {
            return message.reply("Unable to retrieve ER:LC staff.");
        }
    }
});

// ==================================================
// INTERACTIONS
// ==================================================

client.on("interactionCreate", async interaction => {

    // ==============================================
    // TICKET DROPDOWN
    // ==============================================

    if (interaction.isStringSelectMenu()) {
        if (interaction.customId === "ticket_category_select") {
            const type = interaction.values[0];
            return createTicket(interaction, type);
        }
    }

    // ==============================================
    // SESSION VOTING
    // ==============================================

    if (interaction.isButton()) {
        if (interaction.customId === "session_vote_button") {
            const voteData = sessionVotes.get(interaction.message.id);

            if (!voteData) {
                return interaction.reply({
                    content: "This vote is no longer active.",
                    ephemeral: true
                });
            }

            if (voteData.voters.has(interaction.user.id)) {
                return interaction.reply({
                    content: "You already voted!",
                    ephemeral: true
                });
            }

            voteData.voters.add(interaction.user.id);

            const count = voteData.voters.size;

            if (count >= 5) {
                sessionVotes.delete(interaction.message.id);

                await interaction.message.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setColor(0x57F287)
                            .setTitle("Session Vote Passed!")
                            .setDescription("5 votes received. The session is starting!")
                    ],
                    components: []
                });

                await announceSession(interaction.channel, interaction.user);

                return interaction.reply({
                    content: "Vote counted! The session has reached 5 votes.",
                    ephemeral: true
                });
            }

            await interaction.message.edit({
                embeds: [createVoteEmbed(count)]
            });

            return interaction.reply({
                content: `Your vote has been counted! **${count}/5**`,
                ephemeral: true
            });
        }

        // CLOSE TICKET
        if (interaction.customId === "ticket_close") {
            await interaction.reply("Closing ticket in 3 seconds...");

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch {}
            }, 3000);

            return;
        }
    }

    // ==============================================
    // SLASH COMMANDS
    // ==============================================

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    // ==============================================
    // PROMOTION
    // ==============================================

    if (command === "promote") {
        if (!hasRole(interaction.member, PROMOTION_ROLE_ID)) {
            return interaction.reply({
                content: "You need the authorized Promotions/Infractions role to use this command.",
                ephemeral: true
            });
        }

        const user = interaction.options.getUser("user");
        const rank = interaction.options.getString("rank");
        const reason = interaction.options.getString("reason");

        const { embed, attachment } = makeBannerEmbed(
            "Staff Promotion",
            [
                { name: "Staff Member", value: `${user}`, inline: true },
                { name: "New Rank", value: rank, inline: true },
                { name: "Promoted By", value: `${interaction.user}`, inline: true },
                { name: "Reason", value: reason }
            ],
            "PROMOBANNER.png"
        );

        embed.setFooter({
            text: `Promotion issued by ${interaction.user.username}`,
            iconURL: interaction.user.displayAvatarURL()
        });

        return interaction.reply({
            embeds: [embed],
            files: [attachment]
        });
    }

    // ==============================================
    // INFRACTION
    // ==============================================

    if (command === "infraction") {
        if (!hasRole(interaction.member, PROMOTION_ROLE_ID)) {
            return interaction.reply({
                content: "You need the authorized Promotions/Infractions role to use this command.",
                ephemeral: true
            });
        }

        const user = interaction.options.getUser("user");
        const type = interaction.options.getString("type");
        const reason = interaction.options.getString("reason");

        const { embed, attachment } = makeBannerEmbed(
            "Staff Infraction",
            [
                { name: "Staff Member", value: `${user}`, inline: true },
                { name: "Infraction", value: type, inline: true },
                { name: "Issued By", value: `${interaction.user}`, inline: true },
                { name: "Reason", value: reason }
            ],
            "PROMOBANNER.png"
        );

        embed.setColor(0xED4245);

        embed.setFooter({
            text: `Infraction issued by ${interaction.user.username}`,
            iconURL: interaction.user.displayAvatarURL()
        });

        return interaction.reply({
            embeds: [embed],
            files: [attachment]
        });
    }

    // ==============================================
    // SESSION COMMAND
    // ==============================================

    if (command === "session") {
        if (!hasRole(interaction.member, SESSION_HOST_ROLE_ID)) {
            return interaction.reply({
                content: "You do not have permission to manage sessions.",
                ephemeral: true
            });
        }

        const sub = interaction.options.getSubcommand();

        if (sub === "start") {
            await interaction.reply({
                content: "Session started.",
                ephemeral: true
            });

            return announceSession(interaction.channel, interaction.user);
        }

        if (sub === "shutdown") {
            await interaction.reply({
                content: "Session shutdown announcement sent.",
                ephemeral: true
            });

            return shutdownSession(interaction.channel, interaction.user);
        }

        if (sub === "vote") {
            await interaction.reply({
                content: "Session vote created.",
                ephemeral: true
            });

            return startSessionVote(interaction.channel);
        }

        if (sub === "low") {
            const embed = new EmbedBuilder()
                .setColor(0xF1C40F)
                .setTitle("Mississippi Roleplay | Low Session")
                .setDescription(
                    "Session activity is currently low!\n\n" +
                    "Join up and help get the server active."
                )
                .setTimestamp();

            return interaction.reply({
                content: `<@&${SESSION_PING_ROLE_ID}>`,
                embeds: [embed]
            });
        }
    }

    // ==============================================
    // INGAME COMMAND
    // ==============================================

    if (command === "ingamecommand") {
        if (!isDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: "You are not authorized to use this command.",
                ephemeral: true
            });
        }

        const cmd = interaction.options.getString("command");

        try {
            const result = await erlcRequest(
                "/server/command",
                "POST",
                { command: cmd }
            );

            return interaction.reply({
                content: `Command sent.\n\`\`\`json\n${JSON.stringify(result, null, 2).slice(0, 1800)}\n\`\`\``,
                ephemeral: true
            });
        } catch (error) {
            return interaction.reply({
                content: `Failed to send command: ${error.message}`,
                ephemeral: true
            });
        }
    }

    // ==============================================
    // ANNOUNCE
    // ==============================================

    if (command === "announce") {
        if (!isDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: "You are not authorized to use this command.",
                ephemeral: true
            });
        }

        const text = interaction.options.getString("message");

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle("Mississippi RP | Announcement")
            .setDescription(text)
            .setFooter({
                text: `Announcement by ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL()
            })
            .setTimestamp();

        return interaction.reply({
            embeds: [embed]
        });
    }

    // ==============================================
    // TICKET PANEL
    // ==============================================

    if (command === "tpanel") {
        if (!isDeveloper(interaction.user.id)) {
            return interaction.reply({
                content: "You are not authorized to use this command.",
                ephemeral: true
            });
        }

        await createTicketPanel(interaction.channel);

        return interaction.reply({
            content: "Ticket panel created.",
            ephemeral: true
        });
    }

    // ==============================================
    // CLOSE REQUEST
    // ==============================================

    if (command === "closerequest") {
        if (!TICKET_STAFF_ROLE_ID ||
            !hasRole(interaction.member, TICKET_STAFF_ROLE_ID)) {
            return interaction.reply({
                content: "You do not have permission to close tickets.",
                ephemeral: true
            });
        }

        if (!interaction.channel.topic?.includes("ticket-owner=")) {
            return interaction.reply({
                content: "This command can only be used inside a ticket.",
                ephemeral: true
            });
        }

        await interaction.reply("Ticket closing in 3 seconds...");

        setTimeout(async () => {
            try {
                await interaction.channel.delete();
            } catch {}
        }, 3000);
    }
});

// ==================================================
// LOGIN
// ==================================================

client.login(TOKEN);
