const { REST, Routes } = require("discord.js");
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

function requireEnv(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(`${name} is required.`);
    }
    return value;
}

function parseSnowflakeList(value) {
    return String(value || "")
        .split(",")
        .map(item => item.trim())
        .filter(Boolean);
}

function assertSnowflake(name, value) {
    if (!SNOWFLAKE_PATTERN.test(value)) {
        throw new Error(`${name} must be a Discord snowflake ID, got "${value}".`);
    }
}

function getAllSlashCommandFiles(dir) {
    let results = [];
    const list = fs.readdirSync(dir);

    for (const file of list) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            results = results.concat(getAllSlashCommandFiles(filePath));
        } else if (file.endsWith(".js")) {
            results.push(filePath);
        }
    }

    return results;
}

function loadCommands() {
    const slashCommandsPath = path.join(__dirname, "commands", "slash");
    if (!fs.existsSync(slashCommandsPath)) {
        throw new Error(`Slash command directory does not exist: ${slashCommandsPath}`);
    }

    const commands = [];
    const slashCommandFiles = getAllSlashCommandFiles(slashCommandsPath);

    for (const filePath of slashCommandFiles) {
        const command = require(filePath);
        if (command.data && typeof command.data.toJSON === "function") {
            commands.push(command.data.toJSON());
        } else {
            throw new Error(`Slash command at ${filePath} is missing a valid data.toJSON() property.`);
        }
    }

    if (!commands.length) {
        throw new Error("No slash commands were found to deploy.");
    }

    return commands;
}

async function deployCommands() {
    const token = requireEnv("DISCORD_TOKEN");
    const clientId = requireEnv("DISCORD_CLIENT_ID");
    assertSnowflake("DISCORD_CLIENT_ID", clientId);

    const guildIds = parseSnowflakeList(
        process.env.DISCORD_COMMAND_GUILD_IDS ||
        process.env.DISCORD_GUILD_ID ||
        ""
    );
    guildIds.forEach((guildId, index) => assertSnowflake(`DISCORD_COMMAND_GUILD_IDS[${index}]`, guildId));

    const deployGlobal = process.env.DISCORD_DEPLOY_GLOBAL_COMMANDS !== "false";
    const commands = loadCommands();
    const rest = new REST({ version: "10" }).setToken(token);

    console.log(`Deploying ${commands.length} slash command(s)...`);

    if (deployGlobal) {
        const data = await rest.put(Routes.applicationCommands(clientId), { body: commands });
        console.log(`Registered ${data.length} global command(s).`);
    }

    for (const guildId of guildIds) {
        const data = await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
        console.log(`Registered ${data.length} command(s) in guild ${guildId}.`);
    }

    if (!deployGlobal && !guildIds.length) {
        throw new Error("No command deployment target configured.");
    }
}

deployCommands().catch(error => {
    console.error("Slash command deployment failed:", error);
    process.exit(1);
});
