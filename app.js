'use strict';
const $ = id => document.getElementById(id), core = TerritoryCore;
const canvas = $('map'), ctx = canvas.getContext('2d', { alpha: false });
let state = core.empty(), provinces = [], provinceIds = new Set(), indexById = new Map(), labels;
let width = 0, height = 0, pngData = '', fileName = '', view = 'province', selection = new Set(), focus = null;
let scale = 1, panX = 0, panY = 0, history = [], dirty = false, busy = false, frame = 0, pointer = null;
let countyOwner = new Map(), duchyOwner = new Map(), kingdomOwner = new Map(), countyById = new Map(), duchyById = new Map(), kingdomById = new Map();
const tier = kind => core.tiers[kind];
const byId = kind => ({ county: countyById, duchy: duchyById, kingdom: kingdomById })[kind];
const ownerForView = () => ({ province: countyOwner, holding: new Map(), strait: new Map(), county: duchyOwner, duchy: kingdomOwner, kingdom: new Map() })[view];
const isDetailView = () => view === 'holding' || view === 'strait';
const isProvinceView = () => view === 'province' || isDetailView();
const holdingColors = { castle: '#f1c879', city: '#83d2ce', temple: '#d9b0ee', tribal: '#a9d18a' };
const parentKind = () => ({ province: 'county', county: 'duchy', duchy: 'kingdom' })[view];
const pause = () => new Promise(resolve => setTimeout(resolve, 0));
function message(text = '', error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }
function readDataURL(file) { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(Error('文件读取失败')); r.readAsDataURL(file); }); }
function rebuildOwners() {
  countyOwner = new Map(); duchyOwner = new Map(); kingdomOwner = new Map(); countyById = new Map(state.counties.map(g => [g.id, g])); duchyById = new Map(state.duchies.map(g => [g.id, g])); kingdomById = new Map(state.kingdoms.map(g => [g.id, g]));
  state.counties.forEach(g => g.members.forEach(id => countyOwner.set(id, g.id)));
  state.duchies.forEach(g => g.members.forEach(id => duchyOwner.set(id, g.id)));
  state.kingdoms.forEach(g => g.members.forEach(id => kingdomOwner.set(id, g.id)));
}
function commit(next, notice = '') {
  core.validate(next, provinceIds);
  history.push(JSON.stringify(state)); if (history.length > 60) history.shift();
  state = next; dirty = true; rebuildOwners(); update(); message(notice);
}
function mutate(fn, notice) { try { const next = structuredClone(state); fn(next); commit(next, notice); } catch (e) { message(e.message, true); } }
function groupFocused() { return focus && byId(focus.kind).get(focus.id); }
function changeView(next) { view = next; selection.clear(); message(); update(); }
function fit() { if (!width) return; scale = Math.min(canvas.width / width, canvas.height / height) * .96; panX = (canvas.width - width * scale) / 2; panY = (canvas.height - height * scale) / 2; renderSoon(); }
function hexRGB(hex) { return [parseInt(hex.slice(1,3),16),parseInt(hex.slice(3,5),16),parseInt(hex.slice(5,7),16)]; }
function renderSoon() { if (!frame) frame = requestAnimationFrame(() => { frame = 0; render(); }); }
function drawTerritoryBorders() {
  // Outline the parent group in each member view, and kingdoms in the final overview.
  const kind = parentKind() || 'kingdom';
  const groups = isDetailView() ? [...selection].map(id => ({ id })) : state[tier(kind).key];
  if (!groups.length) return;
  const groupNumbers = new Map(groups.map((g, i) => [g.id, i + 1]));
  const owners = new Uint32Array(provinces.length + 1);
  provinces.forEach((p, i) => {
    const county = countyOwner.get(p.id), duchy = duchyOwner.get(county);
    const id = isDetailView() ? p.id : kind === 'county' ? county : kind === 'duchy' ? duchy : kingdomOwner.get(duchy);
    owners[i + 1] = groupNumbers.get(id) || 0;
  });
  // Sample one pixel beyond the viewport to avoid drawing false borders at its edges.
  const w = canvas.width, h = canvas.height, stride = w + 2;
  const screenOwners = new Uint32Array(stride * (h + 2));
  const columns = new Int32Array(stride);
  for (let x = -1; x <= w; x++) columns[x + 1] = Math.floor((x - panX) / scale);
  for (let y = -1; y <= h; y++) {
    const mapY = Math.floor((y - panY) / scale);
    if (mapY < 0 || mapY >= height) continue;
    for (let x = -1; x <= w; x++) {
      const mapX = columns[x + 1];
      if (mapX >= 0 && mapX < width) screenOwners[(y + 1) * stride + x + 1] = owners[labels[mapY * width + mapX]];
    }
  }
  ctx.save();
  ctx.beginPath();
  for (let y = 0; y <= h; y++) {
    for (let x = 0; x <= w; x++) {
      const i = (y + 1) * stride + x + 1, owner = screenOwners[i];
      if (y < h && owner !== screenOwners[i - 1]) { ctx.moveTo(x, y); ctx.lineTo(x, y + 1); }
      if (x < w && owner !== screenOwners[i - stride]) { ctx.moveTo(x, y); ctx.lineTo(x + 1, y); }
    }
  }
  // Fixed screen-space widths remain legible while zooming, on light or dark colors.
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = '#111820'; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = '#fff1c4'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}
function drawHoldingMarkers() {
  ctx.save();
  for (const [id, type] of Object.entries(state.holdings)) {
    const p = provinces[indexById.get(id)]; if (!p) continue;
    const x = panX + p.x * scale, y = panY + p.y * scale;
    if (x < -14 || y < -14 || x > canvas.width + 14 || y > canvas.height + 14) continue;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#14202b'; ctx.strokeStyle = holdingColors[type]; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = holdingColors[type]; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    if (type === 'castle') {
      ctx.moveTo(-7, 7); ctx.lineTo(-7, -6); ctx.lineTo(-4, -6); ctx.lineTo(-4, -3); ctx.lineTo(-1, -3); ctx.lineTo(-1, -6); ctx.lineTo(2, -6); ctx.lineTo(2, -3); ctx.lineTo(5, -3); ctx.lineTo(5, -6); ctx.lineTo(8, -6); ctx.lineTo(8, 7); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#14202b'; ctx.fillRect(-1, 2, 3, 5);
    } else if (type === 'city') {
      ctx.moveTo(-8, -1); ctx.lineTo(-3, -6); ctx.lineTo(2, -1); ctx.moveTo(0, -3); ctx.lineTo(5, -7); ctx.lineTo(9, -3); ctx.stroke();
      ctx.fillRect(-6, 0, 6, 7); ctx.fillRect(3, -2, 5, 9);
    } else if (type === 'temple') {
      ctx.moveTo(-8, -3); ctx.lineTo(0, -8); ctx.lineTo(8, -3); ctx.closePath(); ctx.fill();
      ctx.fillRect(-7, 6, 14, 2); for (const dx of [-5, -1, 3]) ctx.fillRect(dx, -1, 2, 6);
    } else {
      ctx.moveTo(-8, 7); ctx.lineTo(0, -7); ctx.lineTo(8, 7); ctx.closePath(); ctx.stroke(); ctx.moveTo(0, -7); ctx.lineTo(3, -10); ctx.moveTo(0, -7); ctx.lineTo(-3, -10); ctx.moveTo(-2, 7); ctx.lineTo(0, 1); ctx.lineTo(3, 7); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
function drawStraits() {
  const chosen = [...selection];
  const chosenKey = chosen.length === 2 ? core.straitKey(...chosen) : null;
  function line(from, to, selected, preview = false) {
    const a=provinces[indexById.get(from)], b=provinces[indexById.get(to)]; if (!a || !b) return;
    const x1=panX+a.x*scale, y1=panY+a.y*scale, x2=panX+b.x*scale, y2=panY+b.y*scale;
    ctx.save(); ctx.lineCap='round'; ctx.setLineDash(preview?[7,5]:[]);
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2);
    ctx.strokeStyle='#101923';ctx.lineWidth=6;ctx.stroke();
    ctx.strokeStyle=selected?'#ffda5b':'#7ce4ed';ctx.lineWidth=3;ctx.stroke();ctx.setLineDash([]);
    for (const [x,y] of [[x1,y1],[x2,y2]]) { ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=ctx.strokeStyle;ctx.fill();ctx.strokeStyle='#101923';ctx.lineWidth=1.5;ctx.stroke();ctx.strokeStyle=selected?'#ffda5b':'#7ce4ed'; }
    ctx.restore();
  }
  for (const link of state.straits) line(link.from,link.to,core.straitKey(link.from,link.to)===chosenKey);
  if (chosenKey && !state.straits.some(link=>core.straitKey(link.from,link.to)===chosenKey)) line(...chosen,true,true);
  ctx.save();ctx.font='bold 13px Segoe UI';ctx.textAlign='center';ctx.textBaseline='middle';
  chosen.forEach((id,i)=>{const p=provinces[indexById.get(id)];if(!p)return;const x=panX+p.x*scale,y=panY+p.y*scale-17;ctx.lineWidth=4;ctx.strokeStyle='#101923';ctx.strokeText(i?'B':'A',x,y);ctx.fillStyle='#ffda5b';ctx.fillText(i?'B':'A',x,y);});
  ctx.restore();
}
function render() {
  ctx.fillStyle = '#0b1016'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!labels) return;
  const colors = new Uint32Array(provinces.length + 1), ignored = new Set(state.ignored), focused = groupFocused();
  for (let i = 0; i < provinces.length; i++) {
    const p = provinces[i], cid = countyOwner.get(p.id), did = duchyOwner.get(cid), kid = kingdomOwner.get(did);
    let rgb = p.rgb, selected = false, member = false;
    if (view === 'county') rgb = cid ? hexRGB(countyById.get(cid).color) : [48,58,69];
    if (view === 'duchy') rgb = did ? hexRGB(duchyById.get(did).color) : [48,58,69];
    if (view === 'kingdom') rgb = kid ? hexRGB(kingdomById.get(kid).color) : [48,58,69];
    if (isDetailView()) { /* Keep the exact original RGB, including selected baronies. */ }
    else if (ignored.has(p.id)) rgb = [23,30,39];
    else selected = selection.has(view === 'province' ? p.id : view === 'county' ? cid : view === 'duchy' ? did : kid);
    if (focused && !isDetailView()) member = (focus.kind === 'county' ? cid : focus.kind === 'duchy' ? did : kid) === focus.id;
    if (member) rgb = rgb.map(v => Math.round(v * .8 + 45));
    if (selected) rgb = [255, 218, 91];
    colors[i+1] = (255 << 24) | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
  }
  const w = canvas.width, h = canvas.height, pixels = ctx.createImageData(w, h), packed = new Uint32Array(pixels.data.buffer);
  packed.fill(0xff16100b);
  const x0 = Math.max(0, Math.ceil(panX)), x1 = Math.min(w, Math.ceil(panX + width * scale));
  const y0 = Math.max(0, Math.ceil(panY)), y1 = Math.min(h, Math.ceil(panY + height * scale));
  const columns = new Int32Array(Math.max(0, x1-x0));
  for (let x=x0; x<x1; x++) columns[x-x0] = Math.floor((x-panX)/scale);
  for (let y=y0; y<y1; y++) {
    const row = Math.floor((y-panY)/scale) * width;
    for (let x=x0; x<x1; x++) { const n=labels[row+columns[x-x0]]; if (n) packed[y*w+x] = colors[n]; }
  }
  ctx.putImageData(pixels, 0, 0);
  drawTerritoryBorders();
  if (isDetailView()) {
    if (view === 'holding') drawHoldingMarkers(); else drawStraits();
    $('zoom').textContent = `${Math.round(scale*100)}%`;
    return;
  }
  const markers = view === 'kingdom'
    ? state.kingdoms.map(k => ({ province: countyById.get(duchyById.get(k.capital)?.capital)?.capital }))
    : view === 'duchy' ? state.duchies.map(d => ({ province:countyById.get(d.capital)?.capital })) : state.counties.map(c => ({ province:c.capital }));
  ctx.font='bold 18px Segoe UI'; ctx.textAlign='center'; ctx.textBaseline='middle';
  for (const marker of markers) {
    const p=provinces[indexById.get(marker.province)]; if (!p) continue;
    const x=panX+p.x*scale, y=panY+p.y*scale;
    if (x<0 || y<0 || x>w || y>h) continue;
    ctx.lineWidth=3; ctx.strokeStyle='#131922'; ctx.strokeText('★',x,y); ctx.fillStyle='#ffffff';ctx.fillText('★',x,y);
  }
  $('zoom').textContent = `${Math.round(scale*100)}%`;
}
function update() {
  document.querySelector('aside').inert=busy; $('png').disabled=busy; $('project').disabled=busy;
  $('empty').hidden=!!labels; $('empty').style.display=labels?'none':'grid';
  $('save').disabled=!labels||busy; $('undo').disabled=!history.length||busy;
  $('dirty').textContent=dirty?'● 未保存':'';
  $('counts').textContent=labels?`${provinces.length} 色块 · ${state.counties.length} 伯爵领 · ${state.duchies.length} 公爵领 · ${state.kingdoms.length} 王国`:'本地运行 · 数据不上传';
  for (const [id,v] of [['provinceTab','province'],['countyTab','county'],['duchyTab','duchy'],['kingdomTab','kingdom'],['holdingTab','holding'],['straitTab','strait']]) $(id).classList.toggle('active',view===v);
  const noun=isProvinceView()?(isDetailView()?'男爵领':'地块'):tier(view).name;
  $('selectionTitle').textContent=`已选${noun} · ${selection.size}`;
  $('selection').replaceChildren();
  if (!selection.size) $('selection').textContent='点击地图开始选择';
  for (const id of [...selection].slice(0,100)) { const span=document.createElement('span'); span.className='chip'; span.textContent=isProvinceView()?id:byId(view).get(id)?.name||id; $('selection').append(span); }
  $('add').textContent=parentKind()?'添加'+tier(parentKind()).name:'添加王国'; $('add').hidden=!parentKind();
  const occupied=[...selection].some(id => ownerForView().has(id));
  $('add').disabled=busy||!selection.size||occupied;
  $('add').title=occupied?'所选成员已有归属；可在右侧编辑已有领地，或解除已有分组后重建。':'';
  $('ignore').hidden=view!=='province'; $('ignore').disabled=busy||!selection.size||occupied||[...selection].some(id=>state.holdings[id]||state.straits.some(link=>link.from===id||link.to===id));
  $('ignore').title='有领地归属、地产或海峡连接的地块不能忽略；请先移除相关设置。';
  $('restore').hidden=isDetailView();
  $('restore').disabled=busy||!state.ignored.length;
  for (const id of ['listTitle','search','lists']) $(id).hidden=isDetailView();
  $('help').textContent=view==='holding'?'点击男爵领，在右侧选择地产类型。无地产保留原色；已有地产显示小图标。选择“无地产”移除图标。选中时只描边，不改变底色。已忽略的海洋等色块不能设置地产。':'每个地块只属于一个伯爵领；每个伯爵领只属于一个公爵领；每个公爵领只属于一个王国。★ 表示首府位置。保存工程包含原 PNG、领地和地产数据。';
  if (view === 'strait') $('help').textContent='依次点击两个男爵领（无需 Ctrl），再添加连接。再次点击已选地块可取消；选满两个后点击新地块会开始下一组。青色实线为已有连接，黄色虚线为待添加连接。连线表示两地的规划关系，不是精确渡海路径。';
  updateDetails(); updateLists(); renderSoon();
}
function field(label, control) { const el=document.createElement('label'); el.className='field'; el.textContent=label; el.append(control); return el; }
function button(text, fn, cls='') { const b=document.createElement('button'); b.textContent=text; b.className=cls; b.onclick=fn; return b; }
function updateDetails() {
  if (view === 'holding') { updateHoldingDetails(); return; }
  if (view === 'strait') { updateStraitDetails(); return; }
  const el=$('details'); el.replaceChildren(); const g=groupFocused();
  if (!g) { el.textContent='建立领地后，点击列表设置名称和首府。'; return; }
  const config=tier(focus.kind), memberView=config.memberView;
  const title=document.createElement('h2');title.textContent=`${config.name} · ${g.id}`;el.append(title);
  const name=document.createElement('input');name.value=g.name;name.maxLength=120;
  name.onchange=()=>mutate(s=>{s[config.key].find(x=>x.id===g.id).name=name.value.trim();},'名称已更新');el.append(field('名称',name));
  const capital=document.createElement('select');capital.setAttribute('aria-label',config.name+'首府');
  g.members.forEach(id=>{const option=document.createElement('option');option.value=id;option.textContent=memberView==='province'?`${id} · RGB ${provinces[indexById.get(id)].rgb.join(',')}`:`${byId(memberView).get(id).name} · ${id}`;capital.append(option);});capital.value=g.capital;
  capital.onchange=()=>mutate(s=>{s[config.key].find(x=>x.id===g.id).capital=capital.value;},'首府已更新');el.append(field('首府（★）',capital));
  const color=document.createElement('input');color.type='color';color.value=g.color;color.onchange=()=>mutate(s=>{s[config.key].find(x=>x.id===g.id).color=color.value;});el.append(field('领地显示颜色',color));
  const parent=focus.kind==='county'?duchyById.get(duchyOwner.get(g.id)):focus.kind==='duchy'?kingdomById.get(kingdomOwner.get(g.id)):null;
  const hint=document.createElement('p');hint.className='muted';hint.textContent=`${g.members.length} 个成员 · ${parent?.name || (focus.kind==='county'?'尚未归属公爵领':focus.kind==='duchy'?'尚未归属王国':'首府位置继承所选公爵领的首府地块')}`;el.append(hint);
  const actions=document.createElement('div');actions.className='actions';
  actions.append(button('选中成员',()=>{view=memberView;selection=new Set(g.members);update();}));
  actions.append(button('所选设为首府',()=>{
    const id=[...selection][0]; if(selection.size!==1||!g.members.includes(id)||view!==memberView){message('请在成员视图只选中本领地的一个成员。',true);return;}
    mutate(s=>{s[config.key].find(x=>x.id===g.id).capital=id;},'首府已更新');
  }));
  actions.append(button('解除分组',()=>{const next=core.remove(state,focus.kind,g.id);focus=null;selection.clear();commit(next,'已解除分组，可以撤销。空的上级领地会移除；被移除的首府自动换成剩余首个成员。');},'danger'));el.append(actions);
}
function updateHoldingDetails() {
  const el=$('details'); el.replaceChildren();
  const title=document.createElement('h2'); title.textContent='男爵领地产'; el.append(title);
  const id=[...selection][0], p=provinces[indexById.get(id)];
  if (!p) { const hint=document.createElement('p'); hint.className='muted'; hint.textContent='点击地图上的男爵领，为它选择地产类型。'; el.append(hint); }
  else {
    const info=document.createElement('p'); info.textContent=`${id} · RGB ${p.rgb.join(', ')}`; el.append(info);
    const control=document.createElement('select'); control.setAttribute('aria-label','地产类型');
    for (const [value,name] of [['','无地产'],...Object.entries(core.holdingTypes)]) { const option=document.createElement('option'); option.value=value; option.textContent=name; control.append(option); }
    control.value=state.holdings[id]||'';
    control.onchange=()=>{try{commit(core.setHolding(state,id,control.value,provinceIds),control.value?`已设置为${core.holdingTypes[control.value]}`:'已移除地产');}catch(e){message(e.message,true);}};
    el.append(field('地产类型',control));
    const parent=document.createElement('p'); parent.className='muted'; parent.textContent=countyById.get(countyOwner.get(id))?.name||'尚未归属伯爵领，也可独立设置地产';el.append(parent);
  }
  const summary=document.createElement('p'); summary.className='muted'; summary.textContent=`已设置 ${Object.keys(state.holdings).length} 个地产`;el.append(summary);
  const legend=document.createElement('div'); legend.className='muted';legend.textContent='图标：城垛＝城堡 · 房屋＝城市 · 柱廊＝神殿 · 帐篷＝部落';el.append(legend);
}
function updateStraitDetails() {
  const el=$('details');el.replaceChildren();const chosen=[...selection];
  const title=document.createElement('h2');title.textContent='海峡连接';el.append(title);
  for (let i=0;i<2;i++) {
    const row=document.createElement('p'),id=chosen[i],county=countyById.get(countyOwner.get(id));
    row.textContent=`${i?'终点 B':'起点 A'}：${id ? id+(county?' · '+county.name:''):'点击男爵领选择'}`;el.append(row);
  }
  const exists=chosen.length===2&&state.straits.some(link=>core.straitKey(link.from,link.to)===core.straitKey(...chosen));
  const add=button(exists?'连接已存在':'添加海峡连接',()=>{try{const next=core.addStrait(state,...chosen,provinceIds);commit(next,'已添加海峡连接');}catch(e){message(e.message,true);}},'primary');
  add.disabled=busy||chosen.length!==2||exists;el.append(add);
  const heading=document.createElement('h3');heading.textContent=`已有连接 (${state.straits.length})`;el.append(heading);
  if (!state.straits.length) { const hint=document.createElement('p');hint.className='muted';hint.textContent='尚未添加海峡连接。';el.append(hint); }
  state.straits.forEach((link,i)=>{
    const row=document.createElement('div');row.style.marginBottom='12px';
    const selected=exists&&core.straitKey(link.from,link.to)===core.straitKey(...chosen);
    const select=button(`${i+1}. ${link.from} ↔ ${link.to}`,()=>{selection=new Set([link.from,link.to]);update();message('已选中连接，可删除或更换端点后添加新连接。');},'card'+(selected?' chosen':''));
    row.append(select,button('删除连接',()=>{try{const next=core.removeStrait(state,link.from,link.to,provinceIds);selection.clear();commit(next,'已删除连接，可以撤销。');}catch(e){message(e.message,true);}},'danger'));el.append(row);
  });
}
function updateLists() {
  const el=$('lists'), query=$('search').value.trim().toLowerCase();el.replaceChildren();
  for(const [kind,config] of Object.entries(core.tiers)) {
    const title=config.name,groups=state[config.key];
    const h=document.createElement('h3');h.textContent=`${title} (${groups.length})`;el.append(h);
    for (const g of groups.filter(g=>(g.name+' '+g.id).toLowerCase().includes(query))) {
      const b=button('',()=>{focus={kind,id:g.id};update();},'card'+(focus?.id===g.id?' chosen':''));
      const swatch=document.createElement('span');swatch.className='swatch';swatch.style.background=g.color;
      const name=document.createElement('span');name.textContent=g.name;const small=document.createElement('small');small.textContent=`${g.members.length} · ${g.id}`;b.append(swatch,name,small);el.append(b);
    }
  }
}
async function decode(file) {
  const bitmap=await createImageBitmap(file); const w=bitmap.width,h=bitmap.height;
  if(w*h>100000000){bitmap.close();throw Error('图片超过 1 亿像素，请先裁剪为规划区域。');}
  const array=new Uint16Array(w*h), entries=[], byColor=new Map(); let partial=0;
  const strip=document.createElement('canvas'); strip.width=w;strip.height=128;const c=strip.getContext('2d',{willReadFrequently:true});
  try {
    for(let top=0;top<h;top+=128) {
      const sh=Math.min(128,h-top);c.clearRect(0,0,w,128);c.drawImage(bitmap,0,top,w,sh,0,0,w,sh);
      const rgba=c.getImageData(0,0,w,sh).data;
      for(let p=0;p<w*sh;p++) {
        const j=p*4;if(rgba[j+3]===0)continue;if(rgba[j+3]!==255)partial++;
        const key=(rgba[j]<<16)|(rgba[j+1]<<8)|rgba[j+2];let n=byColor.get(key);
        if(n===undefined){if(entries.length>=60000)throw Error('超过 60,000 种颜色；请使用无抗锯齿的纯色省份 PNG。');n=entries.length+1;byColor.set(key,n);entries.push({id:'P_'+key.toString(16).padStart(6,'0').toUpperCase(),rgb:[rgba[j],rgba[j+1],rgba[j+2]],pixels:0,x:p%w,y:top+Math.floor(p/w)});}
        array[top*w+p]=n;entries[n-1].pixels++;
      }
      if(top%512===0){message(`识别色块… ${Math.round((top+sh)/h*100)}%`);await pause();}
    }
  } finally {bitmap.close();strip.width=1;strip.height=1;}
  if(!entries.length)throw Error('图片没有可识别的不透明色块');
  // Place markers on an actual member pixel near its bounding-box center, never in a hole.
  const bounds=entries.map(()=>[w,h,0,0]);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const n=array[y*w+x];if(n){const b=bounds[n-1];b[0]=Math.min(b[0],x);b[1]=Math.min(b[1],y);b[2]=Math.max(b[2],x);b[3]=Math.max(b[3],y);}}
  const best=new Float64Array(entries.length);best.fill(Infinity);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const n=array[y*w+x];if(n){const b=bounds[n-1],d=(x-(b[0]+b[2])/2)**2+(y-(b[1]+b[3])/2)**2;if(d<best[n-1]){best[n-1]=d;entries[n-1].x=x;entries[n-1].y=y;}}}
  return {width:w,height:h,labels:array,provinces:entries,partial};
}
async function load(file, project) {
  if(busy)return;
  if(dirty&&!confirm('当前工程有未保存的修改。继续打开会替换当前工程，是否继续？'))return;
  busy=true;update();message('正在读取图片…');
  try {
    let data,name,s=core.empty(),blob=file;
    if(project){
      const doc=JSON.parse(await file.text());
      if(doc.format!=='territory-planner'||![1,2,3,4].includes(doc.version)||typeof doc.image?.data!=='string'||!doc.image.data.startsWith('data:image/png;base64,'))throw Error('不是有效的领地规划工程');
      const encoded=atob(doc.image.data.split(',')[1]);const bytes=new Uint8Array(encoded.length);for(let i=0;i<bytes.length;i++)bytes[i]=encoded.charCodeAt(i);blob=new Blob([bytes],{type:'image/png'});
      data=doc.image.data;name=doc.image.name;s=core.upgrade(doc.state,doc.version);
    }else{data=await readDataURL(file);name=file.name;}
    const result=await decode(blob), ids=new Set(result.provinces.map(p=>p.id));core.validate(s,ids);
    width=result.width;height=result.height;labels=result.labels;provinces=result.provinces;provinceIds=ids;indexById=new Map(provinces.map((p,i)=>[p.id,i]));
    pngData=data;fileName=name;state=s;history=[];selection.clear();focus=null;view='province';dirty=!project;
    rebuildOwners();fit();message(`已载入 ${width} × ${height}，识别 ${provinces.length} 种颜色。${result.partial?'检测到半透明像素，已按浏览器解码后的 RGB 分组；建议使用完全不透明的省份色图。':''}${provinces.length>10000?'颜色较多，请确认这是一张纯色省份图。':''}`);
  }catch(e){message('导入失败：'+e.message,true);}finally{busy=false;update();}
}
$('png').onchange=e=>{const f=e.target.files[0];if(f)load(f,false);e.target.value='';};
$('project').onchange=e=>{const f=e.target.files[0];if(f)load(f,true);e.target.value='';};
$('save').onclick=()=>{
  const doc={format:'territory-planner',version:4,image:{name:fileName,width,height,data:pngData},provinces:provinces.map(({id,rgb,pixels})=>({id,rgb,pixels})),state};
  const url=URL.createObjectURL(new Blob([JSON.stringify(doc)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=(fileName||'地图').replace(/\.png$/i,'')+'-领地规划.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);dirty=false;update();message('已请求下载工程，请确认浏览器已保存文件。');
};
$('undo').onclick=()=>{if(!history.length||busy)return;state=JSON.parse(history.pop());dirty=true;selection.clear();focus=null;rebuildOwners();update();message('已撤销');};
$('provinceTab').onclick=()=>changeView('province');$('countyTab').onclick=()=>changeView('county');$('duchyTab').onclick=()=>changeView('duchy');$('kingdomTab').onclick=()=>changeView('kingdom');$('holdingTab').onclick=()=>changeView('holding');$('straitTab').onclick=()=>changeView('strait');$('fit').onclick=fit;
$('clear').onclick=()=>{selection.clear();update();message();};$('search').oninput=updateLists;
$('add').onclick=()=>{try{const kind=parentKind();if(!kind)return;const result=core.add(state,kind,[...selection],provinceIds);focus={kind,id:result.id};selection.clear();commit(result.state,'领地已建立。默认首府是第一个所选成员，可在下方更改。');}catch(e){message(e.message,true);}};
$('ignore').onclick=()=>{const ids=[...selection];selection.clear();mutate(s=>{s.ignored=[...new Set([...s.ignored,...ids])];},'已忽略所选颜色');};
$('restore').onclick=()=>mutate(s=>{s.ignored=[];},'已恢复全部忽略颜色');
function point(e) {const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
function hit(pos){const x=Math.floor((pos.x-panX)/scale),y=Math.floor((pos.y-panY)/scale);if(x<0||y<0||x>=width||y>=height||!labels)return null;return provinces[labels[y*width+x]-1]||null;}
canvas.onpointerdown=e=>{if(busy||e.button!==0)return;const p=point(e);pointer={...p,startX:p.x,startY:p.y,moved:false};canvas.setPointerCapture(e.pointerId);};
canvas.onpointermove=e=>{
  const p=point(e);if(pointer){if(Math.hypot(p.x-pointer.startX,p.y-pointer.startY)>4)pointer.moved=true;if(pointer.moved){panX+=p.x-pointer.x;panY+=p.y-pointer.y;renderSoon();}pointer.x=p.x;pointer.y=p.y;return;}
  const tile=hit(p);if(tile){const cid=countyOwner.get(tile.id),did=duchyOwner.get(cid),kid=kingdomOwner.get(did);$('status').textContent=`${tile.id} · RGB ${tile.rgb.join(', ')} · ${tile.pixels.toLocaleString()} 像素${cid?' · '+countyById.get(cid).name:''}${did?' / '+duchyById.get(did).name:''}${kid?' / '+kingdomById.get(kid).name:''}${view==='holding'?' · '+(core.holdingTypes[state.holdings[tile.id]]||'无地产'):''}${state.ignored.includes(tile.id)?' · 已忽略':''}`;}
};
canvas.onpointerup=e=>{
  if(!pointer)return;const moved=pointer.moved;pointer=null;if(moved||busy)return;
  const tile=hit(point(e));if(!tile||state.ignored.includes(tile.id))return;
  if (view === 'strait') {
    if (selection.has(tile.id)) selection.delete(tile.id);
    else { if (selection.size===2) selection.clear(); selection.add(tile.id); }
    update();message(selection.size===2?'已选择两个男爵领，点击右侧添加连接。':'请选择连接的另一端。');return;
  }
  const cid=countyOwner.get(tile.id),did=duchyOwner.get(cid),kid=kingdomOwner.get(did),id=isProvinceView()?tile.id:view==='county'?cid:view==='duchy'?did:kid;
  if(!id){message(`这个地块还没有${tier(view).name}。`);return;}
  if(view!=='holding'&&(e.ctrlKey||e.metaKey)){if(selection.has(id))selection.delete(id);else selection.add(id);}else selection=new Set([id]);
  if(view==='kingdom')focus={kind:'kingdom',id};
  update();message(ownerForView().has(id)?'所选成员已有归属，请在领地列表中编辑。':'');
};
canvas.onpointercancel=()=>pointer=null;canvas.onlostpointercapture=()=>pointer=null;
canvas.addEventListener('wheel',e=>{if(!labels||busy)return;e.preventDefault();const p=point(e),old=scale;const minimum=Math.min(canvas.width/width,canvas.height/height)*.2;scale=Math.max(minimum,Math.min(64,scale*Math.exp(-e.deltaY*.0015)));panX=p.x-(p.x-panX)*scale/old;panY=p.y-(p.y-panY)*scale/old;renderSoon();},{passive:false});
document.addEventListener('keydown',e=>{if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(e.key==='Escape'){selection.clear();update();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();$('undo').click();}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();if(labels)$('save').click();}});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
new ResizeObserver(()=>{const r=$('viewport').getBoundingClientRect();canvas.width=Math.max(1,Math.floor(r.width));canvas.height=Math.max(1,Math.floor(r.height));renderSoon();}).observe($('viewport'));
update();
