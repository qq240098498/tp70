// 页面交互：语言清单与文案清单都从服务端拉取，任何一步失败都把说明显示在顶部并标到对应输入项上

const state = {
  languages: [],
  entries: [],
  modules: [],
  fallback: { order: [], detached: [], entries: [] },
  editingId: '',
};

const el = (id) => document.getElementById(id);

// 统一的请求入口：出错时把服务端给的错误码、说明与出错位置一起抛出去
async function request(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let payload = null;
  try {
    payload = await res.json();
  } catch (err) {
    payload = null;
  }
  if (!res.ok) {
    const error = (payload && payload.error) || {};
    const failure = new Error(error.message || `请求失败（状态码 ${res.status}）`);
    failure.code = error.code || '';
    failure.field = error.field || '';
    throw failure;
  }
  return payload;
}

function notify(message, kind) {
  const box = el('notice');
  box.textContent = message;
  box.className = `notice ${kind === 'ok' ? 'ok' : 'error'}`;
}

function clearNotice() {
  const box = el('notice');
  box.className = 'notice hidden';
  box.textContent = '';
}

function clearFieldMarks() {
  document.querySelectorAll('.invalid').forEach((node) => node.classList.remove('invalid'));
}

// 把出错位置标到具体输入项上：语言区与文案区共用一套标记
function markField(field) {
  if (!field) return;
  const target = document.querySelector(`[data-field="${field}"]`);
  if (!target) return;
  target.classList.add('invalid');
  const input = target.tagName === 'INPUT' || target.tagName === 'SELECT' ? target : target.querySelector('input, select');
  if (input) input.focus();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (num) => String(num).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// 操作者名字记在浏览器里，刷新之后还在，保存时随请求一起带上
const OPERATOR_KEY = 'i18n-workbench-operator';

function currentOperator() {
  return el('operator').value.trim();
}

function restoreOperator() {
  const saved = window.localStorage.getItem(OPERATOR_KEY) || '';
  el('operator').value = saved;
}

async function loadHealth() {
  try {
    await request('/api/health');
    el('health').textContent = '服务正常';
    el('health').className = 'health ok';
  } catch (err) {
    el('health').textContent = '服务连不上';
    el('health').className = 'health bad';
  }
}

async function loadLanguages() {
  const payload = await request('/api/languages');
  state.languages = payload.languages || [];
  renderLanguages();
  renderTranslationInputs();
}

async function loadEntries() {
  const params = new URLSearchParams();
  const module = el('filter-module').value;
  const keyword = el('filter-keyword').value.trim();
  if (module) params.set('module', module);
  if (keyword) params.set('keyword', keyword);
  const query = params.toString();
  const payload = await request(`/api/entries${query ? `?${query}` : ''}`);
  state.entries = payload.entries || [];
  state.modules = payload.modules || [];
  renderModules();
  renderEntries();
}

// 取值顺序与生效预览是同一份接口结果：顺序清单、摘下清单、每条文案最终取到的文本
async function loadFallback() {
  const payload = await request('/api/fallback-preview');
  state.fallback = {
    order: payload.order || [],
    detached: payload.detached || [],
    entries: payload.entries || [],
  };
  renderFallback();
}

function fallbackTags(item) {
  const tags = [];
  if (item.isDefault) tags.push('<span class="tag on">默认</span>');
  if (!item.enabled) tags.push('<span class="tag off">已停用</span>');
  return tags.join('');
}

// 一行语言：位置序号、名称代码、状态标签与上移/下移/摘下操作。
// 默认语言也给出摘下入口，点击时当场拒绝并说明原因，服务端同样会再拦一次
function fallbackRow(item, index, total) {
  const code = escapeHtml(item.code);
  const actions = [];
  if (index > 0) actions.push(`<button type="button" class="link" data-fallback-up="${code}">上移</button>`);
  if (index < total - 1) actions.push(`<button type="button" class="link" data-fallback-down="${code}">下移</button>`);
  actions.push(`<button type="button" class="link danger" data-fallback-detach="${code}">摘下</button>`);
  return `<li class="fallback-item${item.enabled ? '' : ' muted'}" data-fallback-code="${code}">
    <span class="fallback-index">${index + 1}</span>
    <span class="fallback-name">
      <span class="fallback-lang">${escapeHtml(item.name)}</span>
      <span class="mono fallback-code">${code}</span>
      ${fallbackTags(item)}
    </span>
    <span class="actions">${actions.join('')}</span>
  </li>`;
}

function renderFallback() {
  const { order, detached, entries } = state.fallback;

  const orderBody = el('fallback-order-list');
  orderBody.innerHTML = order.map((item, index) => fallbackRow(item, index, order.length)).join('');

  const detachedBody = el('fallback-detached-list');
  detachedBody.innerHTML = detached.map((item) => {
    const code = escapeHtml(item.code);
    return `<li class="fallback-item detached-item${item.enabled ? '' : ' muted'}">
      <span class="fallback-index">—</span>
      <span class="fallback-name">
        <span class="fallback-lang">${escapeHtml(item.name)}</span>
        <span class="mono fallback-code">${code}</span>
        ${fallbackTags(item)}
      </span>
      <span class="actions"><button type="button" class="link" data-fallback-attach="${code}">放回顺序末尾</button></span>
    </li>`;
  }).join('');
  el('fallback-detached-empty').classList.toggle('hidden', detached.length > 0);

  const previewBody = el('fallback-preview-body');
  previewBody.innerHTML = entries.map((item) => {
    let taken;
    if (item.effective) {
      const tags = [];
      if (item.effective.isDefault) tags.push('<span class="tag on">默认</span>');
      if (!item.effective.enabled) tags.push('<span class="tag off">已停用</span>');
      taken = `<span class="taken-by">${escapeHtml(item.effective.name)} <span class="mono">${escapeHtml(item.effective.code)}</span> ${tags.join('')}</span>`;
    } else {
      taken = '<span class="missing">顺序上的语言都还没填</span>';
    }
    const valueCell = item.effective
      ? `<span class="effective-value" title="${escapeHtml(item.effective.value)}">${escapeHtml(item.effective.value)}</span>`
      : '<span class="missing">无可用译文</span>';
    return `<tr>
      <td class="mono">${escapeHtml(item.module)}</td>
      <td class="mono">${escapeHtml(item.key)}</td>
      <td>${taken}</td>
      <td class="effective-cell">${valueCell}</td>
    </tr>`;
  }).join('');
  el('fallback-preview-empty').classList.toggle('hidden', entries.length > 0);
}

function renderModules() {
  const select = el('filter-module');
  const current = select.value;
  const rows = ['<option value="">全部模块</option>']
    .concat(state.modules.map((item) => `<option value="${escapeHtml(item.module)}">${escapeHtml(item.module)}（${item.count}）</option>`));
  select.innerHTML = rows.join('');
  if (state.modules.some((item) => item.module === current)) select.value = current;
}

function renderLanguages() {
  const body = el('language-body');
  const rows = state.languages.map((item) => {
    const defaultTag = item.isDefault ? '<span class="tag on">默认</span>' : '';
    const enabledTag = item.enabled ? '<span class="tag on">已启用</span>' : '<span class="tag off">已停用</span>';
    const actions = [
      `<button type="button" class="link" data-language-default="${escapeHtml(item.code)}"${item.isDefault ? ' disabled' : ''}>设为默认</button>`,
      `<button type="button" class="link" data-language-toggle="${escapeHtml(item.code)}">${item.enabled ? '停用' : '启用'}</button>`,
      `<button type="button" class="link" data-language-rename="${escapeHtml(item.code)}">改名</button>`,
      `<button type="button" class="link danger" data-language-delete="${escapeHtml(item.code)}">删除</button>`,
    ];
    return `<tr${item.enabled ? '' : ' class="muted"'}>
      <td class="mono">${escapeHtml(item.code)}</td>
      <td>${escapeHtml(item.name)}</td>
      <td>${defaultTag}</td>
      <td>${enabledTag}</td>
      <td>${item.filled} 条</td>
      <td class="actions">${actions.join('')}</td>
    </tr>`;
  });
  body.innerHTML = rows.join('');
  el('language-empty').classList.toggle('hidden', state.languages.length > 0);
}

// 新建文案的表单按当前登记的语言逐条生成译文输入框，停用的语言照样可以查看与补填
function renderTranslationInputs(values) {
  const box = el('entry-translations');
  const current = values || collectTranslations();
  box.innerHTML = state.languages.map((item) => {
    const value = current[item.code] === undefined ? '' : current[item.code];
    const suffix = item.enabled ? '' : '<span class="tag off">已停用</span>';
    return `<label class="translation" data-field="translations.${escapeHtml(item.code)}">
      <span>${escapeHtml(item.code)} ${suffix}</span>
      <input class="translation-input" data-code="${escapeHtml(item.code)}" maxlength="200" value="${escapeHtml(value)}">
    </label>`;
  }).join('');
}

function collectTranslations() {
  const result = {};
  document.querySelectorAll('.translation-input').forEach((input) => {
    result[input.dataset.code] = input.value;
  });
  return result;
}

function renderEntries() {
  const head = el('entry-head-row');
  head.innerHTML = ['模块', '文案键']
    .concat(state.languages.map((item) => item.code))
    .concat(['备注', '最近改动人', '更新时间', '操作'])
    .map((text) => `<th>${escapeHtml(text)}</th>`)
    .join('');

  const body = el('entry-body');
  body.innerHTML = state.entries.map((item) => {
    const cells = state.languages.map((language) => {
      const value = item.translations[language.code];
      if (value === undefined) return '<td class="missing">未登记</td>';
      if (!value.trim()) return '<td class="missing">待翻译</td>';
      return `<td title="${escapeHtml(value)}">${escapeHtml(value)}</td>`;
    });
    return `<tr>
      <td class="mono">${escapeHtml(item.module)}</td>
      <td class="mono">${escapeHtml(item.key)}</td>
      ${cells.join('')}
      <td class="note-cell">${escapeHtml(item.note)}</td>
      <td>${escapeHtml(item.updatedBy)}</td>
      <td class="mono">${escapeHtml(formatTime(item.updatedAt))}</td>
      <td class="actions">
        <button type="button" class="link" data-entry-edit="${escapeHtml(item.id)}">编辑</button>
        <button type="button" class="link danger" data-entry-delete="${escapeHtml(item.id)}">删除</button>
      </td>
    </tr>`;
  }).join('');
  el('entry-empty').classList.toggle('hidden', state.entries.length > 0);
}

function openEntryForm(entry) {
  state.editingId = entry ? entry.id : '';
  el('entry-form-title').textContent = entry ? `编辑文案：${entry.key}` : '新建文案';
  el('entry-module').value = entry ? entry.module : '';
  el('entry-key').value = entry ? entry.key : '';
  el('entry-note').value = entry ? entry.note : '';
  el('entry-translations').innerHTML = '';
  renderTranslationInputs(entry ? entry.translations : {});
  el('entry-form').classList.remove('hidden');
  el('entry-module').focus();
}

function closeEntryForm() {
  state.editingId = '';
  el('entry-form').classList.add('hidden');
  clearFieldMarks();
}

async function submitLanguage(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    code: el('language-code').value,
    name: el('language-name').value,
    enabled: el('language-enabled').checked,
    isDefault: el('language-default').checked,
  };
  try {
    await request('/api/languages', { method: 'POST', body: JSON.stringify(payload) });
    el('language-code').value = '';
    el('language-name').value = '';
    el('language-default').checked = false;
    notify('语言已新增', 'ok');
    await loadLanguages();
    await loadEntries();
    await loadFallback();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

async function submitEntry(event) {
  event.preventDefault();
  clearNotice();
  clearFieldMarks();
  const payload = {
    module: el('entry-module').value,
    key: el('entry-key').value,
    note: el('entry-note').value,
    operator: currentOperator(),
    translations: collectTranslations(),
  };
  const editing = state.editingId;
  try {
    if (editing) {
      await request(`/api/entries/${encodeURIComponent(editing)}`, { method: 'PATCH', body: JSON.stringify(payload) });
      notify('文案已保存', 'ok');
    } else {
      await request('/api/entries', { method: 'POST', body: JSON.stringify(payload) });
      notify('文案已新增', 'ok');
    }
    closeEntryForm();
    await loadEntries();
    await loadLanguages();
    await loadFallback();
  } catch (err) {
    notify(err.message, 'error');
    markField(err.field);
  }
}

// 语言与文案列表上的操作用事件委托统一处理，列表重绘之后不需要重新绑定
document.addEventListener('click', async (event) => {
  const node = event.target.closest('button');
  if (!node) return;

  const code = node.dataset.languageDefault || node.dataset.languageToggle
    || node.dataset.languageRename || node.dataset.languageDelete;
  if (code) {
    clearNotice();
    try {
      if (node.dataset.languageDefault) {
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) });
        notify(`${code} 已设为默认语言`, 'ok');
      } else if (node.dataset.languageToggle) {
        const target = state.languages.find((item) => item.code === code);
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ enabled: !target.enabled }) });
        notify(`${code} 已${target.enabled ? '停用' : '启用'}`, 'ok');
      } else if (node.dataset.languageRename) {
        const target = state.languages.find((item) => item.code === code);
        const next = window.prompt(`把 ${code} 的名称改成`, target ? target.name : '');
        if (next === null) return;
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'PATCH', body: JSON.stringify({ name: next }) });
        notify(`${code} 的名称已更新`, 'ok');
      } else {
        if (!window.confirm(`确定删除语言 ${code} 吗？`)) return;
        await request(`/api/languages/${encodeURIComponent(code)}`, { method: 'DELETE' });
        notify(`${code} 已删除`, 'ok');
      }
      await loadLanguages();
      await loadEntries();
      await loadFallback();
    } catch (err) {
      notify(err.message, 'error');
    }
    return;
  }

  if (node.dataset.entryEdit) {
    clearNotice();
    const found = state.entries.find((item) => item.id === node.dataset.entryEdit);
    if (found) openEntryForm(found);
    return;
  }

  if (node.dataset.entryDelete) {
    clearNotice();
    const found = state.entries.find((item) => item.id === node.dataset.entryDelete);
    if (!window.confirm(`确定删除文案 ${found ? found.key : ''} 吗？`)) return;
    try {
      await request(`/api/entries/${encodeURIComponent(node.dataset.entryDelete)}`, { method: 'DELETE' });
      if (state.editingId === node.dataset.entryDelete) closeEntryForm();
      notify('文案已删除', 'ok');
      await loadEntries();
      await loadLanguages();
      await loadFallback();
    } catch (err) {
      notify(err.message, 'error');
    }
  }
});

