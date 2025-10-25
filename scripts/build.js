import { promises as fs } from 'fs';
import path from 'path';

const SOURCE = path.resolve('src/chat-enhancer.js');
const EXTENSION_DEST = path.resolve('extension/content/chat-enhancer.js');
const USER_SCRIPT_DEST = path.resolve('userscript/chat-enhancer.user.js');

const USER_SCRIPT_HEADER = `// ==UserScript==\n` +
  `// @name         PPV Chat Enhancer\n` +
  `// @namespace    https://github.com/ppv-better-chat\n` +
  `// @version      0.1.0\n` +
  `// @description  Enhances PPV.to chat with moderation, badges, and custom emoji.\n` +
  `// @match        https://ppv.to/live/*\n` +
  `// @connect      api.betterttv.net\n` +
  `// @connect      api.7tv.app\n` +
  `// @connect      cdn.betterttv.net\n` +
  `// @connect      cdn.7tv.app\n` +
  `// @grant        none\n` +
  `// ==/UserScript==\n\n`;

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

async function build() {
  const source = await fs.readFile(SOURCE, 'utf8');

  await ensureDir(EXTENSION_DEST);
  await fs.writeFile(EXTENSION_DEST, source, 'utf8');

  await ensureDir(USER_SCRIPT_DEST);
  await fs.writeFile(USER_SCRIPT_DEST, USER_SCRIPT_HEADER + source, 'utf8');
}

build().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
