(function (root) {
  'use strict';
  const tiers = {
    county: { key: 'counties', prefix: 'c', name: '伯爵领', memberView: 'province' },
    duchy: { key: 'duchies', prefix: 'd', name: '公爵领', memberView: 'county' },
    kingdom: { key: 'kingdoms', prefix: 'k', name: '王国', memberView: 'duchy' }
  };
  const holdingTypes = { castle: '城堡', city: '城市', temple: '神殿', tribal: '部落' };
  const empty = () => ({ counties: [], duchies: [], kingdoms: [], ignored: [], holdings: {}, straits: [] });
  function upgrade(state, version) {
    if (![1, 2, 3, 4].includes(version)) throw Error('不支持的工程版本');
    const next = structuredClone(state);
    if (version === 1 && next && next.kingdoms === undefined) next.kingdoms = [];
    if (version < 3 && next && next.holdings === undefined) next.holdings = {};
    if (version < 4 && next && next.straits === undefined) next.straits = [];
    return next;
  }
  function validate(state, provinces) {
    if (!state || Object.values(tiers).some(t => !Array.isArray(state[t.key])) || !Array.isArray(state.ignored)) throw Error('工程结构不完整');
    const ids = new Set();
    const ignored = new Set(state.ignored);
    if (ignored.size !== state.ignored.length || state.ignored.some(id => !provinces.has(id))) throw Error('忽略地块数据无效');
    if (!state.holdings || typeof state.holdings !== 'object' || Array.isArray(state.holdings)) throw Error('地产数据无效');
    for (const [id, type] of Object.entries(state.holdings)) {
      if (!provinces.has(id) || ignored.has(id) || !Object.hasOwn(holdingTypes, type)) throw Error('地产类型或所属男爵领无效（已忽略地块不能设置地产）');
    }
    if (!Array.isArray(state.straits)) throw Error('海峡连接数据无效');
    const pairs = new Set();
    for (const link of state.straits) {
      if (!link || !provinces.has(link.from) || !provinces.has(link.to) || link.from === link.to || ignored.has(link.from) || ignored.has(link.to)) throw Error('海峡连接需要两个不同且未被忽略的男爵领');
      const key = straitKey(link.from, link.to);
      if (pairs.has(key)) throw Error('这两个男爵领已有海峡连接');
      pairs.add(key);
    }
    let allowed = new Set([...provinces].filter(id => !ignored.has(id)));
    for (const tier of Object.values(tiers)) {
      const groups = state[tier.key], assigned = new Set(), groupIds = new Set();
      for (const g of groups) {
        if (!g || typeof g.id !== 'string' || ids.has(g.id) || typeof g.name !== 'string' || !g.name.trim() || !/^#[0-9a-f]{6}$/i.test(g.color)) throw Error('领地编号、名称或颜色无效');
        ids.add(g.id);
        if (!Array.isArray(g.members) || !g.members.length || new Set(g.members).size !== g.members.length || !g.members.includes(g.capital)) throw Error('领地成员或首府无效');
        for (const id of g.members) {
          if (!allowed.has(id) || assigned.has(id)) throw Error('成员不存在、被忽略或被重复分组');
          assigned.add(id);
        }
        groupIds.add(g.id);
      }
      allowed = groupIds;
    }
    return state;
  }
  function add(state, kind, members, provinces) {
    const tier = tiers[kind];
    if (!tier) throw Error('未知领地级别');
    const next = structuredClone(state), groups = next[tier.key];
    const prefix = tier.prefix;
    let n = 1;
    while (groups.some(g => g.id === `${prefix}_${String(n).padStart(4, '0')}`)) n++;
    const hue = (n * 137.508 + Object.keys(tiers).indexOf(kind) * 43) % 360;
    const color = hsl(hue, 0.55, 0.52);
    const group = { id: `${prefix}_${String(n).padStart(4, '0')}`, name: `${tier.name} ${n}`, color, members: [...members], capital: members[0] };
    groups.push(group);
    validate(next, provinces);
    return { state: next, id: group.id };
  }
  function remove(state, kind, id) {
    if (!tiers[kind]) throw Error('未知领地级别');
    const next = structuredClone(state);
    next[tiers[kind].key] = next[tiers[kind].key].filter(g => g.id !== id);
    let removed = new Set([id]);
    for (const tier of Object.values(tiers).slice(Object.keys(tiers).indexOf(kind) + 1)) {
      const emptyGroups = new Set();
      next[tier.key] = next[tier.key].filter(g => {
        g.members = g.members.filter(m => !removed.has(m));
        if (!g.members.length) { emptyGroups.add(g.id); return false; }
        if (!g.members.includes(g.capital)) g.capital = g.members[0];
        return true;
      });
      removed = emptyGroups;
    }
    return next;
  }
  function hsl(h, s, l) {
    const a = s * Math.min(l, 1-l);
    return '#' + [0,8,4].map(n => { const k=(n+h/30)%12; return Math.round(255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)))).toString(16).padStart(2,'0'); }).join('');
  }
  function setHolding(state, id, type, provinces) {
    if (!provinces.has(id) || state.ignored.includes(id)) throw Error('请选择一个未被忽略的男爵领');
    if (type !== '' && !Object.hasOwn(holdingTypes, type)) throw Error('未知地产类型');
    const next = structuredClone(state);
    if (type === '') delete next.holdings[id];
    else next.holdings[id] = type;
    return validate(next, provinces);
  }
  function straitKey(from, to) { return JSON.stringify([from, to].sort()); }
  function addStrait(state, from, to, provinces) {
    const next = structuredClone(state);
    next.straits.push({ from, to });
    return validate(next, provinces);
  }
  function removeStrait(state, from, to, provinces) {
    const next = structuredClone(state), key = straitKey(from, to);
    next.straits = next.straits.filter(link => straitKey(link.from, link.to) !== key);
    return validate(next, provinces);
  }
  const api = { empty, validate, add, remove, upgrade, tiers, holdingTypes, setHolding, straitKey, addStrait, removeStrait };
  if (typeof module !== 'undefined') module.exports = api;
  else root.TerritoryCore = api;
})(globalThis);
