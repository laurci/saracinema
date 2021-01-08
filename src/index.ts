if(process.env.NODE_ENV != "production") {
    require("dotenv").config();
} else {
    require("dotenv").config({ path: '/app-config/.env' })
}

import fetch from "node-fetch";

import * as express from "express";
import * as exphbs from "express-handlebars";

import {Client, Message, MessageEmbed} from "discord.js";

import {mDuration, utc} from "./date-utils";
import e = require("express");

const publicUrl = process.env.PUBLIC_URL;
const port = parseInt(process.env.PORT);
const updateInterval = parseInt(process.env.UPDATE_INTERVAL);
const googleApiKey = process.env.GOOGLE_API_KEY;
const googleSpreadsheetId = process.env.GOOGLE_SPREADSHEET_ID;
const discordClientId = process.env.DISCORD_CLIENT_ID;
const discordToken = process.env.DISCORD_TOKEN;
const discordServerId = process.env.DISCORD_SERVER_ID;
const discordChannelId = process.env.DISCORD_CHANNEL_ID;
const discordBackstageChannelId = process.env.DISCORD_BACKSTAGE_CHANNEL_ID;

const privateCommands = {
    "schedule": "display the schedule",
    "update": "update the schedule"
};

const publicCommands = {
    "schedule": "display the schedule"
};

const privateHelp = new MessageEmbed()
                            .setTitle("Help")
                            .setDescription("Seems like you are bad at remembering things. Here's what i can do for you: ")
                            .addField("!help", "display this menu")
                            .addFields(Object.keys(privateCommands).map(x => ({ name: "!" + x, value: privateCommands[x] })));

const publicHelp = new MessageEmbed()
                            .setTitle("Help")
                            .setDescription("Seems like you are bad at remembering things. Here's what i can do for you: ")
                            .addField("!help", "display this menu")
                            .addFields(Object.keys(publicCommands).map(x => ({ name: "!" + x, value: publicCommands[x] })));

const scheduleHelp = new MessageEmbed()
                            .setTitle("Schedule")
                            .setDescription("The schedule is abailable here.")
                            .setURL(`${publicUrl}/schedule`);

