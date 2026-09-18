const { load, save } = require('./store');
const { ApiError, pickText, pickFlag } = require('./errors');

// 语言代码按 zh-CN、en-US 这样的写法登记：小写字母起头，短横线之后跟地区或变体
const CODE_PATTERN = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const MAX_NAME_LENGTH = 40;

// 统计每种语言已经填了译文的条数，空字符串算没有填
function countFilled(entries) {
  const counts = {};
  entries.forEach((item) => {
    Object.keys(item.translations).forEach((code) => {
      const value = item.translations[code];
      if (typeof value === 'string' && value.trim()) {
        counts[code] = (counts[code] || 0) + 1;
      }
    });
  });
  return counts;
}

function listLanguages() {
  const data = load();
  const counts = countFilled(data.entries);
  return data.languages.map((item) => ({ ...item, filled: counts[item.code] || 0 }));
}

// 只对外暴露语言上的固定字段，顺序里与已摘下的两栏都用同一份精简结构
function toOrderItem(item) {
  return { code: item.code, name: item.name, enabled: item.enabled, isDefault: item.isDefault };
}

// 取值顺序：在顺序上的语言按先后返回，已登记但被摘下的语言放到 detached 里
function getFallbackOrder() {
  const data = load();
  const byCode = new Map(data.languages.map((item) => [item.code, item]));
  const ordered = data.fallbackOrder
    .map((code) => byCode.get(code))
    .filter(Boolean)
    .map(toOrderItem);
  const orderedCodes = new Set(ordered.map((item) => item.code));
  const detached = data.languages
    .filter((item) => !orderedCodes.has(item.code))
    .map(toOrderItem);
  return { order: ordered, detached };
}

// 整段替换取值顺序：每一种都必须登记过、不能重复，默认语言必须始终留在顺序上
function updateFallbackOrder(payload) {
  const data = load();
  const rawCodes = payload && payload.order;
  if (!Array.isArray(rawCodes)) {
    throw new ApiError(400, 'FALLBACK_ORDER_REQUIRED', '请按顺序给出语言代码列表', 'order');
  }

  const byLower = new Map(data.languages.map((item) => [item.code.toLowerCase(), item]));
  const next = [];
  const seen = new Set();
  rawCodes.forEach((value, index) => {
    const code = pickText(value);
    if (!code) {
      throw new ApiError(400, 'FALLBACK_CODE_REQUIRED', `取值顺序第 ${index + 1} 项缺少语言代码`, 'order');
    }
    const found = byLower.get(code.toLowerCase());
    if (!found) {
      throw new ApiError(400, 'FALLBACK_LANGUAGE_UNKNOWN', `语言 ${code} 没有登记过，不能放进取值顺序`, 'order');
    }
    if (seen.has(found.code.toLowerCase())) {
      throw new ApiError(400, 'FALLBACK_DUPLICATED', `语言 ${found.code} 在取值顺序里出现了两次，同一种语言只能排一次`, 'order');
    }
    seen.add(found.code.toLowerCase());
    next.push(found.code);
  });

  const defaultLang = data.languages.find((item) => item.isDefault);
  if (defaultLang && !seen.has(defaultLang.code.toLowerCase())) {
    throw new ApiError(409, 'FALLBACK_DEFAULT_REQUIRED', `${defaultLang.code} 是默认语言，默认语言必须始终留在取值顺序上，不能摘下`, 'order');
  }

  data.fallbackOrder = next;
  save(data);
  return getFallbackOrder();
}

// 按代码找到语言，允许大小写不一致的写法，找不到时给出明确结论
function findLanguage(data, code) {
  const value = pickText(code);
  if (!value) throw new ApiError(400, 'CODE_REQUIRED', '请选择语言', 'code');
  const found = data.languages.find((item) => item.code === value)
    || data.languages.find((item) => item.code.toLowerCase() === value.toLowerCase());
  if (!found) throw new ApiError(404, 'LANGUAGE_NOT_FOUND', `语言 ${value} 没有登记过`, 'code');
  return found;
}

function validateCode(value, data, selfCode) {
  const code = pickText(value);
  if (!code) throw new ApiError(400, 'CODE_REQUIRED', '请填写语言代码', 'code');
  if (!CODE_PATTERN.test(code)) {
    throw new ApiError(400, 'CODE_INVALID', '语言代码需要写成 zh-CN 这样的形式，小写字母起头，可以带短横线与地区代码', 'code');
  }
  const hit = data.languages.find((item) => item.code.toLowerCase() === code.toLowerCase() && item.code !== selfCode);
  if (hit) throw new ApiError(409, 'CODE_DUPLICATED', `语言代码 ${code} 已经登记过了`, 'code');
  return code;
}

