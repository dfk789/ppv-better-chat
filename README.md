# PPV.to Chat+ Userscript

PPV.to Chat+ is a Tampermonkey/Greasemonkey userscript that upgrades the chat on [PPV.to](https://ppv.to/) live pages. It adds:

- One-click blocking that writes to the site's existing `fs_mute` cookie so the native client respects the mute list
- Client-side word and regex filtering, with import/export for sharing presets
- Per-user team badges stored locally so you can tag regulars with club crests or icons
- Optional BetterTTV global emote support (images fetched from the public BTTV CDN)

The script runs entirely in the browser—no server components are required.

## Installation

1. Install a userscript manager such as [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/).
2. Open the raw script URL from this repository: `userscript/ppv-chatplus.user.js`.
   - In GitHub, click **Raw** to trigger your userscript manager's install prompt.
3. Accept the install. The script is configured to run on `https://ppv.to/*`.

## Usage

- A floating **Chat+** button appears in the lower-right corner of PPV.to. Click it to open settings.
- Use the Word/Phrase Filters section to add plain strings or `/regex/flags` patterns.
- The Team Badges section lets you assign an image URL to any numeric user ID. Use the per-message **Badge** button to pre-fill the ID.
- Enable **BTTV** to fetch BetterTTV global emotes and replace matching codes in chat.
- Import/Export JSON to share your configuration with friends.

### Per-message tools

Each chat line gains small **Block** and **Badge** buttons:

- **Block** adds the user ID to the same cookie the site uses (`fs_mute`), so the native client will also hide them.
- **Badge** prompts you for an image URL and stores it locally. Badges render as 18px icons before the username.

## Development

The userscript is written in vanilla JavaScript and does not require a build step. Simply edit `userscript/ppv-chatplus.user.js` and reload the script in your userscript manager to test changes.

## License

MIT