el('language-form').addEventListener('submit', submitLanguage);
el('entry-form').addEventListener('submit', submitEntry);

// 上移、下移、摘下、放回都是在前端拼好新顺序后整段提交，服务端负责兜底校验
function currentOrderCodes() {
  return state.fallback.order.map((item) => item.code);
}

async function saveFallbackOrder(codes, successMessage) {
  clearNotice();
  try {
    await request('/api/fallback-order', { method: 'PATCH', body: JSON.stringify({ order: codes }) });
    notify(successMessage, 'ok');
    await loadFallback();
  } catch (err) {
    notify(err.message, 'error');
  }
}

document.addEventListener('click', (event) => {
  const node = event.target.closest('button');
  if (!node) return;
  const data = node.dataset;
  const codes = currentOrderCodes();

  if (data.fallbackUp) {
    const code = data.fallbackUp;
    const index = codes.indexOf(code);
    if (index <= 0) return;
    [codes[index - 1], codes[index]] = [codes[index], codes[index - 1]];
    saveFallbackOrder(codes, `已把 ${code} 上移一位`);
  } else if (data.fallbackDown) {
    const code = data.fallbackDown;
    const index = codes.indexOf(code);
    if (index === -1 || index === codes.length - 1) return;
    [codes[index + 1], codes[index]] = [codes[index], codes[index + 1]];
    saveFallbackOrder(codes, `已把 ${code} 下移一位`);
  } else if (data.fallbackDetach) {
    const code = data.fallbackDetach;
    const target = state.fallback.order.find((item) => item.code === code);
    // 正常情况下默认语言这一行不渲染摘下按钮，这里再当面拦一次并说明原因
    if (target && target.isDefault) {
      notify(`${code} 是默认语言，默认语言必须始终留在取值顺序上，不能摘下`, 'error');
      return;
    }
    saveFallbackOrder(codes.filter((item) => item !== code), `已把 ${code} 从取值顺序上摘下`);
  } else if (data.fallbackAttach) {
    const code = data.fallbackAttach;
    saveFallbackOrder(codes.concat(code), `已把 ${code} 放回取值顺序末尾`);
  }
});
el('entry-new').addEventListener('click', () => {
  clearNotice();
  openEntryForm(null);
});
el('entry-cancel').addEventListener('click', closeEntryForm);
el('filter-apply').addEventListener('click', () => {
  clearNotice();
  loadEntries().catch((err) => notify(err.message, 'error'));
});
el('filter-reset').addEventListener('click', () => {
  el('filter-module').value = '';
  el('filter-keyword').value = '';
  loadEntries().catch((err) => notify(err.message, 'error'));
});
el('entry-refresh').addEventListener('click', () => {
  clearNotice();
  loadLanguages()
    .then(loadEntries)
    .then(loadFallback)
    .catch((err) => notify(err.message, 'error'));
});
el('filter-module').addEventListener('change', () => {
  loadEntries().catch((err) => notify(err.message, 'error'));
});
el('operator').addEventListener('change', () => {
  window.localStorage.setItem(OPERATOR_KEY, currentOperator());
});

// 页面打开时先把语言与文案拉一遍，语言决定文案表格里有哪些列，最后再算取值顺序与生效预览
restoreOperator();
loadHealth();
loadLanguages()
  .then(loadEntries)
  .then(loadFallback)
  .catch((err) => notify(err.message, 'error'));
