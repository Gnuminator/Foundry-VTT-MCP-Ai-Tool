### Discord

- **The recorder tells the GM when audio drops:** the bot now posts to the GM channel (`DISCORD_GM_BOT_CHANNEL_ID`, else `GAMENIGHT_WATCH_CHANNEL_ID`, else the voice channel) when a speaker has had no audio for 5 minutes, a stream or the voice connection errors, a rejoin fails from attempt 3, or the bot restarts after an unclean stop. `/record status` shows the voice connection and the age of each speaker's last packet. Stray errors are logged and reported instead of silently ending the process, and the voice debug log hides session ids and endpoints too.
