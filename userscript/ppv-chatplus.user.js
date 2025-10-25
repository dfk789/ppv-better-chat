// ==UserScript==
// @name         PPV.to Chat+ Lite (Block • Filter • Badges • BTTV)
// @namespace    dk.ppv.chatplus
// @version      0.5.0
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

  /* ---------- Styles ---------- */
  GM_addStyle(`
    .chatplus-floating-btn{position:fixed;right:14px;bottom:14px;z-index:2147483000;padding:8px 10px;border-radius:10px;background:#111;color:#fff;font:12px/1.2 system-ui,-apple-system,Segoe UI,Roboto,Arial;box-shadow:0 3px 10px rgba(0,0,0,.35);cursor:pointer;opacity:.9;border:1px solid rgba(255,255,255,.1)}
    .chatplus-floating-btn:hover{opacity:1}
    .chatplus-panel{position:fixed;right:14px;bottom:54px;width:320px;max-height:80vh;z-index:2147483000;background:#0b0b0c;color:#e8e8ea;border:1px solid #2a2a2e;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.45);display:none;overflow:hidden;font:12px/1.4 system-ui,-apple-system,Segoe UI,Roboto,Arial}
    .chatplus-panel header{padding:10px 12px;font-weight:600;background:#121214;border-bottom:1px solid #202024;display:flex;align-items:center;justify-content:space-between}
    .chatplus-panel section{padding:10px 12px;border-bottom:1px solid #202024}
    .chatplus-panel label{display:block;margin:6px 0 4px;color:#c8c8cc}
    .chatplus-panel input[type="text"],.chatplus-panel input[type="url"],.chatplus-panel textarea{width:100%;padding:6px 8px;border-radius:8px;background:#141417;color:#fff;border:1px solid #2a2a2e;outline:none}
    .chatplus-panel .row{display:flex;gap:8px}
    .chatplus-panel .row>*{flex:1}
    .chatplus-panel .pill{display:inline-block;padding:3px 6px;margin:3px 4px 0 0;border-radius:999px;background:#1b1b1f;border:1px solid #2a2a2e;color:#d0d0d4}
    .chatplus-panel .pill button{margin-left:6px;background:transparent;color:#aaa;border:none;cursor:pointer}
    .chatplus-small{font-size:11px;color:#9a9aa0}
    .chatplus-btn{padding:6px 8px;border-radius:8px;background:#1f1f25;color:#fff;border:1px solid #2a2a2e;cursor:pointer}
    .chatplus-btn:hover{background:#26262d}
    .chatplus-row{display:flex;gap:8px;align-items:center;margin-top:6px}
    .chatplus-checkbox{display:flex;align-items:center;gap:8px;user-select:none;cursor:pointer}
    .chatplus-msg-tools{display:inline-flex;gap:6px;margin-left:8px;opacity:.7}
    .chatplus-msg-tools button{font-size:11px;padding:1px 6px;border-radius:6px;border:1px solid #3a3a3e;background:#17171a;color:#ddd;cursor:pointer}
    .chatplus-msg-tools button:hover{background:#202025}
    .chatplus-team-badge{height:18px;width:18px;object-fit:contain;margin-right:4px;vertical-align:-3px}
  `);

  /* ---------- State ---------- */
  const STORE_KEY = 'ppv_chatplus_v1';
  const defaultState = { filters: [], badges: {}, enableBTTV: false };
  let state = (() => {
    try {
      return Object.assign({}, defaultState, JSON.parse(localStorage.getItem(STORE_KEY) || '{}'));
    } catch {
      return { ...defaultState };
    }
  })();
  const saveState = () => localStorage.setItem(STORE_KEY, JSON.stringify(state));

  const log = (...a) => console.log('[Chat+]', ...a);

  /* ---------- Cookie helpers (fs_mute) ---------- */
  const getCookie = (n) => {
    const m = document.cookie.match('(^|;)\\s*' + n + '\\s*=\\s*([^;]+)');
    return m ? decodeURIComponent(m.pop()) : null;
  };
  const setCookie = (n, v, days = 365) => {
    const d = new Date();
    d.setTime(d.getTime() + days * 864e5);
    const dom = location.hostname.includes('ppv.to') ? '; domain=.ppv.to' : '';
    document.cookie = `${n}=${encodeURIComponent(v)}; expires=${d.toUTCString()}; path=/${dom}; SameSite=Lax`;
  };
  const getMuted = () => {
    try {
      const c = getCookie('fs_mute');
      const arr = c ? JSON.parse(c) : [];
      return Array.isArray(arr) ? arr.map(Number).filter(Number.isFinite) : [];
    } catch {
      return [];
    }
  };
  const setMuted = (list) => setCookie('fs_mute', JSON.stringify([...new Set(list.map(Number).filter(Number.isFinite))]));

  /* ---------- Filters ---------- */
  let filterRegexes = compileFilters(state.filters);
  function compileFilters(list) {
    const rx = [];
    const parts = [];
    for (const f of list) {
      if (/^\/.*\/[gimsuy]*$/.test(f)) {
        try {
          const body = f.replace(/^\/(.*)\/[gimsuy]*$/, '$1');
          const flags = f.replace(/^\/.*\/([gimsuy]*)$/, '$1');
          rx.push(new RegExp(body, flags));
        } catch {
          // ignore invalid regex
        }
      } else if (f.trim()) {
        parts.push(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      }
    }
    if (parts.length) rx.push(new RegExp(`(${parts.join('|')})`, 'i'));
    return rx;
  }

  /* ---------- BTTV (optional) ---------- */
  let bttvMap = null; // { CODE: url }
  function fetchBTTV() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: 'https://api.betterttv.net/3/cached/emotes/global',
        onload: (res) => {
          try {
            const arr = JSON.parse(res.responseText);
            const map = {};
            for (const e of arr) {
              if (e?.id && e?.code) map[e.code] = `https://cdn.betterttv.net/emote/${e.id}/1x`;
            }
            bttvMap = map;
          } catch {
            bttvMap = {};
          }
          resolve();
        },
        onerror: () => {
          bttvMap = {};
          resolve();
        }
      });
    });
  }
  function replaceBTTV(el) {
    if (!state.enableBTTV || !bttvMap) return;
    const codes = Object.keys(bttvMap);
    if (!codes.length) return;
    const re = new RegExp(`\\b(${codes.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    for (let n; (n = walker.nextNode());) nodes.push(n);
    for (const tn of nodes) {
      const txt = tn.nodeValue;
      if (!re.test(txt)) continue;
      const frag = document.createElement('span');
      let last = 0;
      txt.replace(re, (m, code, off) => {
        if (off > last) frag.appendChild(document.createTextNode(txt.slice(last, off)));
        const img = document.createElement('img');
        img.src = bttvMap[code];
        img.alt = code;
        img.title = code;
        img.style.height = '18px';
        img.style.verticalAlign = '-3px';
        frag.appendChild(img);
        last = off + m.length;
        return m;
      });
      if (last < txt.length) frag.appendChild(document.createTextNode(txt.slice(last)));
      tn.replaceWith(frag);
    }
  }

  /* ---------- UI ---------- */
  function buildUI() {
    const btn = document.createElement('button');
    btn.className = 'chatplus-floating-btn';
    btn.textContent = 'Chat+';
    document.documentElement.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'chatplus-panel';
    panel.innerHTML = `
      <header><span>PPV.to Chat+</span><button class="chatplus-btn" data-close>✕</button></header>
      <section>
        <label class="chatplus-checkbox">
          <input type="checkbox" id="chatplus-bttv"> Enable BTTV global emotes
        </label>
        <div class="chatplus-small">Client-side replacement of codes like <code>OMEGALUL</code>.</div>
      </section>
      <section>
        <strong>Word/Phrase Filters</strong>
        <label>Add substring or <code>/regex/i</code></label>
        <div class="row">
          <input id="chatplus-filter-in" type="text" placeholder="e.g. /bad\\s+word/i or just badword">
          <button class="chatplus-btn" id="chatplus-filter-add">Add</button>
        </div>
        <div id="chatplus-filter-list" style="margin-top:6px;"></div>
      </section>
      <section>
        <strong>Team Badges</strong>
        <label>User ID and image URL</label>
        <div class="row">
          <input id="chatplus-badge-uid" type="text" placeholder="User ID (numeric)">
          <input id="chatplus-badge-url" type="url" placeholder="https://example.com/logo.png">
        </div>
        <div class="chatplus-row">
          <button class="chatplus-btn" id="chatplus-badge-save">Save/Update</button>
          <button class="chatplus-btn" id="chatplus-badge-del">Remove</button>
        </div>
        <div id="chatplus-badge-list" style="margin-top:6px;"></div>
        <div class="chatplus-small">Tip: use the per-message “Badge” button to prefill the user ID.</div>
      </section>
      <section>
        <strong>Import/Export</strong>
        <textarea id="chatplus-json" rows="4" placeholder='{"filters":[],"badges":{},"enableBTTV":false}'></textarea>
        <div class="chatplus-row">
          <button class="chatplus-btn" id="chatplus-export">Export</button>
          <button class="chatplus-btn" id="chatplus-import">Import</button>
        </div>
      </section>
    `;
    document.documentElement.appendChild(panel);

    const toggle = () => {
      panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
    };
    btn.addEventListener('click', toggle);
    panel.querySelector('[data-close]').addEventListener('click', toggle);

    // Wire state
    const chk = panel.querySelector('#chatplus-bttv');
    const fin = panel.querySelector('#chatplus-filter-in');
    const fad = panel.querySelector('#chatplus-filter-add');
    const fls = panel.querySelector('#chatplus-filter-list');
    const bui = panel.querySelector('#chatplus-badge-uid');
    const bur = panel.querySelector('#chatplus-badge-url');
    const bsv = panel.querySelector('#chatplus-badge-save');
    const bdl = panel.querySelector('#chatplus-badge-del');
    const bls = panel.querySelector('#chatplus-badge-list');
    const jtx = panel.querySelector('#chatplus-json');
    const bex = panel.querySelector('#chatplus-export');
    const bim = panel.querySelector('#chatplus-import');

    function renderFilters() {
      fls.innerHTML = '';
      state.filters.forEach((f, i) => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.textContent = f;
        const rm = document.createElement('button');
        rm.textContent = '×';
        rm.title = 'Remove';
        rm.onclick = () => {
          state.filters.splice(i, 1);
          saveState();
          filterRegexes = compileFilters(state.filters);
          renderFilters();
        };
        pill.appendChild(rm);
        fls.appendChild(pill);
      });
      if (!state.filters.length) {
        const empty = document.createElement('div');
        empty.className = 'chatplus-small';
        empty.textContent = 'No filters set yet.';
        fls.appendChild(empty);
      }
    }
    function renderBadges() {
      bls.innerHTML = '';
      const ids = Object.keys(state.badges);
      if (!ids.length) {
        bls.innerHTML = '<div class="chatplus-small">No badges set.</div>';
        return;
      }
      ids.forEach((uid) => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        const img = document.createElement('img');
        img.src = state.badges[uid];
        img.style.height = '14px';
        img.style.verticalAlign = '-2px';
        pill.appendChild(img);
        pill.appendChild(document.createTextNode(' ' + uid));
        const rm = document.createElement('button');
        rm.textContent = '×';
        rm.title = 'Remove';
        rm.onclick = () => {
          delete state.badges[uid];
          saveState();
          renderBadges();
        };
        pill.appendChild(rm);
        bls.appendChild(pill);
      });
    }

    chk.checked = !!state.enableBTTV;
    chk.onchange = async () => {
      state.enableBTTV = chk.checked;
      saveState();
      if (state.enableBTTV && !bttvMap) await fetchBTTV();
    };
    fad.onclick = () => {
      const v = (fin.value || '').trim();
      if (!v) return;
      if (!state.filters.includes(v)) {
        state.filters.push(v);
        saveState();
        filterRegexes = compileFilters(state.filters);
        renderFilters();
      }
      fin.value = '';
    };
    bsv.onclick = () => {
      const uid = Number((bui.value || '').trim());
      const url = (bur.value || '').trim();
      if (!Number.isFinite(uid) || !url) return;
      state.badges[String(uid)] = url;
      saveState();
      renderBadges();
      bui.value = '';
      bur.value = '';
    };
    bdl.onclick = () => {
      const uid = Number((bui.value || '').trim());
      if (!Number.isFinite(uid)) return;
      delete state.badges[String(uid)];
      saveState();
      renderBadges();
      bui.value = '';
      bur.value = '';
    };
    bex.onclick = () => {
      jtx.value = JSON.stringify(state, null, 2);
      jtx.select();
      document.execCommand('copy');
    };
    bim.onclick = () => {
      try {
        const obj = JSON.parse(jtx.value || '{}');
        state = Object.assign({}, defaultState, obj);
        saveState();
        chk.checked = !!state.enableBTTV;
        filterRegexes = compileFilters(state.filters);
        renderFilters();
        renderBadges();
      } catch {
        alert('Invalid JSON');
      }
    };

    renderFilters();
    renderBadges();

    // Expose a tiny debug hook
    window.__CHATPLUS__ = {
      debug() {
        console.table({
          enableBTTV: state.enableBTTV,
          filters: state.filters.length,
          badges: Object.keys(state.badges).length,
          muted_count: getMuted().length
        });
      },
      prefillBadge(uid) {
        bui.value = String(uid || '');
        bur.focus();
      }
    };
  }

  /* ---------- DOM hooks ---------- */
  function waitForList(timeoutMs = 30000) {
    const sels = ['#message-list', '#message-cont', '.chat-message-list', '.chat-body'];
    return new Promise((resolve, reject) => {
      for (const s of sels) {
        const e = document.querySelector(s);
        if (e) return resolve(e.id === 'message-cont' ? (e.querySelector('#message-list') || e) : e);
      }
      const mo = new MutationObserver(() => {
        for (const s of sels) {
          const e = document.querySelector(s);
          if (e) {
            mo.disconnect();
            return resolve(e.id === 'message-cont' ? (e.querySelector('#message-list') || e) : e);
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        mo.disconnect();
        reject(new Error('chat list not found'));
      }, timeoutMs);
    });
  }

  function enhanceMessage(node) {
    if (!node || node.__chatplus_done) return;
    node.__chatplus_done = true;

    const userSpan = node.querySelector('[data-user-id]');
    const uid = userSpan ? Number(userSpan.getAttribute('data-user-id')) : NaN;

    // 1) hide if already muted
    const muted = new Set(getMuted());
    if (Number.isFinite(uid) && muted.has(uid)) {
      node.style.display = 'none';
      return;
    }

    // 2) filter text
    const textSpan = node.querySelector('.message-text') || node.querySelector('p, span');
    if (textSpan) {
      const txt = textSpan.innerText || textSpan.textContent || '';
      for (const re of filterRegexes) {
        if (re.test(txt)) {
          node.style.display = 'none';
          return;
        }
      }
    }

    // 3) local team badge
    if (Number.isFinite(uid) && state.badges[String(uid)] && userSpan) {
      const img = document.createElement('img');
      img.className = 'chatplus-team-badge';
      img.src = state.badges[String(uid)];
      img.alt = '';
      img.title = 'Team badge (local)';
      userSpan.parentNode.insertBefore(img, userSpan);
    }

    // 4) per-message tools
    const tools = document.createElement('span');
    tools.className = 'chatplus-msg-tools';

    const bBlock = document.createElement('button');
    bBlock.textContent = 'Block';
    bBlock.title = 'Mute this user (fs_mute cookie)';
    bBlock.onclick = () => {
      if (!Number.isFinite(uid)) return alert('No user ID on this message.');
      const list = getMuted();
      if (!list.includes(uid)) list.push(uid);
      setMuted(list);
      node.style.display = 'none';
    };

    const bBadge = document.createElement('button');
    bBadge.textContent = 'Badge';
    bBadge.title = 'Assign a local badge image URL';
    bBadge.onclick = () => {
      if (!Number.isFinite(uid)) return alert('No user ID on this message.');
      window.__CHATPLUS__?.prefillBadge(uid);
      const cur = state.badges[String(uid)] || '';
      const url = prompt(`Team badge image URL for user ${uid}:`, cur);
      if (url === null) return;
      if (url.trim()) {
        state.badges[String(uid)] = url.trim();
        saveState();
        const img = node.querySelector('.chatplus-team-badge');
        if (img) {
          img.src = url.trim();
        } else if (userSpan) {
          const badge = document.createElement('img');
          badge.className = 'chatplus-team-badge';
          badge.src = url.trim();
          badge.title = 'Team badge (local)';
          userSpan.parentNode.insertBefore(badge, userSpan);
        }
      } else {
        delete state.badges[String(uid)];
        saveState();
        node.querySelector('.chatplus-team-badge')?.remove();
      }
    };

    tools.appendChild(bBlock);
    tools.appendChild(bBadge);

    if (userSpan && userSpan.parentElement) userSpan.parentElement.appendChild(tools);
    else if (node.firstElementChild) node.firstElementChild.appendChild(tools);
    else node.appendChild(tools);

    // 5) BTTV replacement (optional)
    if (textSpan && state.enableBTTV) replaceBTTV(textSpan);
  }

  function observeList(list) {
    // Prime existing nodes
    list.querySelectorAll('.message, .chat-message').forEach(enhanceMessage);
    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!(n instanceof HTMLElement)) continue;
          if (n.matches('.message, .chat-message')) enhanceMessage(n);
          else n.querySelectorAll?.('.message, .chat-message').forEach(enhanceMessage);
        }
      }
    });
    mo.observe(list, { childList: true, subtree: true });
    log('Observer attached to', list.id || list.className || list.tagName);
  }

  /* ---------- Boot ---------- */
  async function boot() {
    buildUI();
    if (state.enableBTTV && !bttvMap) await fetchBTTV();

    let list;
    try {
      list = await waitForList(30000);
    } catch {
      log('Chat list not found; staying resident for future nav.');
      return;
    }

    // One-time sweep to hide messages from currently-muted IDs
    const muted = new Set(getMuted());
    list.querySelectorAll('.message, .chat-message').forEach((el) => {
      const span = el.querySelector('[data-user-id]');
      const uid = span ? Number(span.getAttribute('data-user-id')) : NaN;
      if (Number.isFinite(uid) && muted.has(uid)) el.style.display = 'none';
    });

    observeList(list);
    log('Ready. FS_STREAM_ID:', window.FS_STREAM_ID, 'socket type:', typeof window.socket);
  }

  boot();
})();
