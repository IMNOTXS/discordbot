require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, StreamType, entersState, VoiceConnectionStatus } = require('@discordjs/voice');
const ytdl = require('@distube/ytdl-core');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

const queue = new Map(); // Stores song queues for each guild

client.on('ready', () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const args = message.content.split(' ');
    const command = args[0];

    if (command === '!play') {
        const url = args[1];

        if (!url || !ytdl.validateURL(url)) {
            return message.reply('🎵 Please provide a MONKEY YouTube link!');
        }

        const voiceChannel = message.member.voice.channel;
        if (!voiceChannel) {
            return message.reply('🗿👙 You need to be in a voice channel to play music Monkey! 🍌🐵');
        }

        let serverQueue = queue.get(message.guild.id);

        const song = {
            url: url,
            title: (await ytdl.getBasicInfo(url)).videoDetails.title
        };

        if (!serverQueue) {
            // Create a queue structure
            serverQueue = {
                voiceChannel: voiceChannel,
                connection: null,
                songs: [],
                player: createAudioPlayer(),
                timeout: null // Used to track disconnection timeout
            };

            queue.set(message.guild.id, serverQueue);
            serverQueue.songs.push(song);

            try {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator
                });

                serverQueue.connection = connection;
                connection.subscribe(serverQueue.player);

                // Keep connection alive
                connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    try {
                        await Promise.race([
                            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
                            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
                        ]);
                    } catch {
                        queue.delete(message.guild.id);
                        connection.destroy();
                    }
                });

                playSong(message.guild.id);
            } catch (err) {
                console.error(err);
                queue.delete(message.guild.id);
                return message.reply('❌ 🍌🐵Error connecting to the voice channel.');
            }
        } else {
            serverQueue.songs.push(song);
            return message.reply(`🎶 **${song.title}** has been added to the queue!🍌🐵🍌🐵`);
        }
    }

    if (command === '!skip') {
        const serverQueue = queue.get(message.guild.id);
        if (!serverQueue || serverQueue.songs.length === 0) {
            return message.reply('⏭️ There are no songs to skip!🍌🐵');
        }
        message.reply(`⏭️ Skipping 🍌🐵 **${serverQueue.songs[0].title}**`);
        serverQueue.player.stop(); // Stop the current song, triggers `Idle` event
    }
});

function playSong(guildId) {
    const serverQueue = queue.get(guildId);
    if (!serverQueue || serverQueue.songs.length === 0) {
        startDisconnectTimer(guildId);
        return;
    }

    const song = serverQueue.songs.shift();

    try {
        const stream = ytdl(song.url, {
            filter: 'audioonly',
            quality: 'highestaudio',
            highWaterMark: 1 << 26, // Increase buffer size
            dlChunkSize: 256 * 1024, // 256 KB chunks (smaller but consistent loading)
            liveBuffer: 4000, // Helps with live streams
        });
        

        const resource = createAudioResource(stream, {
            inputType: StreamType.Arbitrary
        });

        serverQueue.player.play(resource);

        serverQueue.player.on(AudioPlayerStatus.Idle, () => {
            console.log(`✅ Finished playing: ${song.title}`);
            if (serverQueue.songs.length > 0) {
                playSong(guildId);
            } else {
                startDisconnectTimer(guildId);
            }
        });
        

        serverQueue.player.on('error', error => {
            console.error(`❌ Error playing audio: ${error.message}`);
            playSong(guildId); // Try playing the next song if there's an error
        });

        const guild = client.guilds.cache.get(guildId);
        if (guild) {
            const textChannel = guild.channels.cache.find(channel => channel.type === 0);
            if (textChannel) textChannel.send(`🎵🍌🐵🍌🐵 Now playing: **${song.title}**`);
        }
    } catch (err) {
        console.error(`❌ Error loading song: ${err.message}`);
        playSong(guildId); // Skip song on error
    }
}



function startDisconnectTimer(guildId) {
    const serverQueue = queue.get(guildId);
    if (!serverQueue) return;

    if (serverQueue.timeout) clearTimeout(serverQueue.timeout);

    serverQueue.timeout = setTimeout(() => {
        if (serverQueue.connection) {
            serverQueue.connection.destroy();
        }
        queue.delete(guildId);
    }, 5 * 60 * 1000); // 5-minute inactivity timeout
}

client.login(process.env.DISCORD_TOKEN);