const getSchedule = async () => {
    const data = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${googleSpreadsheetId}/values/Schedule!A2:D?key=${googleApiKey}`).then(res => res.json());
    
    const parseRow = (row: string[]) => {
        const [startDate, startTime, duration, title] = row as string[];
        const input = { startDate: utc(startDate + " " + startTime, "DD.MM.YYYY hh:mm:ss"), duration: mDuration(duration), title };
        const endDate = input.startDate.clone().add(input.duration);
        return { ...input, endDate };
    }

    return (data.values as string[][]).map(parseRow);
};

const parseMessageContext = (message: Message) => {
    let content = message.content;
    if(content.indexOf("<@") == 0) {
        const _content = content.split(" ").map(x => x.trim());
        _content.shift();
        content = _content.join(" ");
    } else {
        return undefined;
    }

    if(content.indexOf("!") == 0) {
        const commandArguments = content.substr(1).split(" ").map(x => x.trim());
        const command = commandArguments.shift();
        
        return {
            commandArguments,
            command
        };
    }

    return undefined;
}

const web = express();

const hbs = exphbs.create({
    helpers: {

    }
});

web.engine("handlebars", hbs.engine);
web.set("view engine", "handlebars");

(async () => {
    console.log(`https://discord.com/oauth2/authorize?client_id=${discordClientId}&scope=bot&permissions=137232`);
    
    const client = new Client();
    await client.login(discordToken);

    const server = await client.guilds.fetch(discordServerId, true, true);
    let channel = server.channels.cache.get(discordChannelId);

    let schedule = await getSchedule();

    const onUpdate = async () => {
        console.log("tick");
        
        const rawNow = new Date();
        rawNow.setHours(rawNow.getHours() + 2);

        const now = utc(rawNow);
        
        const sortedSchedule = schedule.map(x => ({ ...x, fromNow: mDuration(x.startDate.diff(now)) })).sort((a,b)=> a.fromNow.milliseconds() - b.fromNow.milliseconds());
        const prevSchedule = sortedSchedule.filter(x => x.fromNow.milliseconds() < 0);
        const postSchedule = sortedSchedule.filter(x => x.fromNow.milliseconds() >= 0);

        const lastPrev = prevSchedule.pop();

        console.log("now");        

        let heading = "";
        if(lastPrev && now.isBetween(lastPrev.startDate, lastPrev.endDate)) {
            heading = "🎬 " + lastPrev.title;
        } else {
            const firstPost = postSchedule.shift();
            
            heading = "🚀 In about " + firstPost.fromNow.humanize() + ": " + firstPost.title;
    
            if(firstPost.fromNow.hours() == 0 && firstPost.fromNow.minutes() > 50) {
                heading = "🚀 In less then an hour: " + firstPost.title;
            }
    
            if(firstPost.fromNow.hours() == 0 && firstPost.fromNow.minutes() <= 50 && firstPost.fromNow.minutes() > 15) {
                heading = "🚀 In about " + ((Math.round(firstPost.fromNow.minutes() / 10) * 10) + "") + " minutes: " + firstPost.title;
            }
    
            if(firstPost.fromNow.hours() == 0 && firstPost.fromNow.minutes() <= 15) {
                heading = "🚀 In less then 15 minutes: " + firstPost.title;
            }
            
            if(firstPost.fromNow.hours() == 0 && firstPost.fromNow.minutes() < 5) {
                heading = "🚀 In a few minutes: " + firstPost.title;
            }
        }
        
        console.log(heading);

        if(heading !== "") {
            if(channel.name != heading) {
                channel = await channel.setName(heading);
            }
        }

        timer = setTimeout(onUpdate, updateInterval * 1000);
    }

    let timer = setTimeout(onUpdate, updateInterval * 1000); // x seconds timer

    const processSchedule = async () => {
        clearTimeout(timer);
        timer = setTimeout(onUpdate, updateInterval * 1000); // x seconds timer
    }

    const refresh = async () => {
        schedule = await getSchedule();
        processSchedule();
    }

    web.use(express.static("public"));

    web.get("/.well-known/health-check", (req, res) => {
        res.json({ ok: true });
    });

    web.get("/", (req, res) => {
        res.render("home");
    });

    web.get("/schedule", (req, res) => {
        res.render("schedule", { schedule: schedule.map(x => ({ startDate: x.startDate.format("DD/MM/YYYY hh:mm"), duration: x.duration.hours() + "hr " + x.duration.minutes() + "min", title: x.title })) });
    });

    web.listen(port, "0.0.0.0", () => {
        console.log(`started listening on *:${port}`);
    });

    client.on("message", async (message) => {
        if(message.author.bot) return;

        console.log("got message from channel: " + message.channel.id);

        if(message.mentions.users.size == 0 || !message.mentions.users.every((user) => user.bot)) return; // make sure only bots are mentioned.

        const context = parseMessageContext(message);

        if(message.channel.id != discordBackstageChannelId) {
            // public stuff
            if(!context) {
                await message.reply(publicHelp);
                return;
            }

            if(Object.keys(publicCommands).indexOf(context.command) == -1) {
                await message.reply(publicHelp);
                return;
            }


            switch(context.command) {
                case "schedule": {
                    await message.reply(scheduleHelp);
                    break;
                }
            }

        } else {
            // private stuff
            if(!context) {
                await message.reply(privateHelp);
                return;
            }
            
            if(Object.keys(privateCommands).indexOf(context.command) == -1) {
                await message.reply(privateHelp);
                return;
            }
            
            switch(context.command) {
                case "hello": {
                    await message.reply("yes master!");
                    break;
                }

                case "schedule": {
                    await message.reply(scheduleHelp);
                    break;
                }

                case "update": {
                    await refresh();
                    await message.reply("will update schedule");
                    break;
                }
            }
        }   
    });
})();