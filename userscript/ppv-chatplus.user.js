// ==UserScript==
// @name         PPV.to Chat+ (Block • Filter • Badges • BTTV)
// @namespace    dk.ppv.chatplus
// @version      0.6.0
// @description  Adds block, filters, per-user team badges, and optional BTTV emotes to PPV.to chat. No server changes needed.
// @match        https://ppv.to/*
// @match        https://*.ppv.to/*
// @run-at       document-end
// @inject-into  page
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      api.betterttv.net
// @connect      cdn.betterttv.net
// ==/UserScript==

(() => {
  'use strict';

  /* ---------- Config & Constants ---------- */
  const CONFIG = {
    storeKey: 'ppv_chatplus_v2',
    maxMessages: 150, // DOM limiting
    throttleMs: 100,  // Render throttling
    selectors: {
      list: ['#message-list', '#message-cont', '.chat-message-list', '.chat-body'],
      msg: '.message, .chat-message',
      user: '[data-user-id]',
      text: '.message-text, p, span'
    }
  };

  /* ---------- Styles ---------- */
  GM_addStyle(`
    /* Floating Button */
    .cp-float-btn { position: fixed; right: 14px; bottom: 14px; z-index: 99999; padding: 8px 10px; border-radius: 10px; background: #111; color: #fff; font: 12px/1.2 system-ui, sans-serif; box-shadow: 0 3px 10px rgba(0,0,0,.4); cursor: pointer; opacity: .9; border: 1px solid rgba(255,255,255,.1); transition: opacity .2s; }
    .cp-float-btn:hover { opacity: 1; }

    /* Panel */
    .cp-panel { position: fixed; right: 14px; bottom: 54px; width: 340px; max-height: 80vh; z-index: 99999; background: #0b0b0c; color: #e8e8ea; border: 1px solid #2a2a2e; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.5); display: none; overflow-y: auto; font: 12px/1.4 system-ui, sans-serif; }
    .cp-panel.open { display: block; }
    .cp-header { padding: 10px 12px; font-weight: 600; background: #121214; border-bottom: 1px solid #202024; display: flex; align-items: center; justify-content: space-between; }
    .cp-section { padding: 10px 12px; border-bottom: 1px solid #202024; }
    .cp-label { display: block; margin: 8px 0 4px; color: #c8c8cc; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
    .cp-input { width: 100%; padding: 6px 8px; border-radius: 6px; background: #141417; color: #fff; border: 1px solid #2a2a2e; outline: none; font-family: monospace; }
    .cp-input:focus { border-color: #4a4a4e; }
    .cp-row { display: flex; gap: 8px; margin-top: 6px; }
    .cp-btn { padding: 5px 10px; border-radius: 6px; background: #1f1f25; color: #fff; border: 1px solid #2a2a2e; cursor: pointer; font-size: 11px; }
    .cp-btn:hover { background: #26262d; }
    .cp-btn.danger { color: #ff6b6b; border-color: #4a2a2a; }
    .cp-btn.primary { background: #2a2a35; border-color: #3a3a45; }
    .cp-pill { display: inline-flex; align-items: center; padding: 2px 6px; margin: 2px 4px 2px 0; border-radius: 4px; background: #1b1b1f; border: 1px solid #2a2a2e; color: #d0d0d4; font-size: 11px; }
    .cp-pill button { margin-left: 6px; background: none; border: none; color: #888; cursor: pointer; padding: 0; font-size: 14px; line-height: 1; }
    .cp-pill button:hover { color: #fff; }
    .cp-checkbox { display: flex; align-items: center; gap: 8px; cursor: pointer; user-select: none; }

    /* Message Enhancements */
    .cp-badge { height: 16px; width: 16px; object-fit: contain; margin-right: 4px; vertical-align: middle; }
    .cp-msg-menu-btn { opacity: 0; transition: opacity .2s; cursor: pointer; padding: 0 4px; color: #888; font-weight: bold; margin-left: 4px; }
    .message:hover .cp-msg-menu-btn, .chat-message:hover .cp-msg-menu-btn { opacity: 1; }
    .cp-msg-menu-btn:hover { color: #fff; }

    /* Context Menu */
    .cp-ctx-menu { position: fixed; z-index: 100000; background: #18181b; border: 1px solid #2a2a2e; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,.5); padding: 4px 0; min-width: 140px; font: 12px system-ui, sans-serif; }
    .cp-ctx-item { padding: 6px 12px; cursor: pointer; color: #e4e4e7; display: flex; align-items: center; gap: 8px; }
    .cp-ctx-item:hover { background: #27272a; }
    .cp-ctx-sep { height: 1px; background: #2a2a2e; margin: 4px 0; }
    .cp-ctx-danger { color: #ff6b6b; }

    /* Debug */
    .cp-debug-console { max-height: 100px; overflow-y: auto; background: #000; color: #0f0; font-family: monospace; padding: 4px; font-size: 10px; margin-top: 8px; border: 1px solid #333; }
  `);

  /* ---------- Store (Persistence) ---------- */
  const Store = {
    state: {
      filters: [],      // strings or regex strings
      badges: {},       // { uid: url }
      muted: [],        // [uid, uid, ...]
      enableBTTV: false,
      debugMode: false
    },
    init() {
      // Load from localStorage
      try {
        const raw = localStorage.getItem(CONFIG.storeKey);
        if (raw) {
          this.state = { ...this.state, ...JSON.parse(raw) };
        } else {
          // Migration: Check for old cookies
          this.migrateCookies();
        }
      } catch (e) {
        console.error('[Chat+] Load error:', e);
      }
    },
    save() {
      try {
        localStorage.setItem(CONFIG.storeKey, JSON.stringify(this.state));
      } catch (e) {
        console.error('[Chat+] Save error:', e);
      }
    },
    migrateCookies() {
      try {
        const match = document.cookie.match(/(^|;)\s*fs_mute\s*=\s*([^;]+)/);
        if (match) {
          const val = decodeURIComponent(match.pop());
          const arr = JSON.parse(val);
          if (Array.isArray(arr)) {
            const nums = arr.map(Number).filter(Number.isFinite);
            this.state.muted = [...new Set([...this.state.muted, ...nums])];
            console.log('[Chat+] Migrated muted users from cookie:', nums.length);
            this.save();
            // Optional: Clear cookie? document.cookie = 'fs_mute=; Max-Age=0; path=/; domain=.ppv.to';
          }
        }
      } catch (e) {
        console.warn('[Chat+] Migration failed:', e);
      }
    },
    addFilter(f) {
      if (!f || this.state.filters.includes(f)) return;
      this.state.filters.push(f);
      this.save();
      Chat.recompileFilters();
    },
    removeFilter(idx) {
      this.state.filters.splice(idx, 1);
      this.save();
      Chat.recompileFilters();
    },
    muteUser(uid) {
      uid = Number(uid);
      if (!Number.isFinite(uid) || this.state.muted.includes(uid)) return;
      this.state.muted.push(uid);
      this.save();
      Chat.applyMute(uid);
    },
    unmuteUser(uid) {
      uid = Number(uid);
      this.state.muted = this.state.muted.filter(id => id !== uid);
      this.save();
    },
    setBadge(uid, url) {
      if (!url) {
        delete this.state.badges[uid];
      } else {
        this.state.badges[uid] = url;
      }
      this.save();
    }
  };

  /* ---------- BTTV ---------- */
  const BTTV = {
    map: {},
    async fetch() {
      if (!Store.state.enableBTTV) return;
      try {
        const res = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://api.betterttv.net/3/cached/emotes/global',
            onload: r => resolve(r.responseText),
            onerror: reject
          });
        });
        const arr = JSON.parse(res);
        arr.forEach(e => {
          if (e?.id && e?.code) this.map[e.code] = `https://cdn.betterttv.net/emote/${e.id}/1x`;
        });
      } catch (e) {
        console.warn('[Chat+] BTTV fetch failed', e);
      }
    },
    process(node) {
      if (!Store.state.enableBTTV || Object.keys(this.map).length === 0) return;
      // Simple text walker
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      let n;
      while (n = walker.nextNode()) nodes.push(n);

      const codes = Object.keys(this.map);
      // Create a regex for all codes: \b(CODE1|CODE2)\b
      // Escaping special regex chars in codes if any
      const pattern = codes.map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      if (!pattern) return;
      const re = new RegExp(`\\b(${pattern})\\b`, 'g');

      nodes.forEach(textNode => {
        const text = textNode.nodeValue;
        if (!re.test(text)) return;

        const frag = document.createDocumentFragment();
        let lastIndex = 0;
        text.replace(re, (match, code, offset) => {
          if (offset > lastIndex) {
            frag.appendChild(document.createTextNode(text.slice(lastIndex, offset)));
          }
          const img = document.createElement('img');
          img.src = this.map[match];
          img.alt = match;
          img.title = match;
          img.style.height = '18px';
          img.style.verticalAlign = '-3px';
          frag.appendChild(img);
          lastIndex = offset + match.length;
          return match;
        });
        if (lastIndex < text.length) {
          frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        }
        textNode.replaceWith(frag);
      });
    }
  };

  /* ---------- Chat Logic ---------- */
  const Chat = {
    root: null,
    observer: null,
    filterRegexes: [],
    pendingNodes: [],
    throttleTimer: null,

    init() {
      this.recompileFilters();
      this.waitForList().then(el => {
        this.root = el;
        console.log('[Chat+] Hooked into:', el);
        this.observe();
        // Initial sweep
        el.querySelectorAll(CONFIG.selectors.msg).forEach(n => this.processMessage(n));
      });
    },

    recompileFilters() {
      this.filterRegexes = Store.state.filters.map(f => {
        try {
          if (f.startsWith('/') && f.lastIndexOf('/') > 0) {
            const pattern = f.slice(1, f.lastIndexOf('/'));
            const flags = f.slice(f.lastIndexOf('/') + 1);
            return new RegExp(pattern, flags);
          }
          return new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
        } catch {
          return null;
        }
      }).filter(Boolean);
    },

    waitForList() {
      return new Promise(resolve => {
        const check = () => {
          for (const s of CONFIG.selectors.list) {
            const el = document.querySelector(s);
            if (el) return resolve(el.id === 'message-cont' ? (el.querySelector('#message-list') || el) : el);
          }
          setTimeout(check, 1000);
        };
        check();
      });
    },

    observe() {
      this.observer = new MutationObserver(mutations => {
        let added = [];
        for (const m of mutations) {
          m.addedNodes.forEach(n => {
            if (n.nodeType === 1) {
              if (n.matches(CONFIG.selectors.msg)) added.push(n);
              else added.push(...n.querySelectorAll(CONFIG.selectors.msg));
            }
          });
        }
        if (added.length) {
          this.pendingNodes.push(...added);
          this.scheduleProcess();
        }
      });
      this.observer.observe(this.root, { childList: true, subtree: true });
    },

    scheduleProcess() {
      if (this.throttleTimer) return;
      this.throttleTimer = requestAnimationFrame(() => {
        this.processBatch();
        this.throttleTimer = null;
      });
    },

    processBatch() {
      const nodes = this.pendingNodes;
      this.pendingNodes = [];
      nodes.forEach(n => this.processMessage(n));
      this.cleanup();
    },

    processMessage(node) {
      if (node.__cp_processed) return;
      node.__cp_processed = true;

      const userEl = node.querySelector(CONFIG.selectors.user);
      const uid = userEl ? Number(userEl.getAttribute('data-user-id')) : null;
      const textEl = node.querySelector(CONFIG.selectors.text);
      const text = textEl ? (textEl.innerText || textEl.textContent) : '';

      // 1. Block Check
      if (uid && Store.state.muted.includes(uid)) {
        node.style.display = 'none';
        return;
      }

      // 2. Filter Check
      if (text) {
        for (const re of this.filterRegexes) {
          if (re.test(text)) {
            node.style.display = 'none';
            return;
          }
        }
      }

      // 3. Badges
      if (uid && Store.state.badges[uid] && userEl) {
        const img = document.createElement('img');
        img.src = Store.state.badges[uid];
        img.className = 'cp-badge';
        userEl.parentNode.insertBefore(img, userEl);
      }

      // 4. Menu Button
      if (userEl) {
        const btn = document.createElement('span');
        btn.className = 'cp-msg-menu-btn';
        btn.textContent = '⋮';
        btn.onclick = (e) => {
          e.stopPropagation();
          UI.showContextMenu(e, uid, userEl.textContent);
        };
        userEl.parentNode.appendChild(btn);
      }

      // 5. BTTV
      if (textEl && Store.state.enableBTTV) {
        BTTV.process(textEl);
      }

      // 6. Debug Mode
      if (Store.state.debugMode) {
        node.addEventListener('click', (e) => {
          if (e.altKey) {
            console.log('[Chat+ Debug] Message:', node);
            console.log('User ID:', uid);
            console.log('HTML:', node.innerHTML);
          }
        });
      }
    },

    cleanup() {
      // Keep DOM size in check
      if (!this.root) return;
      const children = this.root.children;
      if (children.length > CONFIG.maxMessages) {
        const removeCount = children.length - CONFIG.maxMessages;
        for (let i = 0; i < removeCount; i++) {
          children[i].remove();
        }
      }
    },

    applyMute(uid) {
      // Hide existing messages from this user
      if (!this.root) return;
      this.root.querySelectorAll(CONFIG.selectors.msg).forEach(n => {
        const u = n.querySelector(CONFIG.selectors.user);
        if (u && Number(u.getAttribute('data-user-id')) === uid) {
          n.style.display = 'none';
        }
      });
    }
  };

  /* ---------- UI Logic ---------- */
  const UI = {
    panel: null,
    init() {
      this.createButton();
      this.createPanel();
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.cp-ctx-menu') && !e.target.closest('.cp-msg-menu-btn')) {
          this.hideContextMenu();
        }
      });
    },

    createButton() {
      const btn = document.createElement('div');
      btn.className = 'cp-float-btn';
      btn.textContent = 'Chat+';
      btn.onclick = () => this.togglePanel();
      document.body.appendChild(btn);
    },

    togglePanel() {
      this.panel.classList.toggle('open');
      if (this.panel.classList.contains('open')) {
        this.renderFilters();
        this.renderBadges();
      }
    },

    createPanel() {
      this.panel = document.createElement('div');
      this.panel.className = 'cp-panel';
      this.panel.innerHTML = `
        <div class="cp-header">
          <span>Chat+ Settings</span>
          <button class="cp-btn" id="cp-close">✕</button>
        </div>
        
        <div class="cp-section">
          <label class="cp-checkbox">
            <input type="checkbox" id="cp-bttv"> Enable BTTV Emotes
          </label>
          <label class="cp-checkbox">
            <input type="checkbox" id="cp-debug"> Debug Mode (Alt+Click msg)
          </label>
        </div>

        <div class="cp-section">
          <span class="cp-label">Filters (Regex supported)</span>
          <div class="cp-row">
            <input type="text" id="cp-filter-in" class="cp-input" placeholder="/badword/i or text">
            <button class="cp-btn primary" id="cp-filter-add">Add</button>
          </div>
          <div id="cp-filter-list" style="margin-top:8px"></div>
        </div>

        <div class="cp-section">
          <span class="cp-label">Custom Badges</span>
          <div class="cp-row">
            <input type="text" id="cp-badge-uid" class="cp-input" placeholder="User ID" style="flex:1">
            <input type="text" id="cp-badge-url" class="cp-input" placeholder="Image URL" style="flex:2">
          </div>
          <div class="cp-row">
             <button class="cp-btn primary" id="cp-badge-save">Save</button>
          </div>
          <div id="cp-badge-list" style="margin-top:8px"></div>
        </div>

        <div class="cp-section">
          <span class="cp-label">Data</span>
          <div class="cp-row">
            <button class="cp-btn" id="cp-export">Export JSON</button>
            <button class="cp-btn" id="cp-import">Import JSON</button>
            <button class="cp-btn danger" id="cp-reset">Reset All</button>
          </div>
        </div>
      `;
      document.body.appendChild(this.panel);

      // Bindings
      this.panel.querySelector('#cp-close').onclick = () => this.togglePanel();

      const bttvChk = this.panel.querySelector('#cp-bttv');
      bttvChk.checked = Store.state.enableBTTV;
      bttvChk.onchange = () => {
        Store.state.enableBTTV = bttvChk.checked;
        Store.save();
        if (bttvChk.checked) BTTV.fetch();
      };

      const debugChk = this.panel.querySelector('#cp-debug');
      debugChk.checked = Store.state.debugMode;
      debugChk.onchange = () => {
        Store.state.debugMode = debugChk.checked;
        Store.save();
      };

      this.panel.querySelector('#cp-filter-add').onclick = () => {
        const val = this.panel.querySelector('#cp-filter-in').value.trim();
        if (val) {
          Store.addFilter(val);
          this.panel.querySelector('#cp-filter-in').value = '';
          this.renderFilters();
        }
      };

      this.panel.querySelector('#cp-badge-save').onclick = () => {
        const uid = this.panel.querySelector('#cp-badge-uid').value.trim();
        const url = this.panel.querySelector('#cp-badge-url').value.trim();
        if (uid && url) {
          Store.setBadge(uid, url);
          this.panel.querySelector('#cp-badge-uid').value = '';
          this.panel.querySelector('#cp-badge-url').value = '';
          this.renderBadges();
        }
      };

      this.panel.querySelector('#cp-export').onclick = () => {
        const data = JSON.stringify(Store.state, null, 2);
        navigator.clipboard.writeText(data).then(() => alert('Copied to clipboard!'));
      };

      this.panel.querySelector('#cp-import').onclick = () => {
        const data = prompt('Paste JSON config:');
        if (data) {
          try {
            Store.state = { ...Store.state, ...JSON.parse(data) };
            Store.save();
            this.renderFilters();
            this.renderBadges();
            bttvChk.checked = Store.state.enableBTTV;
            alert('Imported!');
          } catch {
            alert('Invalid JSON');
          }
        }
      };

      this.panel.querySelector('#cp-reset').onclick = () => {
        if (confirm('Reset all settings?')) {
          localStorage.removeItem(CONFIG.storeKey);
          location.reload();
        }
      };
    },

    renderFilters() {
      const list = this.panel.querySelector('#cp-filter-list');
      list.innerHTML = '';
      Store.state.filters.forEach((f, i) => {
        const pill = document.createElement('div');
        pill.className = 'cp-pill';
        pill.innerHTML = `<span>${f}</span> <button>×</button>`;
        pill.querySelector('button').onclick = () => {
          Store.removeFilter(i);
          this.renderFilters();
        };
        list.appendChild(pill);
      });
    },

    renderBadges() {
      const list = this.panel.querySelector('#cp-badge-list');
      list.innerHTML = '';
      Object.entries(Store.state.badges).forEach(([uid, url]) => {
        const pill = document.createElement('div');
        pill.className = 'cp-pill';
        pill.innerHTML = `<img src="${url}" style="height:12px;margin-right:4px"> ${uid} <button>×</button>`;
        pill.querySelector('button').onclick = () => {
          Store.setBadge(uid, null);
          this.renderBadges();
        };
        list.appendChild(pill);
      });
    },

    showContextMenu(e, uid, name) {
      this.hideContextMenu();
      const menu = document.createElement('div');
      menu.className = 'cp-ctx-menu';
      menu.style.left = e.clientX + 'px';
      menu.style.top = e.clientY + 'px';

      const isMuted = Store.state.muted.includes(uid);

      menu.innerHTML = `
        <div class="cp-ctx-item">User: <b>${name}</b> (${uid})</div>
        <div class="cp-ctx-sep"></div>
        <div class="cp-ctx-item" id="ctx-copy">Copy ID</div>
        <div class="cp-ctx-item" id="ctx-badge">Set Badge...</div>
        <div class="cp-ctx-sep"></div>
        <div class="cp-ctx-item cp-ctx-danger" id="ctx-block">${isMuted ? 'Unblock' : 'Block'}</div>
      `;

      menu.querySelector('#ctx-copy').onclick = () => {
        navigator.clipboard.writeText(uid);
        this.hideContextMenu();
      };

      menu.querySelector('#ctx-badge').onclick = () => {
        this.hideContextMenu();
        this.togglePanel();
        this.panel.querySelector('#cp-badge-uid').value = uid;
        this.panel.querySelector('#cp-badge-url').focus();
      };

      menu.querySelector('#ctx-block').onclick = () => {
        if (isMuted) Store.unmuteUser(uid);
        else Store.muteUser(uid);
        this.hideContextMenu();
      };

      document.body.appendChild(menu);

      // Adjust position if off-screen
      const rect = menu.getBoundingClientRect();
      if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 10) + 'px';
      if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 10) + 'px';
    },

    hideContextMenu() {
      const existing = document.querySelector('.cp-ctx-menu');
      if (existing) existing.remove();
    }
  };

  /* ---------- Boot ---------- */
  Store.init();
  UI.init();
  Chat.init();
  if (Store.state.enableBTTV) BTTV.fetch();

})();
