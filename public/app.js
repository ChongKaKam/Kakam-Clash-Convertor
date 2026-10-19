import { mountExplorer } from './explorer.js';

const $ = (selector) => document.querySelector(selector);
const tokenInput = $('#token');
function stored(storage, key) {
  try { return window[storage].getItem(key); } catch { return null; }
}
function remember(storage, key, value) {
  try { value ? window[storage].setItem(key, value) : window[storage].removeItem(key); } catch { /* Storage is optional. */ }
}
const state = {
  token: stored('sessionStorage', 'adminToken') || '', baseUrl: location.origin,
  items: [], settings: null, connected: false, epoch: 0,
};
tokenInput.value = state.token;
let disposeExplorers = [];

function setupTheme() {
  const preference = window.matchMedia('(prefers-color-scheme: dark)');
  const saved = stored('localStorage', 'clash-theme');
  let choice = ['light', 'dark', 'system'].includes(saved) ? saved : 'system';
  function apply() {
    document.documentElement.dataset.theme = choice === 'system' ? (preference.matches ? 'dark' : 'light') : choice;
    for (const button of document.querySelectorAll('[data-theme-choice]')) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === choice));
    }
  }
  for (const button of document.querySelectorAll('[data-theme-choice]')) {
    button.addEventListener('click', () => {
      choice = button.dataset.themeChoice;
      remember('localStorage', 'clash-theme', choice);
      apply();
    });
  }
  preference.addEventListener('change', () => { if (choice === 'system') apply(); });
  apply();
}

function setupNavigation() {
  const links = [...document.querySelectorAll('[data-nav]')];
  const currentSection = (hash) => hash === '#add-subscription' ? '#subscriptions' : hash;
  const followsInPlace = (event) => !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
  function activate(hash) {
    for (const link of links) {
      if (link.hash === hash) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }
  for (const link of links) link.addEventListener('click', (event) => { if (followsInPlace(event)) activate(link.hash); });
  for (const link of document.querySelectorAll('[data-focus-source]')) {
    link.addEventListener('click', (event) => {
      if (!followsInPlace(event)) return;
      activate('#subscriptions');
      requestAnimationFrame(() => $('#name').focus({ preventScroll: true }));
    });
  }
  activate(links.some((link) => link.hash === currentSection(location.hash)) ? currentSection(location.hash) : '#overview');
  window.addEventListener('hashchange', () => {
    if (links.some((link) => link.hash === currentSection(location.hash))) activate(currentSection(location.hash));
  });
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) activate(`#${visible[0].target.id}`);
    }, { rootMargin: '-12% 0px -60% 0px', threshold: 0 });
    for (const link of links) {
      const section = document.getElementById(link.hash.slice(1));
      if (section) observer.observe(section);
    }
  }
}

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2800);
}

function busy(button, label) {
  const original = button.innerHTML;
  button.disabled = true; button.setAttribute('aria-busy', 'true'); button.textContent = label;
  return (disabled = false) => {
    button.innerHTML = original; button.disabled = disabled; button.removeAttribute('aria-busy');
  };
}

function setConnection(kind, detail = '') {
  const labels = { disconnected: '尚未连接', loading: '正在连接', connected: '已连接', error: state.connected ? '同步失败' : '连接失败' };
  for (const selector of ['#status', '#connection-status']) {
    const node = $(selector);
    node.dataset.state = kind; node.textContent = labels[kind]; node.title = detail || labels[kind];
  }
  const createButton = $('#create-form button[type="submit"]');
  const whitelistButton = $('#save-whitelist');
  createButton.disabled = !state.connected || createButton.getAttribute('aria-busy') === 'true';
  whitelistButton.disabled = !state.connected || !state.settings || whitelistButton.getAttribute('aria-busy') === 'true';
  $('#direct-whitelist').disabled = whitelistButton.disabled;
}

function updateOverview() {
  const number = (value) => value.toLocaleString('zh-CN');
  $('#metric-subscriptions').textContent = state.connected ? number(state.items.length) : '—';
  $('#metric-nodes').textContent = state.connected ? number(state.items.reduce((total, item) => total + (item.summary?.selectedCount || 0), 0)) : '—';
  $('#metric-whitelist').textContent = state.settings ? number(state.settings.directWhitelist.length) : '—';
  $('#nav-count').textContent = state.connected ? number(state.items.length) : '—';
  $('#count').textContent = state.connected ? `${number(state.items.length)} 个订阅` : '等待连接';
}

function emptyState(title, description) {
  $('#empty-title').textContent = title; $('#empty-description').textContent = description;
}

