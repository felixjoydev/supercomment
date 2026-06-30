# SuperComment CLI

Connect your coding agent to your team's visual review comments. The CLI
authorizes your machine and runs a local **MCP server** so Claude Code can read
open comments (with full captured context) and mark them resolved.

> Reviewers don't need this — they just open a share link and comment. This CLI
> is for the **developer** whose agent fixes the comments.

## Install

```bash
npm install -g @supercomment/cli
```

This puts a `supercomment` command on your `PATH`.

## Setup (one time)

```bash
# 1. Authorize this machine in the browser and pick a project.
#    Writes ~/.supercomment/binding.json (0600).
supercomment login

# 2. Register the MCP server with Claude Code for ALL workspaces.
claude mcp add supercomment --scope user --transport stdio -- supercomment mcp
```

Then restart Claude Code (or run `/mcp`) and ask it to **“fix the open comments.”**

> `--scope user` registers it globally (in `~/.claude.json`) so it's available
> in every repo. Use `--scope project` instead to limit it to the current repo.

## Commands

| Command | What it does |
| --- | --- |
| `supercomment login` | Browser auth handoff; binds a project and writes the local binding. |
| `supercomment init` | Re-select which project's comments the agent reads. |
| `supercomment logout` | Remove the local binding. |
| `supercomment mcp` | Run the stdio MCP server (Claude Code spawns this; don't run it by hand). |
| `supercomment help` | Show help. |

## Pointing one repo at a different project

The binding is per-machine (one project at a time). To make a specific repo read
a different project, add a project-scoped entry with env overrides to that repo's
`.mcp.json`:

```json
{
  "mcpServers": {
    "supercomment": {
      "type": "stdio",
      "command": "supercomment",
      "args": ["mcp"],
      "env": {
        "SUPERCOMMENT_SUPABASE_URL": "https://<project>.supabase.co",
        "SUPERCOMMENT_ANON_KEY": "<anon key>",
        "SUPERCOMMENT_TOKEN": "<member access token>",
        "SUPERCOMMENT_PREVIEW_ID": "<preview id>"
      }
    }
  }
}
```

A project-scoped entry takes precedence over the user-scoped one.

## How it works

The MCP server reads comments from Supabase through the binding written by
`supercomment login` (it auto-refreshes the short-lived access token, so you
don't re-login). It exposes `list_open_comments`, `get_all_open`, `get_comment`,
`resolve_comment`, and `dismiss_comment` — each comment carries the captured
context (selector, source location, console/network signals, device surface,
screenshot, …), relevance-curated for the agent.
