# Architect

A command-line interface for Discord that lets you send direct messages to friends from your terminal.

## Requirements

- Go 1.21 or later
- A Discord user token

## Setup

1. Copy `.env` and fill in your token:

```
DISCORD_TOKEN=your_token_here
```

2. Run the program:

```bash
go run .
```

If `DISCORD_TOKEN` is set in your environment, the prompt is skipped automatically.

## Getting your Discord token

Open Discord in a browser, press F12 to open DevTools, go to the Console tab, and run:

```js
window.webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]);m.find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()
```

The output is your token.

## Commands

| Command | Description |
|---|---|
| `friends` | List all friends |
| `send <username> <message>` | Send a DM to a friend |
| `help` | Show available commands |
| `exit` | Quit |

## Example

```
> friends
Username              Display Name
----------------------------------------
mrfrost0              Frost

> send mrfrost0 hello
Sent to mrfrost0: hello
```

## Warning

Using a user token for automation violates Discord's Terms of Service. Use this tool for personal, non-automated use only.
