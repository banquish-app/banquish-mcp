# banquish-mcp

The MCP server of [Banquish](https://banquish.space), for any MCP client.

Banquish is a Mac app (Apple silicon) that lets your agent answer with the live web: it opens the real pages, takes the parts that answer you (a price, a chart, a player, a table) and composes them into a Workspace you see. Those parts stay live.

## Use it

Install the Banquish app first, from [banquish.space](https://banquish.space) (download coming soon) or with Homebrew (coming soon):

```
brew install --cask banquish-app/tap/banquish
```

Open Banquish once. For Claude Code, Codex and Claude Desktop, its **Connect your agent** card sets everything up with one click, and Claude Code users can add the [Banquish plugin](https://github.com/banquish-app/banquish-plugin). For any other client, under Connect your agent open **Any other MCP client** and click **Copy**: that installs the shim this package runs, and copies a configuration you can use as it is. Or give the client this package:

```json
{
  "mcpServers": {
    "banquish": {
      "command": "npx",
      "args": ["-y", "banquish-mcp"]
    }
  }
}
```

## What it does

`banquish-mcp` runs `~/.banquish/bin/banquish mcp`, the stdio shim the Banquish app installs, with stdio passed straight through. The shim relays MCP to the Banquish app on your Mac and opens Banquish if it's closed. This package has no dependencies and sends nothing anywhere itself.

If the shim is missing, `banquish-mcp` prints how to install Banquish to stderr and exits with status 1.

## Privacy

See [banquish.space/privacy](https://banquish.space/privacy).

## License

MIT; see [LICENSE](LICENSE). The Banquish app is distributed separately.
