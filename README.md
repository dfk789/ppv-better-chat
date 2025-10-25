# PPV Chat Enhancer

A browser extension and userscript that augments the PPV.to live chat with
quality-of-life tooling:

- one-click blocking for disruptive users with persistent storage
- customisable word and phrase filtering with automatic redaction
- local team badges (Premier League presets) that appear inline with chat badges
- extended emote support powered by BetterTTV and 7TV global emoji
- lightweight control panel injected directly into the chat UI

The project ships both a Chrome/Firefox extension bundle and a standalone
userscript so you can pick the distribution that best fits your workflow.

## Getting started

Install dependencies and build the distributable assets:

```bash
npm install
npm run build
```

The build step compiles the shared TypeScript source into two artifacts:

- `extension/content/chat-enhancer.js` – content script consumed by the
  extension manifest.
- `userscript/chat-enhancer.user.js` – self-contained userscript with metadata
  headers for Greasemonkey/Tampermonkey.

## Installing the extension

1. Run `npm run build` to ensure the latest bundle is generated.
2. Open your browser’s extension management page (e.g. `chrome://extensions` or
   `about:debugging#/runtime/this-firefox`).
3. Enable **Developer Mode**.
4. Choose **Load unpacked** (Chrome) or **Load Temporary Add-on** (Firefox) and
   select the repository root directory. The manifest will automatically use the
   compiled `extension/content/chat-enhancer.js` content script.

## Installing the userscript

1. Run `npm run build`.
2. Open the generated `userscript/chat-enhancer.user.js` file in your browser.
3. Your userscript manager (e.g. Tampermonkey) will prompt you to install the
   script. Confirm, and it will activate on `https://ppv.to/live/*` URLs.

## Features in detail

- **Blocking & filtering** – right beside every username you’ll find quick
  action icons for blocking the user or opening the badge picker. Blocked users
  are hidden instantly and their identifiers are stored locally so they remain
  muted in future sessions. The settings panel allows manual management of the
  blocked and filtered lists.
- **Team badges** – pick your own club badge (Premier League presets generated
  as inline SVGs) and optionally assign badges to other users based on their
  numeric IDs. Badges are stored locally and appended to incoming messages by
  intercepting the `addMessage` handler.
- **Custom emoji** – the script fetches BetterTTV and 7TV global emotes at
  runtime and injects them into the existing emote replacement pipeline. Any
  recognised shortcode in chat text is automatically converted into an inline
  image.
- **Settings panel** – access via the “Enhancer” button next to the message box
  to manage blocked users, word filters, and badge assignments. Known chatters
  collected during your session appear as quick-select chips for faster badge
  management.

## Development notes

- The codebase uses a single shared JavaScript entrypoint (`src/chat-enhancer.js`).
- The `npm run build` script simply copies that source into the extension
  directory and wraps it with a Tampermonkey header for the userscript build –
  no additional tooling is required.
- No external state is stored outside of `localStorage`; clearing browser data
  resets all configuration.
- External requests are limited to BetterTTV/7TV public endpoints for emote
  metadata.

## License

[MIT](LICENSE)
