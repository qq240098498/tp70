const { load, save } = require('./store');
const { ApiError } = require('./errors');

// 取用顺序：active 从前到后优先取用第一份非空译文，inactive 里的语言临时不参与取用。
// 顺序只决定“用哪一份译文”，不影响语言区里语言本身的展示先后。

// 校验一段顺序列表：必须是数组、每项都是已登记语言、同一段里不允许重复，返回规范化后的代码
function validateOrderPart(value, known, label) {
  if (!Array.isArray(value)) {
    throw new ApiError(400, 'FALLBACK_INVALID', `${label}需要按语言逐条排列成一份顺序`, 'order');
  }
  const result = [];
  const seen = new Set();
  value.forEach((item) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new ApiError(400, 'FALLBACK_INVALID', `${label}里每一项都需要是语言代码`, 'order');
    }
    const code = item.trim();
    const actual = known.get(code.toLowerCase());
    if (!actual) {
      throw new ApiError(400, 'FALLBACK_LANGUAGE_UNKNOWN', `语言 ${code} 还没有登记，不能排进取用顺序`, 'order');
    }
    if (seen.has(actual.toLowerCase())) {
      throw new ApiError(400, 'FALLBACK_DUPLICATED', `同一种语言不能在同一份顺序里出现两次：${actual}`, 'order');
    }
    seen.add(actual.toLowerCase());
    result.push(actual);
  });
  return result;
}

function listFallbackOrder() {
  const data = load();
  const defaultLanguage = data.languages.find((item) => item.isDefault);
  return {
    active: data.fallbackOrder.active,
    inactive: data.fallbackOrder.inactive,
    defaultCode: defaultLanguage ? defaultLanguage.code : '',
  };
}

// 整体替换取用顺序。摘下与放回都走这里，页面每次把两份完整顺序一起提交
function updateFallbackOrder(payload) {
  const input = payload && typeof payload === 'object' ? payload : {};
  const data = load();
  const known = new Map(data.languages.map((item) => [item.code.toLowerCase(), item.code]));
  const defaultLanguage = data.languages.find((item) => item.isDefault);
  const defaultCode = defaultLanguage ? defaultLanguage.code : '';

  const active = validateOrderPart(input.active, known, '取用顺序');
  const inactive = validateOrderPart(input.inactive, known, '已摘下的语言');

  const overlap = active.find((code) => inactive.some((item) => item.toLowerCase() === code.toLowerCase()));
  if (overlap) {
    throw new ApiError(400, 'FALLBACK_DUPLICATED', `同一种语言不能在同一份顺序里出现两次：${overlap}`, 'order');
  }

  const placed = new Set(active.concat(inactive).map((code) => code.toLowerCase()));
  const missing = data.languages
    .map((item) => item.code)
    .filter((code) => !placed.has(code.toLowerCase()));
  if (missing.length) {
    throw new ApiError(400, 'FALLBACK_INCOMPLETE', `还有语言没有排进顺序也没有摘下：${missing.join('、')}`, 'order');
  }

  // 默认语言是所有译文都缺失时的最后兜底，必须始终留在顺序上，摘下当场拒绝
  if (defaultCode && !active.some((code) => code.toLowerCase() === defaultCode.toLowerCase())) {
    throw new ApiError(
      409,
      'DEFAULT_MUST_REMAIN',
      `默认语言 ${defaultCode} 必须始终留在取用顺序上，不能摘下；它是所有译文都缺失时的兜底，请先把另一种语言设为默认再调整`,
      'order',
    );
  }

  data.fallbackOrder = { active, inactive };
  save(data);
  return { active, inactive, defaultCode };
}

// 按取用顺序解析一条文案最终会用上哪一份译文：顺序上第一份非空文本胜出，都没有则返回 null
function resolveTranslation(translations, activeOrder) {
  for (const code of activeOrder) {
    const value = translations && Object.prototype.hasOwnProperty.call(translations, code)
      ? translations[code]
      : undefined;
    if (typeof value === 'string' && value.trim()) {
      return { code, text: value };
    }
  }
  return null;
}

module.exports = {
  listFallbackOrder,
  updateFallbackOrder,
  resolveTranslation,
};
