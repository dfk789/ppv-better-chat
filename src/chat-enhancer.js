/*
 * PPV Chat Enhancer
 * Enhances the PPV.to live chat with per-user blocking, word filtering,
 * local team badges and integration with community emoji providers.
 */

(function () {
  const STORAGE_KEY = 'ppv-chat-enhancer-state';
  const ENHANCER_BADGE_PREFIX = 'chat-enhancer-team-';
  const PANEL_ID = 'chat-enhancer-panel';
  const PANEL_TOGGLE_ID = 'chat-enhancer-toggle';

  const defaultState = () => ({
    blocked: {
      ids: [],
      names: []
    },
    filteredWords: [],
    teamBadges: {
      selfBadge: null,
      selfUserId: null,
      assignments: {},
      knownUsers: {}
    }
  });

  let state = defaultState();
  let customEmotes = [];
  let originalAddMessage = null;
  let originalReplaceEmotes = null;
  let panelElement = null;
  let pendingBadgeUserId = null;

  function loadState() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state = defaultState();
        return;
      }
      const parsed = JSON.parse(raw);
      state = {
        blocked: {
          ids: Array.isArray(parsed?.blocked?.ids) ? parsed.blocked.ids.map(String) : [],
          names: Array.isArray(parsed?.blocked?.names)
            ? parsed.blocked.names.map((name) => name.toLowerCase())
            : []
        },
        filteredWords: Array.isArray(parsed?.filteredWords)
          ? parsed.filteredWords.map((word) => word.toLowerCase())
          : [],
        teamBadges: {
          selfBadge: parsed?.teamBadges?.selfBadge ?? null,
          selfUserId: parsed?.teamBadges?.selfUserId ? String(parsed.teamBadges.selfUserId) : null,
          assignments: parsed?.teamBadges?.assignments ? { ...parsed.teamBadges.assignments } : {},
          knownUsers: parsed?.teamBadges?.knownUsers ? { ...parsed.teamBadges.knownUsers } : {}
        }
      };
    } catch (error) {
      console.error('[PPV Chat Enhancer] Failed to load saved state', error);
      state = defaultState();
    }
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      console.error('[PPV Chat Enhancer] Failed to persist state', error);
    }
  }

  function normalizeWord(word) {
    return word.trim().toLowerCase();
  }

  function isBlocked(userId, username) {
    const normalizedId = userId != null ? String(userId) : null;
    const normalizedName = username ? username.toLowerCase() : null;
    if (normalizedId && state.blocked.ids.includes(normalizedId)) {
      return true;
    }
    if (normalizedName && state.blocked.names.includes(normalizedName)) {
      return true;
    }
    return false;
  }

  function addBlockedUser({ userId, username }) {
    if (userId != null) {
      const id = String(userId);
      if (!state.blocked.ids.includes(id)) {
        state.blocked.ids.push(id);
      }
    }
    if (username) {
      const lowered = username.toLowerCase();
      if (!state.blocked.names.includes(lowered)) {
        state.blocked.names.push(lowered);
      }
    }
    saveState();
    renderPanel();
  }

  function removeBlockedUser(identifier) {
    const normalized = identifier.toLowerCase();
    state.blocked.names = state.blocked.names.filter((name) => name !== normalized);
    state.blocked.ids = state.blocked.ids.filter((id) => id !== identifier && id !== normalized);
    saveState();
    renderPanel();
  }

  function addFilteredWord(word) {
    const normalized = normalizeWord(word);
    if (!normalized) return;
    if (!state.filteredWords.includes(normalized)) {
      state.filteredWords.push(normalized);
      saveState();
      renderPanel();
    }
  }

  function removeFilteredWord(word) {
    const normalized = normalizeWord(word);
    state.filteredWords = state.filteredWords.filter((entry) => entry !== normalized);
    saveState();
    renderPanel();
  }

  function recordKnownUser(userId, username) {
    if (!userId || !username) return;
    const id = String(userId);
    if (state.teamBadges.knownUsers[id] !== username) {
      state.teamBadges.knownUsers[id] = username;
      saveState();
      renderPanel();
    }
  }

  function assignBadgeToUser(userId, badgeKey) {
    if (!userId) return;
    if (badgeKey) {
      state.teamBadges.assignments[userId] = badgeKey;
    } else {
      delete state.teamBadges.assignments[userId];
    }
    saveState();
    renderPanel();
  }

  function setSelfBadge(badgeKey) {
    state.teamBadges.selfBadge = badgeKey;
    saveState();
  }

  function setSelfUserId(userId) {
    state.teamBadges.selfUserId = userId && userId.trim() ? userId.trim() : null;
    saveState();
  }

  function filterMessageContent(message) {
    if (!message || state.filteredWords.length === 0) {
      return message;
    }
    let filtered = message;
    for (const word of state.filteredWords) {
      if (!word) continue;
      const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
      filtered = filtered.replace(pattern, '***');
    }
    return filtered;
  }

  const TEAM_BADGES = {
    arsenal: createBadge('ARS', '#EF0107', '#063672'),
    astonvilla: createBadge('AVL', '#95BFE5', '#670E36'),
    brighton: createBadge('BHA', '#0057B8', '#FFE900'),
    brentford: createBadge('BRE', '#E30613', '#FFFFFF'),
    chelsea: createBadge('CHE', '#034694', '#FFFFFF'),
    everton: createBadge('EVE', '#003399', '#FFFFFF'),
    fulham: createBadge('FUL', '#000000', '#FFFFFF'),
    liverpool: createBadge('LIV', '#C8102E', '#00A398'),
    mancity: createBadge('MCI', '#6CABDD', '#1C2C5B'),
    manunited: createBadge('MUN', '#DA291C', '#FBE122'),
    newcastle: createBadge('NEW', '#241F20', '#FFFFFF'),
    tottenham: createBadge('TOT', '#001C58', '#FFFFFF'),
    westham: createBadge('WHU', '#7A263A', '#1BB1E7'),
    wolves: createBadge('WOL', '#FDB913', '#231F20')
  };

  function createBadge(text, bgColor, textColor) {
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'>` +
      `<rect width='64' height='64' rx='12' ry='12' fill='${bgColor}' />` +
      `<text x='32' y='38' font-family='"Segoe UI", sans-serif' font-size='26' font-weight='700' text-anchor='middle' fill='${textColor}'>${text}</text>` +
      `</svg>`;
    const base64 = btoa(unescape(encodeURIComponent(svg)));
    return {
      label: `${text} Supporter`,
      image: `data:image/svg+xml;base64,${base64}`
    };
  }

  function injectBadgeDictionaryEntries() {
    if (!window.badgeDictionary) {
      window.badgeDictionary = {};
    }
    for (const [key, badge] of Object.entries(TEAM_BADGES)) {
      window.badgeDictionary[`${ENHANCER_BADGE_PREFIX}${key}`] = {
        label: badge.label,
        image: badge.image
      };
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function determineBadgeForUser(userId) {
    if (!userId) return null;
    const id = String(userId);
    if (state.teamBadges.assignments[id]) {
      return state.teamBadges.assignments[id];
    }
    if (state.teamBadges.selfUserId && id === state.teamBadges.selfUserId && state.teamBadges.selfBadge) {
      return state.teamBadges.selfBadge;
    }
    return null;
  }

  function patchAddMessage() {
    if (typeof window.addMessage !== 'function' || window.addMessage === patchedAddMessage) {
      return;
    }
    originalAddMessage = window.addMessage;
    window.addMessage = patchedAddMessage;
  }

  function patchedAddMessage(data, ...rest) {
    try {
      const userId = data?.system_user_id ?? null;
      const username = data?.username ?? null;

      if (username) {
        recordKnownUser(userId != null ? String(userId) : undefined, username);
      }

      if (isBlocked(userId != null ? String(userId) : null, username)) {
        return;
      }

      if (typeof data.message === 'string' && data.message.length > 0) {
        data.message = filterMessageContent(data.message);
      }

      const badgeKey = determineBadgeForUser(userId);
      if (badgeKey) {
        if (!Array.isArray(data.badges)) {
          data.badges = [];
        }
        const fullKey = `${ENHANCER_BADGE_PREFIX}${badgeKey}`;
        if (!data.badges.includes(fullKey)) {
          data.badges.push(fullKey);
        }
      }
    } catch (error) {
      console.error('[PPV Chat Enhancer] Failed to process incoming message', error);
    }

    if (originalAddMessage) {
      originalAddMessage.call(window, data, ...rest);
    }
  }

  function patchReplaceEmotes() {
    if (window.replaceEmotes === patchedReplaceEmotes) return;
    originalReplaceEmotes = window.replaceEmotes ?? null;
    window.replaceEmotes = patchedReplaceEmotes;
  }

  function patchedReplaceEmotes(message, emotes) {
    let transformed = message;
    if (originalReplaceEmotes) {
      transformed = originalReplaceEmotes.call(window, message, emotes);
    }
    return applyCustomEmotesToHtml(transformed);
  }

  function applyCustomEmotesToHtml(html) {
    if (!html || customEmotes.length === 0) {
      return html;
    }
    return html.replace(/(^|>)([^<]+)/g, (match, prefix, text) => {
      let replacedText = text;
      for (const emote of customEmotes) {
        replacedText = replacedText.replace(emote.regex, (fullMatch) => {
          return `<img class="chat-icon chat-enhancer-emote" data-enhancer-emote="1" alt="${escapeHtml(fullMatch)}" title="${escapeHtml(fullMatch)}" src="${emote.imageUrl}" />`;
        });
      }
      return prefix + replacedText;
    });
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }

  async function loadCustomEmotes() {
    const promises = [fetchBTTVGlobal(), fetchSevenTVGlobal()];
    const results = await Promise.allSettled(promises);
    const collected = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        collected.push(...result.value);
      }
    }
    if (collected.length > 0) {
      const seen = new Set();
      customEmotes = collected.filter((emote) => {
        const key = emote.code.toLowerCase();
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
    }
  }

  async function fetchBTTVGlobal() {
    try {
      const response = await fetch('https://api.betterttv.net/3/cached/emotes/global');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      return data.map((item) => {
        const code = String(item?.code ?? '').trim();
        const id = String(item?.id ?? '').trim();
        return {
          code,
          imageUrl: `https://cdn.betterttv.net/emote/${id}/1x`,
          regex: new RegExp(escapeRegExp(code), 'g')
        };
      }).filter((emote) => emote.code && emote.imageUrl);
    } catch (error) {
      console.warn('[PPV Chat Enhancer] Failed to load BTTV emotes', error);
      return [];
    }
  }

  async function fetchSevenTVGlobal() {
    try {
      const response = await fetch('https://api.7tv.app/v2/emotes/global');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) return [];
      return data.map((item) => {
        const name = String(item?.name ?? '').trim();
        const id = String(item?.id ?? '').trim();
        return {
          code: name,
          imageUrl: `https://cdn.7tv.app/emote/${id}/1x.webp`,
          regex: new RegExp(escapeRegExp(name), 'g')
        };
      }).filter((emote) => emote.code && emote.imageUrl);
    } catch (error) {
      console.warn('[PPV Chat Enhancer] Failed to load 7TV emotes', error);
      return [];
    }
  }

  function waitForChat() {
    let attempts = 0;
    const maxAttempts = 120;
    const interval = window.setInterval(() => {
      attempts += 1;
      const messageList = document.querySelector('#message-list');
      if (typeof window.addMessage === 'function' && messageList) {
        window.clearInterval(interval);
        initializeEnhancer();
      } else if (attempts >= maxAttempts) {
        window.clearInterval(interval);
        console.warn('[PPV Chat Enhancer] Failed to initialize – chat not detected.');
      }
    }, 500);
  }

  function initializeEnhancer() {
    loadState();
    injectBadgeDictionaryEntries();
    patchAddMessage();
    patchReplaceEmotes();
    setupMutations();
    setupPanel();
    setupToggleButton();
    injectStyles();
    loadCustomEmotes();
  }

  function setupMutations() {
    const messageList = document.querySelector('#message-list');
    if (!messageList) return;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement && node.classList.contains('message')) {
            enhanceMessageNode(node);
          }
        });
      }
    });

    observer.observe(messageList, { childList: true });
  }

  function enhanceMessageNode(node) {
    if (node.dataset.enhanced === '1') {
      return;
    }
    node.dataset.enhanced = '1';

    const usernameSpan = node.querySelector('[data-user-id]') || node.querySelector('.username');
    const messageSpan = node.querySelector('.message-text') || node.querySelector('span:last-child');

    const userId = usernameSpan?.dataset?.userId || usernameSpan?.getAttribute?.('data-user-id') || null;
    const username = usernameSpan?.textContent?.trim() || null;

    if (isBlocked(userId, username)) {
      node.remove();
      return;
    }

    if (messageSpan) {
      const originalText = messageSpan.textContent || '';
      const filteredText = filterMessageContent(originalText);
      messageSpan.innerHTML = applyCustomEmotesToHtml(filteredText);
    }

    if (usernameSpan) {
      addMessageActions(node, usernameSpan, { userId, username });
    }
  }

  function addMessageActions(container, usernameElement, meta) {
    if (container.querySelector('.chat-enhancer-actions')) {
      return;
    }
    const actions = document.createElement('span');
    actions.className = 'chat-enhancer-actions';

    const blockButton = document.createElement('button');
    blockButton.type = 'button';
    blockButton.className = 'chat-enhancer-btn';
    blockButton.title = 'Block user';
    blockButton.textContent = '🚫';
    blockButton.addEventListener('click', (event) => {
      event.stopPropagation();
      addBlockedUser({ userId: meta.userId, username: meta.username });
      container.remove();
    });

    const badgeButton = document.createElement('button');
    badgeButton.type = 'button';
    badgeButton.className = 'chat-enhancer-btn';
    badgeButton.title = 'Assign team badge';
    badgeButton.textContent = '🎉';
    badgeButton.addEventListener('click', (event) => {
      event.stopPropagation();
      if (meta.userId) {
        pendingBadgeUserId = meta.userId;
        openPanel();
        focusBadgeAssignment(meta.userId, meta.username || undefined);
      }
    });

    actions.append(blockButton, badgeButton);
    usernameElement.insertAdjacentElement('afterend', actions);
  }

  function focusBadgeAssignment(userId, username) {
    const input = panelElement?.querySelector('#chat-enhancer-assignment-id');
    const select = panelElement?.querySelector('#chat-enhancer-assignment-team');
    if (input) {
      input.value = userId;
    }
    if (select && pendingBadgeUserId) {
      select.focus();
    }
    const usernameLabel = panelElement?.querySelector('#chat-enhancer-assignment-name');
    if (usernameLabel && username) {
      usernameLabel.textContent = username;
    }
  }

  function setupToggleButton() {
    if (document.getElementById(PANEL_TOGGLE_ID)) return;
    const form = document.querySelector('#message-form');
    if (!form) return;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = PANEL_TOGGLE_ID;
    toggle.textContent = 'Enhancer';
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      if (panelElement?.classList.contains('open')) {
        closePanel();
      } else {
        openPanel();
      }
    });
    form.appendChild(toggle);
  }

  function setupPanel() {
    if (panelElement) return;
    panelElement = document.createElement('div');
    panelElement.id = PANEL_ID;
    panelElement.innerHTML = `
      <div class="chat-enhancer-header">
        <h3>Chat Enhancer</h3>
        <button type="button" id="chat-enhancer-close" title="Close">×</button>
      </div>
      <div class="chat-enhancer-section">
        <h4>Blocked users</h4>
        <form id="chat-enhancer-block-form">
          <input type="text" id="chat-enhancer-block-input" placeholder="Username or ID" />
          <button type="submit">Add</button>
        </form>
        <ul id="chat-enhancer-blocked-list"></ul>
      </div>
      <div class="chat-enhancer-section">
        <h4>Filtered words</h4>
        <form id="chat-enhancer-word-form">
          <input type="text" id="chat-enhancer-word-input" placeholder="Add word" />
          <button type="submit">Add</button>
        </form>
        <ul id="chat-enhancer-word-list"></ul>
      </div>
      <div class="chat-enhancer-section">
        <h4>Team badges</h4>
        <div class="chat-enhancer-self">
          <label>User ID
            <input type="text" id="chat-enhancer-self-id" placeholder="Your user ID" />
          </label>
          <label>Team
            <select id="chat-enhancer-self-team"></select>
          </label>
          <button type="button" id="chat-enhancer-self-save">Save</button>
        </div>
        <div class="chat-enhancer-assignment">
          <h5>Assign badge to other user</h5>
          <div class="chat-enhancer-known-users" id="chat-enhancer-known-users"></div>
          <label>User ID
            <input type="text" id="chat-enhancer-assignment-id" placeholder="User ID" />
          </label>
          <div class="chat-enhancer-assignment-target">Selected: <span id="chat-enhancer-assignment-name">—</span></div>
          <label>Team
            <select id="chat-enhancer-assignment-team"></select>
          </label>
          <div class="chat-enhancer-assignment-actions">
            <button type="button" id="chat-enhancer-assignment-save">Assign</button>
            <button type="button" id="chat-enhancer-assignment-clear">Clear</button>
          </div>
        </div>
        <ul id="chat-enhancer-badge-list"></ul>
      </div>
    `;
    document.body.appendChild(panelElement);

    panelElement.querySelector('#chat-enhancer-close')?.addEventListener('click', () => closePanel());

    const blockForm = panelElement.querySelector('#chat-enhancer-block-form');
    blockForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = panelElement?.querySelector('#chat-enhancer-block-input');
      if (input && input.value.trim()) {
        addBlockedUser({ userId: input.value.trim(), username: input.value.trim() });
        input.value = '';
      }
    });

    const wordForm = panelElement.querySelector('#chat-enhancer-word-form');
    wordForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      const input = panelElement?.querySelector('#chat-enhancer-word-input');
      if (input && input.value.trim()) {
        addFilteredWord(input.value);
        input.value = '';
      }
    });

    const selfIdInput = panelElement.querySelector('#chat-enhancer-self-id');
    const selfTeamSelect = panelElement.querySelector('#chat-enhancer-self-team');
    const assignmentTeamSelect = panelElement.querySelector('#chat-enhancer-assignment-team');

    populateBadgeSelect(selfTeamSelect);
    populateBadgeSelect(assignmentTeamSelect);

    panelElement.querySelector('#chat-enhancer-self-save')?.addEventListener('click', () => {
      setSelfUserId(selfIdInput?.value ?? null);
      const team = selfTeamSelect?.value === 'none' ? null : selfTeamSelect?.value ?? null;
      setSelfBadge(team);
      saveState();
      renderPanel();
    });

    panelElement.querySelector('#chat-enhancer-assignment-save')?.addEventListener('click', () => {
      const idInput = panelElement?.querySelector('#chat-enhancer-assignment-id');
      const team = assignmentTeamSelect?.value === 'none' ? null : assignmentTeamSelect?.value ?? null;
      if (idInput && idInput.value.trim()) {
        assignBadgeToUser(idInput.value.trim(), team);
        pendingBadgeUserId = null;
      }
    });

    panelElement.querySelector('#chat-enhancer-assignment-clear')?.addEventListener('click', () => {
      const idInput = panelElement?.querySelector('#chat-enhancer-assignment-id');
      if (idInput && idInput.value.trim()) {
        assignBadgeToUser(idInput.value.trim(), null);
        pendingBadgeUserId = null;
      }
    });

    renderPanel();
  }

  function populateBadgeSelect(select) {
    if (!select) return;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = 'none';
    option.textContent = 'No badge';
    select.appendChild(option);
    for (const [key, badge] of Object.entries(TEAM_BADGES)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = badge.label.replace(' Supporter', '');
      select.appendChild(opt);
    }
  }

  function renderPanel() {
    if (!panelElement) return;
    const blockedList = panelElement.querySelector('#chat-enhancer-blocked-list');
    if (blockedList) {
      blockedList.innerHTML = '';
      const combined = new Set([...state.blocked.ids, ...state.blocked.names]);
      for (const entry of combined) {
        const li = document.createElement('li');
        li.textContent = entry;
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Remove';
        button.addEventListener('click', () => removeBlockedUser(entry));
        li.appendChild(button);
        blockedList.appendChild(li);
      }
      if (combined.size === 0) {
        blockedList.innerHTML = '<li class="chat-enhancer-empty">No blocked users</li>';
      }
    }

    const wordList = panelElement.querySelector('#chat-enhancer-word-list');
    if (wordList) {
      wordList.innerHTML = '';
      if (state.filteredWords.length === 0) {
        wordList.innerHTML = '<li class="chat-enhancer-empty">No filtered words</li>';
      } else {
        for (const word of state.filteredWords) {
          const li = document.createElement('li');
          li.textContent = word;
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'Remove';
          button.addEventListener('click', () => removeFilteredWord(word));
          li.appendChild(button);
          wordList.appendChild(li);
        }
      }
    }

    const selfIdInput = panelElement.querySelector('#chat-enhancer-self-id');
    if (selfIdInput) {
      selfIdInput.value = state.teamBadges.selfUserId ?? '';
    }

    const selfTeamSelect = panelElement.querySelector('#chat-enhancer-self-team');
    if (selfTeamSelect) {
      selfTeamSelect.value = state.teamBadges.selfBadge ?? 'none';
    }

    const assignmentList = panelElement.querySelector('#chat-enhancer-badge-list');
    if (assignmentList) {
      assignmentList.innerHTML = '';
      const entries = Object.entries(state.teamBadges.assignments);
      if (entries.length === 0) {
        assignmentList.innerHTML = '<li class="chat-enhancer-empty">No badge assignments yet</li>';
      } else {
        for (const [userId, badgeKey] of entries) {
          const li = document.createElement('li');
          const label = TEAM_BADGES[badgeKey]?.label ?? badgeKey;
          const username = state.teamBadges.knownUsers[userId];
          li.textContent = `${username ? username + ' ' : ''}(ID: ${userId}) → ${label}`;
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = 'Remove';
          button.addEventListener('click', () => assignBadgeToUser(userId, null));
          li.appendChild(button);
          assignmentList.appendChild(li);
        }
      }
    }

    const knownUsersContainer = panelElement.querySelector('#chat-enhancer-known-users');
    if (knownUsersContainer) {
      knownUsersContainer.innerHTML = '';
      const entries = Object.entries(state.teamBadges.knownUsers);
      if (entries.length === 0) {
        knownUsersContainer.innerHTML = '<p class="chat-enhancer-empty">Interact with chat to collect user IDs.</p>';
      } else {
        for (const [userId, username] of entries.slice(0, 50)) {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'chat-enhancer-known-user';
          button.textContent = `${username} (${userId})`;
          button.addEventListener('click', () => {
            const input = panelElement?.querySelector('#chat-enhancer-assignment-id');
            if (input) {
              input.value = userId;
            }
            const nameLabel = panelElement?.querySelector('#chat-enhancer-assignment-name');
            if (nameLabel) {
              nameLabel.textContent = username;
            }
          });
          knownUsersContainer.appendChild(button);
        }
      }
    }
  }

  function openPanel() {
    panelElement?.classList.add('open');
  }

  function closePanel() {
    panelElement?.classList.remove('open');
    pendingBadgeUserId = null;
  }

  function injectStyles() {
    if (document.getElementById('chat-enhancer-style')) return;
    const style = document.createElement('style');
    style.id = 'chat-enhancer-style';
    style.textContent = `
      #${PANEL_TOGGLE_ID} {
        margin-left: 8px;
        padding: 4px 8px;
        font-size: 12px;
        border-radius: 4px;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(0,0,0,0.4);
        color: #fff;
        cursor: pointer;
      }
      #${PANEL_TOGGLE_ID}:hover {
        background: rgba(0,0,0,0.6);
      }
      #${PANEL_ID} {
        position: fixed;
        top: 64px;
        right: 24px;
        width: 320px;
        max-height: calc(100vh - 88px);
        overflow-y: auto;
        background: rgba(15, 18, 25, 0.97);
        color: #f5f7fa;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px;
        box-shadow: 0 12px 30px rgba(0,0,0,0.45);
        padding: 16px;
        z-index: 99999;
        display: none;
        backdrop-filter: blur(6px);
        font-family: "Segoe UI", sans-serif;
      }
      #${PANEL_ID}.open { display: block; }
      #${PANEL_ID} h3 { margin: 0 0 12px; font-size: 18px; }
      #${PANEL_ID} h4 { margin: 12px 0 8px; font-size: 15px; }
      #${PANEL_ID} h5 { margin: 8px 0; font-size: 13px; }
      #${PANEL_ID} button { cursor: pointer; }
      #${PANEL_ID} input, #${PANEL_ID} select {
        width: 100%;
        margin-top: 4px;
        margin-bottom: 8px;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.2);
        background: rgba(0,0,0,0.2);
        color: inherit;
        font-size: 13px;
      }
      #${PANEL_ID} form { display: flex; gap: 8px; }
      #${PANEL_ID} form input { flex: 1; }
      #${PANEL_ID} form button, #${PANEL_ID} .chat-enhancer-assignment-actions button,
      #${PANEL_ID} .chat-enhancer-self button {
        padding: 6px 10px;
        border-radius: 6px;
        border: none;
        background: #2563eb;
        color: #fff;
        font-weight: 600;
        transition: background 0.2s ease;
      }
      #${PANEL_ID} form button:hover,
      #${PANEL_ID} .chat-enhancer-self button:hover,
      #${PANEL_ID} .chat-enhancer-assignment-actions button:hover {
        background: #1d4ed8;
      }
      #${PANEL_ID} ul { list-style: none; padding: 0; margin: 8px 0 0; }
      #${PANEL_ID} li { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; }
      #${PANEL_ID} li button { background: transparent; border: 1px solid rgba(255,255,255,0.2); color: inherit; border-radius: 4px; padding: 2px 6px; }
      #${PANEL_ID} li button:hover { background: rgba(255,255,255,0.1); }
      #${PANEL_ID} .chat-enhancer-header { display: flex; justify-content: space-between; align-items: center; }
      #${PANEL_ID} #chat-enhancer-close { background: transparent; border: none; color: inherit; font-size: 24px; line-height: 1; padding: 0 4px; }
      #${PANEL_ID} #chat-enhancer-close:hover { color: #f87171; }
      #${PANEL_ID} .chat-enhancer-empty { opacity: 0.7; font-style: italic; }
      #${PANEL_ID} .chat-enhancer-self { display: grid; grid-template-columns: 1fr 1fr auto; align-items: end; gap: 8px; }
      #${PANEL_ID} .chat-enhancer-self label { display: flex; flex-direction: column; font-size: 12px; }
      #${PANEL_ID} .chat-enhancer-assignment { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
      #${PANEL_ID} .chat-enhancer-known-users { display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto; }
      .chat-enhancer-known-user { background: rgba(37, 99, 235, 0.2); border: 1px solid rgba(37,99,235,0.4); border-radius: 999px; padding: 4px 8px; font-size: 12px; }
      .chat-enhancer-known-user:hover { background: rgba(37,99,235,0.35); }
      .chat-enhancer-actions { display: inline-flex; gap: 4px; margin-left: 4px; }
      .chat-enhancer-btn { background: transparent; border: none; font-size: 12px; cursor: pointer; color: #fff; }
      .chat-enhancer-btn:hover { filter: brightness(1.2); }
      .chat-enhancer-emote { height: 22px; vertical-align: middle; }
    `;
    document.head.appendChild(style);
  }

  waitForChat();
})();
