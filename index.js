
const {
    Client,
    GatewayIntentBits,
    ActivityType,
    EmbedBuilder,
    SlashCommandBuilder
} = require('discord.js');

// ==========================================
// ENVIRONMENT
// ==========================================

const TOKEN = process.env.DISCORD_TOKEN;
const DEVID = process.env.DEVID;
const ERLC_API_KEY = process.env.ERLC_API_KEY;
const INGAME_ROLE_ID = process.env.INGAME_ROLE_ID;
const GUILD_ID = process.env.GUILD_ID;

const AUTO_MESSAGES = (process.env.AUTO_MESSAGES || '')
    .split('|')
    .map(m => m.trim())
    .filter(Boolean);

const AUTO_INTERVAL =
    Math.max(1, Number(process.env.AUTO_MESSAGE_INTERVAL_MINUTES) || 10)
    * 60000;

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
    ]
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
// ER:LC API COMMAND
// ==========================================

async function runERLCCommand(command) {
    if (!ERLC_API_KEY) {
        throw new Error('ER:LC API key is not configured.');
    }

    const cleanCommand = command.trim();

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
        console.error('Auto message error:', error.message);
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
        // Clear old global commands
        await client.application.commands.set([]);

        // Replace all commands in this server
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
// PLAYER COUNT
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

        const playerCount =
            `${data.CurrentPlayers} Players In-game`;

        client.user.setActivity(playerCount, {
            type: ActivityType.Playing
        });
//--------------------------------------------------------------STATUS------------------------------------------------------
        // DEF PLR COUNT TXT: ER:LC Players: ${playerCount}
        console.log(`SPLAT IS FIXING ME! YAYA!`);

    } catch (error) {
        console.error('Player count error:', error.message);
    }
}

// ==========================================
// SLASH COMMAND HANDLER
// ==========================================

client.on('interactionCreate', async interaction => {
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
// PUBLIC -PING
// ==========================================

client.on('messageCreate', async message => {
    if (message.author.bot || !message.guild) return;

    if (message.content.trim().toLowerCase() !== '-ping') return;

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
