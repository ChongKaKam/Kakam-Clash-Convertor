const REGION_LABELS = { hk: '香港', tw: '台湾', us: '美国', jp: '日本' };
const STATUS = { pending: '等待测试', testing: '测试中', failed: '失败', unmeasured: '未测试' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function badge(region, fallback = '•') {
  if (region && REGION_LABELS[region]) {
    const image = element('img', 'region-icon');
    image.src = `/icons/${region}.png`; image.alt = region.toUpperCase(); image.width = 32; image.height = 32;
    return image;
  }
  return element('span', 'service-icon', fallback);
}
function initials(name) {
  if (name.includes('AI')) return 'AI';
  if (name.includes('智能')) return 'AP';
  if (name.includes('YouTube')) return 'YT';
  if (name.includes('Netflix')) return 'NF';
  if (name.includes('HBO')) return 'HB';
  if (name.includes('Google')) return 'G';
  if (name.includes('邮件')) return '@';
  if (name.includes('iCloud')) return 'iC';
  if (name.includes('苹果')) return 'AP';
  if (name.includes('微软')) return 'MS';
  if (name.includes('国内')) return 'CN';
  if (name.includes('广告')) return 'AD';
  if (name.includes('Disney')) return 'D+';
  if (name.includes('Prime')) return 'PV';
  return '↗';
}
function title(name) { return name.replace(/^[^\p{L}\p{N}]+/u, ''); }

export function mountExplorer(host, item, request) {
  host.innerHTML = `
    <details class="explorer" open>
      <summary>分组与节点 <span class="explorer-caption">查看配置 · HTTP 延迟</span></summary>
      <div class="explorer-body">
        <div class="explorer-toolbar">
          <div class="device-tabs" role="group" aria-label="预览设备"><button type="button" data-device="ios">iOS</button><button type="button" data-device="tvos">tvOS</button><button type="button" data-device="android">Android</button></div>
          <span class="preview-count"></span>
        </div>
        <p class="explorer-error" role="status"></p>
        <div class="region-grid"></div>
        <div class="group-heading"><h4>服务分组</h4><button type="button" class="text-button all-nodes">查看全部节点</button></div>
        <div class="group-grid"></div>
        <div class="group-detail"></div>
        <div class="latency-heading"><div><h4>过滤后的节点</h4><p class="help">服务器 → 代理节点 → 测试网址的 HTTP 延迟，不是带宽或设备端延迟。</p></div><button type="button" class="test-nodes">开始测速</button></div>
        <div class="latency-summary" role="status"></div>
        <progress class="latency-progress" max="1" value="0" aria-label="测速进度"></progress>
        <div class="node-controls"><input type="search" class="node-search" placeholder="搜索节点名称或协议" aria-label="搜索节点"><select class="node-sort" aria-label="节点排序"><option value="region">按地区排列</option><option value="delay">延迟从低到高</option></select></div>
        <div class="node-table-wrap"><table class="node-table"><thead><tr><th>节点 / 地区</th><th>协议</th><th>HTTP 延迟</th><th>测试时间</th></tr></thead><tbody></tbody></table></div>
        <p class="node-footer"></p>
      </div>
    </details>`;
  const $ = (selector) => host.querySelector(selector);
  let device = 'ios', preview = null, selected = null, epoch = 0, timer = null;
  let disposed = false;
  const endpoint = (action, chosen = device) => `/api/subscriptions/${item.id}/${action}?device=${chosen}`;
  const showError = (message = '') => { $('.explorer-error').textContent = message; };
  const isCurrent = (revision) => !disposed && revision === epoch;

  function choose(name) {
    selected = name; renderGroups(); renderNodes();
  }
  function renderGroups() {
    if (!preview) return;
    $('.region-grid').replaceChildren(); $('.group-grid').replaceChildren();
    for (const group of preview.groups) {
      const automatic = group.type === 'url-test';
      const button = element('button', `group-tile${selected === group.name ? ' selected' : ''}`);
      button.type = 'button'; button.setAttribute('aria-pressed', String(selected === group.name));
      button.append(badge(group.region, initials(group.name)));
      const copy = element('span', 'group-copy');
      copy.append(element('strong', '', title(group.name)), element('small', '', automatic ? `${group.members.length} 个节点 · 自动测速` : `${group.ruleCount} 条路由 · ${group.members.length} 个选项`));
      button.append(copy); button.onclick = () => choose(group.name);
      $(automatic ? '.region-grid' : '.group-grid').append(button);
    }
    const detail = $('.group-detail'); detail.replaceChildren();
    const group = preview.groups.find((group) => group.name === selected);
    if (!group) {
      detail.append(element('p', 'help', '点击分组查看可选策略与节点。此处展示生成配置，客户端当前选择可能不同。'));
      return;
    }
    detail.append(element('strong', '', `${title(group.name)} → ${group.type === 'url-test' ? '客户端自动选择低延迟节点' : `配置默认：${group.default}`}`));
    const groupNames = new Set(preview.groups.map((g) => g.name));
    const choices = element('div', 'route-choices');
    for (const member of group.members.filter((name) => groupNames.has(name) || ['DIRECT', 'REJECT'].includes(name))) {
      const pill = element('button', 'route-pill', title(member)); pill.type = 'button';
      if (groupNames.has(member)) pill.onclick = () => choose(member);
      else { pill.disabled = true; pill.title = member === 'DIRECT' ? '本地直连，无需代理节点' : '拒绝连接'; }
      choices.append(pill);
    }
    detail.append(choices);
  }

  function reachableNodes(name, seen = new Set()) {
    if (seen.has(name)) return [];
    seen.add(name);
    const group = preview.groups.find((group) => group.name === name);
    return group ? group.members.flatMap((member) => reachableNodes(member, seen)) : [name];
  }

  function renderNodes() {
    if (!preview) return;
    const job = preview.latency;
    const results = new Map((job.stale ? [] : job.results).map((result) => [result.name, result]));
    const subset = selected ? new Set(reachableNodes(selected)) : null;
    const query = $('.node-search').value.trim().toLowerCase();
    const nodes = preview.nodes.filter((node) => (!subset || subset.has(node.name)) && `${node.name} ${node.type}`.toLowerCase().includes(query));
    const regionKeys = Object.keys(REGION_LABELS);
    nodes.sort((a, b) => $('.node-sort').value === 'delay'
      ? (results.get(a.name)?.delayMs ?? Infinity) - (results.get(b.name)?.delayMs ?? Infinity) || a.name.localeCompare(b.name)
      : regionKeys.indexOf(a.region) - regionKeys.indexOf(b.region) || a.name.localeCompare(b.name));
    const body = $('.node-table tbody'); body.replaceChildren();
    for (const node of nodes) {
      const result = results.get(node.name);
      const row = element('tr');
      const identity = element('td'); const label = element('div', 'node-identity');
      const names = element('div'); names.append(element('strong', '', node.name), element('small', '', REGION_LABELS[node.region] || '其他地区'));
      label.append(badge(node.region), names); identity.append(label);
      const delay = element('td');
      const value = result?.status === 'ok' ? `${result.delayMs} ms` : STATUS[result?.status] || '未测试';
      const indicator = element('span', `delay-badge ${result?.status || 'unmeasured'}`, value);
      if (result?.error) indicator.title = result.error;
      delay.append(indicator);
      const time = result?.checkedAt ? new Date(result.checkedAt).toLocaleTimeString() : '—';
      row.append(identity, element('td', 'protocol', node.type.toUpperCase()), delay, element('td', 'test-time', time));
      body.append(row);
    }
    if (!nodes.length) { const row = element('tr'); const cell = element('td', 'no-nodes', '没有符合筛选条件的节点'); cell.colSpan = 4; row.append(cell); body.append(row); }
    $('.node-footer').textContent = `显示 ${nodes.length} / ${preview.nodes.length} 个过滤后节点${device === 'tvos' ? ' · 已排除 Mieru' : ''} · 测速使用当前设备的全部过滤后节点`;
    const successful = job.results.filter((result) => result.status === 'ok').length;
    const failed = job.results.filter((result) => result.status === 'failed').length;
    let text = job.status === 'idle' ? '尚未测速。点击开始后显示真实结果。' : `${job.status === 'running' ? '正在测速' : '最近一次测试'} ${job.completed}/${job.total} · 成功 ${successful} · 失败 ${failed}`;
    if (job.finishedAt) text += ` · ${new Date(job.finishedAt).toLocaleString()}`;
    if (job.stale) text = '节点配置已更新，旧测速结果已隐藏，请重新测速。';
    if (job.error) text += ` · ${job.error}`;
    if (!job.available) text = '服务器未配置测速内核，暂时无法测速。';
    $('.latency-summary').textContent = text;
    $('.latency-progress').max = job.total || 1; $('.latency-progress').value = job.completed;
    $('.latency-progress').hidden = job.status !== 'running';
    $('.test-nodes').disabled = !job.available || job.status === 'running';
    $('.test-nodes').textContent = job.status === 'running' ? '测速中…' : job.status === 'idle' ? '开始测速' : '重新测速';
  }

  function poll(revision) {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!isCurrent(revision) || !host.isConnected) return;
      try {
        const job = await request(endpoint('latency'));
        if (!isCurrent(revision)) return;
        preview.latency = job; renderNodes();
        if (job.status === 'running') poll(revision);
      } catch (error) { if (isCurrent(revision)) { showError(`读取测速结果失败：${error.message}`); $('.test-nodes').disabled = false; $('.test-nodes').textContent = '重试测速'; } }
    }, 1000);
  }

  async function load() {
    const revision = ++epoch;
    clearTimeout(timer); showError(); preview = null;
    $('.preview-count').textContent = '正在读取配置…';
    $('.test-nodes').disabled = true;
    $('.region-grid').replaceChildren(); $('.group-grid').replaceChildren(); $('.group-detail').replaceChildren();
    $('.node-table tbody').replaceChildren(); $('.latency-summary').textContent = ''; $('.node-footer').textContent = ''; $('.latency-progress').hidden = true;
    for (const button of host.querySelectorAll('[data-device]')) button.setAttribute('aria-pressed', String(button.dataset.device === device));
    try {
      const data = await request(endpoint('preview'));
      if (!isCurrent(revision)) return;
      preview = data;
      if (!preview.groups.some((group) => group.name === selected)) selected = null;
      $('.preview-count').textContent = `${data.groups.length} 个分组 · ${data.nodes.length} 个节点 · ${data.ruleCount} 条路由`;
      renderGroups(); renderNodes();
      if (data.latency.status === 'running') poll(revision);
    } catch (error) { if (isCurrent(revision)) { showError(error.message); $('.preview-count').textContent = '配置暂不可用'; } }
  }

  for (const button of host.querySelectorAll('[data-device]')) button.onclick = () => { device = button.dataset.device; selected = null; load(); };
  $('.all-nodes').onclick = () => choose(null);
  $('.node-search').oninput = renderNodes; $('.node-sort').onchange = renderNodes;
  $('.test-nodes').onclick = async () => {
    const revision = epoch;
    showError(); $('.test-nodes').disabled = true;
    try {
      const job = await request(endpoint('latency'), { method: 'POST' });
      if (!isCurrent(revision)) return;
      preview.latency = job; renderNodes();
      if (job.status === 'running') poll(revision);
    } catch (error) { if (isCurrent(revision)) { showError(error.message); renderNodes(); } }
  };
  load();
  return () => { disposed = true; clearTimeout(timer); };
}
