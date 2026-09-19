import { mountExplorer } from './explorer.js';
import { profileUrl } from './urls.js';

const $ = (selector) => document.querySelector(selector);
const tokenInput = $('#token');
const state = { token: sessionStorage.getItem('adminToken') || '', baseUrl: location.origin, items: [] };
tokenInput.value = state.token;
let disposeExplorers = [];

function toast(message) {
  const node = $('#toast'); node.textContent = message; node.classList.add('show');
  clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(state.token ? { authorization: `Bearer ${state.token}` } : {}), ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

function render() {
  for (const dispose of disposeExplorers) dispose();
  disposeExplorers = [];
  const list = $('#list'); list.replaceChildren();
  $('#empty').hidden = state.items.length > 0;
  $('#count').textContent = `${state.items.length} 个订阅`;
  for (const item of state.items) {
    const card = $('#card-template').content.firstElementChild.cloneNode(true);
    card.querySelector('h3').textContent = item.name;
    card.querySelector('.meta').textContent = `${item.upstreamHost} · ${item.lastRefreshAt ? `更新于 ${new Date(item.lastRefreshAt).toLocaleString()}` : '尚未更新'}`;
    const health = card.querySelector('.health');
    health.textContent = item.lastError ? '● 异常' : '● 正常'; health.classList.toggle('bad', Boolean(item.lastError));
    const summary = item.summary || { proxyCount: 0, selectedCount: 0, ruleCount: 0, regions: {} };
    card.querySelector('.stats').innerHTML = `<span class="stat">筛选节点 <strong>${summary.selectedCount}/${summary.proxyCount}</strong></span><span class="stat">上游规则 <strong>${summary.ruleCount}</strong></span><span class="stat">港台美日 <strong>${summary.regions?.hk||0} / ${summary.regions?.tw||0} / ${summary.regions?.us||0} / ${summary.regions?.jp||0}</strong></span>`;
    for (const [device, label] of [['tvos','tvOS'],['ios','iOS'],['android','Android']]) {
      const row = document.createElement('div'); row.className = 'device';
      const url = profileUrl(state.baseUrl, item, device);
      row.innerHTML = `<span>${label}</span><input readonly aria-label="${label} 订阅链接"><button type="button" class="copy" aria-label="复制 ${label} 订阅链接"><svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="2"/><path d="M12 4V3H3v9h1"/></svg>copy</button>`;
      row.querySelector('input').value = url;
      row.querySelector('.copy').onclick = async () => {
        try {
          if (!navigator.clipboard) throw new Error('clipboard unavailable');
          await navigator.clipboard.writeText(url); toast(`已复制 ${label} 链接`);
        } catch {
          const input = row.querySelector('input'); input.focus(); input.select();
          toast('链接已选中，请手动复制');
        }
      };
      card.querySelector('.links').append(row);
    }
    card.querySelector('.error').textContent = item.lastError || '';
    card.addEventListener('click', async (event) => {
      const action = event.target.dataset.action; if (!action) return;
      event.target.disabled = true;
      try {
        if (action === 'delete') {
          if (!confirm(`确认删除“${item.name}”？设备订阅地址将立即失效。`)) return;
          await request(`/api/subscriptions/${item.id}`, { method: 'DELETE' }); toast('订阅已删除');
        } else if (action === 'refresh') {
          await request(`/api/subscriptions/${item.id}/refresh`, { method: 'POST' }); toast('上游已刷新');
        } else if (action === 'rotate') {
          if (!confirm('更换令牌后，所有旧设备订阅地址都会失效。继续吗？')) return;
          await request(`/api/subscriptions/${item.id}/token`, { method: 'POST' }); toast('链接令牌已更换');
        }
        await load();
      } catch (error) { toast(error.message); }
      finally { event.target.disabled = false; }
    });
    list.append(card);
    disposeExplorers.push(mountExplorer(card.querySelector('.explorer-host'), item, request));
  }
}

async function load(includeSettings = false) {
  try {
    const data = await request('/api/subscriptions');
    state.items = data.items; state.baseUrl = data.publicBaseUrl || location.origin;
    $('#status').textContent = '已连接'; render();
    if (includeSettings) {
      const settings = await request('/api/settings');
      $('#direct-whitelist').value = settings.directWhitelist.join('\n');
      $('#direct-whitelist').disabled = false;
      $('#save-whitelist').disabled = false;
      $('#whitelist-status').textContent = `已保存 ${settings.directWhitelist.length} 条`;
    }
  } catch (error) { $('#status').textContent = error.message; }
}

$('#connect').onclick = () => {
  state.token = tokenInput.value; sessionStorage.setItem('adminToken', state.token); load(true);
};
$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    await request('/api/subscriptions', { method: 'POST', body: JSON.stringify({ name: $('#name').value, url: $('#url').value, includeUpstreamRules: $('#upstream-rules').checked }) });
    event.target.reset(); $('#upstream-rules').checked = true; toast('订阅已添加'); await load();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#whitelist-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#save-whitelist'); button.disabled = true;
  $('#direct-whitelist').disabled = true;
  try {
    const settings = await request('/api/settings', { method: 'PUT', body: JSON.stringify({ directWhitelist: $('#direct-whitelist').value }) });
    $('#direct-whitelist').value = settings.directWhitelist.join('\n');
    $('#whitelist-status').textContent = `已保存 ${settings.directWhitelist.length} 条，请在客户端更新订阅`;
    toast('白名单已保存');
  } catch (error) {
    $('#whitelist-status').textContent = error.message; toast(error.message);
  } finally { button.disabled = false; $('#direct-whitelist').disabled = false; }
});
load(true);