function clearConnection(message = '') {
  state.connected = false; state.items = []; state.settings = null; state.baseUrl = location.origin;
  $('#direct-whitelist').value = ''; $('#whitelist-status').textContent = '连接后可编辑';
  render();
  emptyState('连接你的订阅空间', message || '输入管理令牌并连接，即可查看和管理你的平台订阅。');
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(response.status === 401 ? '管理令牌无效，请检查后重新连接。' : body.error || `请求失败（HTTP ${response.status}）`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function handleFailure(error, connecting = false) {
  if (connecting || error.status === 401 || error.status === 403) {
    state.epoch += 1;
    clearConnection(error.message);
    if (error.status === 401 || error.status === 403) remember('sessionStorage', 'adminToken', '');
  }
  setConnection(state.connected && error.status && error.status < 500 ? 'connected' : 'error', error.message);
  toast(error.message);
}

function profileUrl(item, device) { return `${state.baseUrl}/sub/${item.publicToken}/${device}.yaml`; }
const DEVICE_ICONS = {
  tvos: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>',
  ios: '<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M10 5h4m-3 14h2"/>',
  android: '<path d="m8 4-2-2m10 2 2-2M5 11a7 7 0 0 1 14 0v7H5zM3 11v5m18-5v5M8 18v4m8-4v4"/><path d="M9 7h.01M15 7h.01"/>',
  esim: '<path d="M8 2h7l5 5v15H4V6a4 4 0 0 1 4-4Z"/><rect x="8" y="10" width="8" height="8" rx="1"/><path d="M12 10v8m-4-4h8"/>',
};

function render() {
  for (const dispose of disposeExplorers) dispose();
  disposeExplorers = [];
  const list = $('#list'); list.replaceChildren();
  $('#empty').hidden = state.items.length > 0;
  if (state.connected) emptyState('你的第一个订阅，从这里开始', '添加一个上游订阅，即可生成四套平台配置，让每台设备都准备就绪。');
  updateOverview();
  for (const item of state.items) {
    const card = $('#card-template').content.firstElementChild.cloneNode(true);
    card.querySelector('h3').textContent = item.name;
    card.querySelector('.meta').textContent = `${item.upstreamHost} · ${item.lastRefreshAt ? `更新于 ${new Date(item.lastRefreshAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '尚未更新'}`;
    const health = card.querySelector('.health');
    health.textContent = item.lastError ? '需要关注' : '运行正常'; health.classList.toggle('bad', Boolean(item.lastError));
    const summary = item.summary || { proxyCount: 0, selectedCount: 0, ruleCount: 0, regions: {} };
    for (const [label, value] of [
      ['筛选节点', `${summary.selectedCount} / ${summary.proxyCount}`],
      ['上游规则', String(summary.ruleCount)],
      ['港台美日', `${summary.regions?.hk || 0} / ${summary.regions?.tw || 0} / ${summary.regions?.us || 0} / ${summary.regions?.jp || 0}`],
    ]) {
      const stat = document.createElement('span'); stat.className = 'stat';
      const caption = document.createElement('small'); caption.textContent = label;
      const count = document.createElement('strong'); count.textContent = value;
      stat.append(caption, count); card.querySelector('.stats').append(stat);
    }
    for (const [device, label] of [['tvos','tvOS'],['ios','iOS'],['android','Android'],['esim','Esim']]) {
      const row = document.createElement('div'); row.className = 'device';
      const url = profileUrl(item, device);
      row.innerHTML = `<span class="device-label"><svg class="device-icon" viewBox="0 0 24 24" aria-hidden="true">${DEVICE_ICONS[device]}</svg><span>${label}</span></span><input readonly aria-label="${label} 订阅链接"><button type="button" class="copy"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 4V3H3v9h1"/></svg><span>复制</span></button>`;
      row.querySelector('input').value = url;
      row.querySelector('.copy').setAttribute('aria-label', `复制 ${item.name} 的 ${label} 订阅链接`);
      row.querySelector('.copy').onclick = async () => {
        try {
          if (!navigator.clipboard) throw new Error('clipboard unavailable');
          await navigator.clipboard.writeText(url); toast(`已复制 ${label} 链接`);
        } catch {
          const input = row.querySelector('input'); input.focus(); input.select(); toast('链接已选中，请手动复制');
        }
      };
      card.querySelector('.links').append(row);
    }
    card.querySelector('.error').textContent = item.lastError || '';
    for (const button of card.querySelectorAll('[data-action]')) {
      button.setAttribute('aria-label', `${button.textContent.trim()}：${item.name}`);
    }
    card.addEventListener('click', async (event) => {
      const button = event.target instanceof Element ? event.target.closest('[data-action]') : null;
      if (!button || !card.contains(button) || button.disabled) return;
      const action = button.dataset.action;
      if (!['delete', 'refresh', 'rotate'].includes(action)) return;
      if (action === 'delete' && !confirm(`确认删除“${item.name}”？设备订阅地址将立即失效。`)) return;
      if (action === 'rotate' && !confirm('更换令牌后，所有旧设备订阅地址都会失效。继续吗？')) return;
      const restore = busy(button, { delete: '删除中…', refresh: '刷新中…', rotate: '更换中…' }[action]);
      const epoch = state.epoch;
      try {
        if (action === 'delete') await request(`/api/subscriptions/${item.id}`, { method: 'DELETE' });
        else if (action === 'refresh') await request(`/api/subscriptions/${item.id}/refresh`, { method: 'POST' });
        else await request(`/api/subscriptions/${item.id}/token`, { method: 'POST' });
        if (epoch !== state.epoch) return;
        toast({ delete: '订阅已删除', refresh: '上游已刷新', rotate: '链接令牌已更换' }[action]); await load();
      } catch (error) { if (epoch === state.epoch) handleFailure(error); }
      finally { restore(); }
    });
    list.append(card);
    disposeExplorers.push(mountExplorer(card.querySelector('.explorer-host'), item, request));
  }
}

async function load(includeSettings = false, { initial = false } = {}) {
  const epoch = state.epoch;
  try {
    const [data, settings] = await Promise.all([
      request('/api/subscriptions'),
      includeSettings ? request('/api/settings') : Promise.resolve(null),
    ]);
    if (epoch !== state.epoch) return;
    state.items = data.items; state.baseUrl = data.publicBaseUrl || location.origin;
    state.connected = true;
    if (includeSettings) {
      state.settings = settings;
      $('#direct-whitelist').value = settings.directWhitelist.join('\n');
      $('#whitelist-status').textContent = `已保存 ${settings.directWhitelist.length} 条`;
    }
    remember('sessionStorage', 'adminToken', state.token);
    setConnection('connected'); render();
  } catch (error) {
    if (epoch !== state.epoch) return;
    if (initial && !state.token && error.status === 401) {
      state.epoch += 1;
      clearConnection(); setConnection('disconnected');
    } else handleFailure(error, includeSettings);
  }
}

async function connect({ initial = false } = {}) {
  state.epoch += 1; state.token = tokenInput.value.trim();
  clearConnection(); setConnection('loading');
  emptyState('正在连接你的订阅空间', '正在读取订阅与直连规则，请稍候。');
  const restore = busy($('#connect'), '连接中…');
  try { await load(true, { initial }); } finally { restore(); }
}

$('#auth-form').addEventListener('submit', (event) => { event.preventDefault(); if (!$('#connect').disabled) connect(); });
$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter || $('#create-form button[type="submit"]');
  if (!state.connected || button.disabled) return;
  const restore = busy(button, '添加并拉取中…');
  const epoch = state.epoch;
  try {
    await request('/api/subscriptions', { method: 'POST', body: JSON.stringify({ name: $('#name').value, url: $('#url').value, includeUpstreamRules: $('#upstream-rules').checked }) });
    if (epoch !== state.epoch) return;
    event.target.reset(); $('#upstream-rules').checked = true; toast('订阅已添加'); await load();
  } catch (error) { if (epoch === state.epoch) handleFailure(error); }
  finally { restore(!state.connected); }
});
$('#whitelist-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#save-whitelist');
  if (!state.connected || button.disabled) return;
  const restore = busy(button, '保存中…');
  const epoch = state.epoch;
  $('#direct-whitelist').disabled = true;
  try {
    const settings = await request('/api/settings', { method: 'PUT', body: JSON.stringify({ directWhitelist: $('#direct-whitelist').value }) });
    if (epoch !== state.epoch) return;
    state.settings = settings;
    $('#direct-whitelist').value = settings.directWhitelist.join('\n');
    $('#whitelist-status').textContent = `已保存 ${settings.directWhitelist.length} 条，请在客户端更新订阅`;
    updateOverview(); setConnection('connected'); toast('白名单已保存');
  } catch (error) {
    if (epoch === state.epoch) { handleFailure(error); $('#whitelist-status').textContent = error.message; }
  } finally { restore(!state.connected || !state.settings); $('#direct-whitelist').disabled = !state.connected || !state.settings; }
});

setupTheme();
setupNavigation();
connect({ initial: true });