function validateName(value) {
  const name = pickText(value);
  if (!name) throw new ApiError(400, 'NAME_REQUIRED', '请填写语言名称', 'name');
  if (name.length > MAX_NAME_LENGTH) {
    throw new ApiError(400, 'NAME_TOO_LONG', `语言名称不能超过 ${MAX_NAME_LENGTH} 个字符`, 'name');
  }
  return name;
}

// 把其它语言的默认标记清掉，保证任何时刻只有一种默认语言
function clearOtherDefaults(languages, keepCode) {
  languages.forEach((item) => {
    item.isDefault = item.code === keepCode;
  });
}

function createLanguage(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const code = validateCode(input.code, data, '');
  const name = validateName(input.name);
  const isFirst = data.languages.length === 0;
  const enabled = isFirst ? true : pickFlag(input.enabled, true);
  const isDefault = isFirst ? true : pickFlag(input.isDefault, false);

  if (isDefault && !enabled) {
    throw new ApiError(400, 'DEFAULT_MUST_ENABLED', '默认语言必须处于启用状态，请先勾选启用再设为默认', 'enabled');
  }

  const created = { code, name, enabled, isDefault, createdAt: new Date().toISOString() };
  data.languages.push(created);
  if (isDefault) clearOtherDefaults(data.languages, code);
  // 新登记的语言先排到顺序末尾，不会立刻盖过已有语言，需要优先时再手动前移
  data.fallbackOrder = data.fallbackOrder.concat(code);
  save(data);
  return created;
}

function updateLanguage(code, payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const found = findLanguage(data, code);

  const nextEnabled = input.enabled === undefined ? found.enabled : pickFlag(input.enabled, found.enabled);
  const nextIsDefault = input.isDefault === undefined ? found.isDefault : pickFlag(input.isDefault, found.isDefault);
  const nextName = input.name === undefined ? found.name : validateName(input.name);

  if (found.isDefault && !nextIsDefault) {
    throw new ApiError(409, 'DEFAULT_REQUIRED', '默认语言不能直接取消，请先把另一种语言设为默认', 'isDefault');
  }
  if (nextIsDefault && !nextEnabled) {
    throw new ApiError(400, 'DEFAULT_MUST_ENABLED', '默认语言必须处于启用状态，请先勾选启用再设为默认', 'enabled');
  }

  found.name = nextName;
  found.enabled = nextEnabled;
  found.isDefault = nextIsDefault;
  if (nextIsDefault) {
    clearOtherDefaults(data.languages, found.code);
    // 被摘下的语言一旦成为默认语言就得回到顺序上，排在末尾充当最后兜底，不抢占已有优先级
    if (!data.fallbackOrder.some((code) => code.toLowerCase() === found.code.toLowerCase())) {
      data.fallbackOrder = data.fallbackOrder.concat(found.code);
    }
  }
  save(data);
  return found;
}

function deleteLanguage(code) {
  const data = load();
  const found = findLanguage(data, code);
  if (found.isDefault) {
    throw new ApiError(409, 'DEFAULT_UNDELETABLE', '默认语言不能删除，请先把另一种语言设为默认', 'code');
  }

  // 已经填过译文时不允许直接删除，先把引用清干净再删
  const used = data.entries.filter((item) => {
    const value = item.translations[found.code];
    return typeof value === 'string' && value.trim();
  });
  if (used.length) {
    const samples = used.slice(0, 3).map((item) => item.key).join('、');
    throw new ApiError(409, 'LANGUAGE_IN_USE', `还有 ${used.length} 条文案填了这种语言的译文，例如 ${samples}，请先清空这些译文再删除`, 'code');
  }

  data.languages = data.languages.filter((item) => item.code !== found.code);
  // 语言删除后顺手从取值顺序上摘掉，默认语言不允许删除，所以不会动到顺序上的保底项
  data.fallbackOrder = data.fallbackOrder.filter((code) => code !== found.code);
  data.entries = data.entries.map((item) => {
    if (!Object.prototype.hasOwnProperty.call(item.translations, found.code)) return item;
    const kept = { ...item.translations };
    delete kept[found.code];
    return { ...item, translations: kept };
  });
  save(data);
  return { code: found.code, name: found.name };
}

module.exports = {
  listLanguages,
  getFallbackOrder,
  updateFallbackOrder,
  findLanguage,
  createLanguage,
  updateLanguage,
  deleteLanguage,
};
