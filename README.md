# td-discord-bot

A small Discord bot that talks to DeepSeek through its Anthropic-compatible API.

The defaults mirror the Claude Code session that set this project up:

- endpoint: `https://api.deepseek.com/anthropic`
- model: `deepseek-v4-flash`
- thinking: enabled
- effort: `max`
- temperature: unset, so DeepSeek's API default applies

All of these can be changed in `.env` without touching the code.

## Features

- Mention the bot in a server channel, or send it a DM.
- Use `/ask prompt:<question>` for a slash command.
- Use `/reset` to clear the current channel's conversation history.
- Remembers the last `MAX_HISTORY_TURNS` exchanges per channel (in memory only).
- Splits long answers into multiple Discord messages.
- Suppresses all mentions in model output, so it cannot ping `@everyone`.
- Allows only one in-flight request per channel, preventing interleaved answers.

## Requirements

- Node.js 20 or newer
- A Discord bot token
- A DeepSeek API key

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create the local secret file if `.env` does not already exist:

   ```bash
   cp .env.example .env
   chmod 600 .env
   ```

   Edit `.env` and set `DISCORD_TOKEN` and `DEEPSEEK_API_KEY`. Do not overwrite
   an existing `.env` that already contains real keys.

3. Create and invite the Discord bot:

   1. Create an application at <https://discord.com/developers/applications>.
   2. Open **Bot**, create a token, and put it in `DISCORD_TOKEN`.
   3. Under **Privileged Gateway Intents**, enable **Message Content Intent**.
      The bot needs this for mention-triggered messages.
   4. Invite the bot with the `bot` and `applications.commands` scopes and grant
      at least **View Channels**, **Send Messages**, **Read Message History**,
      and **Use Application Commands**.
   5. Optional but recommended: put your server ID in `DISCORD_GUILD_ID`. Guild
      slash commands appear immediately; global commands can take up to an hour.

4. Start the bot:

   ```bash
   npm start
   ```

## Usage

| Trigger | Behavior |
| --- | --- |
| `@bot-name how does this work?` | Answers in the same channel |
| DM to the bot | Answers in the DM |
| `/ask prompt:how does this work?` | Answers through a slash command |
| `/reset` | Clears this channel's in-memory history |

Conversation history is shared by everyone in the same channel and is lost when
the process restarts. Use DMs if you want a private conversation.

Prompts and generated replies are sent to DeepSeek's API. Treat bot
conversations as leaving your Discord server.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DISCORD_TOKEN` | required | Discord bot token |
| `DEEPSEEK_API_KEY` | required | DeepSeek API key |
| `DISCORD_GUILD_ID` | empty | Register slash commands in this guild only. Empty registers them globally. |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com/anthropic` | Anthropic-compatible DeepSeek endpoint |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` | Model name |
| `DEEPSEEK_THINKING` | `enabled` | `enabled` or `disabled` |
| `DEEPSEEK_EFFORT` | `max` | `low`, `medium`, `high`, or `max` when thinking is enabled |
| `DEEPSEEK_MAX_TOKENS` | `8192` | Maximum response tokens, including thinking |
| `DEEPSEEK_TEMPERATURE` | empty | Optional `0`–`2`; ignored while thinking is enabled |
| `DEEPSEEK_TIMEOUT_MS` | `180000` | Request timeout in milliseconds |
| `SYSTEM_PROMPT` | built in | Bot persona/instructions |
| `MAX_HISTORY_TURNS` | `10` | Number of user/assistant exchanges retained per channel |
| `MAX_PROMPT_CHARS` | `4000` | Maximum accepted prompt length |

For faster, cheaper replies, set `DEEPSEEK_THINKING=disabled`. For lower latency
while keeping thinking, try `DEEPSEEK_EFFORT=high` or `medium`.

The DeepSeek docs currently list `deepseek-flash` as the native model name;
`deepseek-v4-flash` remains accepted and matches this session's configuration.
Change `DEEPSEEK_MODEL` if you prefer the native alias.

## Secret handling

- `.env` is listed in `.gitignore` and is created with mode `600`.
- `.env.example` documents every variable with placeholders only.
- Tokens are read from the environment and never printed by the bot.
- Do not put credentials in `README.md`, source files, or command history.
- If a token or key is exposed, rotate it immediately: reset the Discord bot
  token and revoke/regenerate the DeepSeek API key.
- For production, inject `DISCORD_TOKEN` and `DEEPSEEK_API_KEY` from a secret
  manager instead of keeping them in a file on disk.

Verify what git will track before committing:

```bash
git status --short
git check-ignore -v .env
```

## Scripts

```bash
npm start   # run the bot
npm run check   # syntax-check the source files
```

## Troubleshooting

- **"Used disallowed intents"**: enable Message Content Intent in the Discord
  developer portal.
- **Slash commands missing**: set `DISCORD_GUILD_ID` for instant registration,
  or re-invite the bot with the `applications.commands` scope.
- **DeepSeek 401**: `DEEPSEEK_API_KEY` is wrong or has been revoked.
- **DeepSeek 400**: check `DEEPSEEK_MODEL`; the configured endpoint may not
  support that model name.
- **Bot ignores pings in servers**: it needs the **Message Content Intent** and
  permission to read and send messages in that channel.

## API references

- <https://api-docs.deepseek.com/>
- <https://api-docs.deepseek.com/guides/anthropic_api>
