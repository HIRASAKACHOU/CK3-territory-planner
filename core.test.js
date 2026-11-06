const assert = require('node:assert/strict');
const {test} = require('node:test');
const core = require('./core.js');
const ids = new Set(['P_FF0000','P_00FF00','P_0000FF']);
function example() {
  let s=core.add(core.empty(),'county',['P_FF0000','P_00FF00'],ids).state;
  s=core.add(s,'county',['P_0000FF'],ids).state;
  return core.add(s,'duchy',s.counties.map(c=>c.id),ids).state;
}
test('province → county → duchy preserves member order and valid capitals through JSON round-trip',()=>{
  const s=JSON.parse(JSON.stringify(example()));
  assert.equal(core.validate(s,ids),s);
  assert.equal(s.counties[0].capital,'P_FF0000');
  assert.equal(s.duchies[0].capital,s.counties[0].id);
});
test('overlapping membership, missing provinces, ignored provinces and foreign capitals are rejected',()=>{
  const s=example();
  assert.throws(()=>core.add(s,'county',['P_FF0000'],ids));
  assert.throws(()=>core.add(s,'county',['P_FFFFFF'],ids));
  assert.throws(()=>core.add(s,'duchy',[s.counties[0].id],ids));
  const ignored=core.empty();ignored.ignored=['P_FF0000'];assert.throws(()=>core.add(ignored,'county',['P_FF0000'],ids));
  const bad=structuredClone(s);bad.counties[0].capital='P_0000FF';assert.throws(()=>core.validate(bad,ids));
  const badD=structuredClone(s);badD.duchies[0].capital='c_9999';assert.throws(()=>core.validate(badD,ids));
});
test('removing capital county repairs its duchy and removing last county removes empty duchy',()=>{
  const initial=example(), saved=JSON.stringify(initial);
  const s=core.remove(initial,'county',initial.counties[0].id);
  assert.equal(JSON.stringify(initial),saved);
  assert.equal(s.duchies[0].capital,s.counties[0].id);
  core.validate(s,ids);
  assert.equal(core.remove(s,'county',s.counties[0].id).duchies.length,0);
  assert.equal(core.remove(initial,'duchy',initial.duchies[0].id).counties.length,2);
});
function kingdomExample() {
  let s=core.empty();
  for (const id of ids) s=core.add(s,'county',[id],ids).state;
  s=core.add(s,'duchy',[s.counties[0].id],ids).state;
  s=core.add(s,'duchy',[s.counties[1].id,s.counties[2].id],ids).state;
  return core.add(s,'kingdom',s.duchies.map(d=>d.id),ids).state;
}
test('kingdom membership, capitals and version 2 round-trip',()=>{
  const s=kingdomExample();
  s.kingdoms[0].capital=s.duchies[1].id;
  const restored=core.upgrade(JSON.parse(JSON.stringify(s)),2);
  core.validate(restored,ids);
  assert.deepEqual(restored,s);
  assert.throws(()=>core.add(s,'kingdom',[s.duchies[0].id],ids));
  assert.throws(()=>core.add(s,'kingdom',['d_missing'],ids));
  const bad=structuredClone(s);bad.kingdoms[0].capital=s.counties[0].id;
  assert.throws(()=>core.validate(bad,ids));
});
test('old projects upgrade without changing existing group data; malformed v2 is rejected',()=>{
  const old=example();delete old.kingdoms;
  const upgraded=core.upgrade(old,1);
  assert.deepEqual(upgraded.kingdoms,[]);
  assert.deepEqual(upgraded.counties,old.counties);
  assert.deepEqual(upgraded.duchies,old.duchies);
  assert.equal(old.kingdoms,undefined);
  core.validate(upgraded,ids);
  assert.throws(()=>core.validate(core.upgrade(old,2),ids));
});
test('removing a county cascades through empty duchies and repairs kingdom capital; undo snapshot remains intact',()=>{
  const s=kingdomExample(),snapshot=JSON.stringify(s);
  const next=core.remove(s,'county',s.counties[0].id);
  core.validate(next,ids);
  assert.equal(next.duchies.length,1);
  assert.equal(next.kingdoms[0].capital,s.duchies[1].id);
  assert.equal(JSON.stringify(s),snapshot);
  const end=core.remove(next,'duchy',next.duchies[0].id);
  core.validate(end,ids);
  assert.equal(end.kingdoms.length,0);
  assert.equal(end.counties.length,2);
  const dissolved=core.remove(s,'kingdom',s.kingdoms[0].id);
  assert.equal(dissolved.kingdoms.length,0);
  assert.deepEqual(dissolved.duchies,s.duchies);
});
test('holdings are independent of titles, support changing/removal, and persist through version 3',()=>{
  const initial=core.empty();
  let s=core.setHolding(initial,'P_FF0000','castle',ids);
  assert.deepEqual(initial.holdings,{});
  s=core.add(s,'county',['P_FF0000'],ids).state;
  s=core.remove(s,'county',s.counties[0].id);
  assert.equal(s.holdings.P_FF0000,'castle');
  for(const type of ['city','temple','tribal']) s=core.setHolding(s,'P_FF0000',type,ids);
  const restored=core.upgrade(JSON.parse(JSON.stringify(s)),3);
  core.validate(restored,ids);assert.deepEqual(restored,s);
  const cleared=core.setHolding(s,'P_FF0000','',ids);
  assert.deepEqual(cleared.holdings,{});
  assert.equal(s.holdings.P_FF0000,'tribal');
});
test('invalid, ignored and missing holding provinces are rejected',()=>{
  const s=core.empty();s.ignored=['P_00FF00'];
  assert.throws(()=>core.setHolding(s,'P_00FF00','castle',ids));
  assert.throws(()=>core.setHolding(s,'P_ABABAB','castle',ids));
  assert.throws(()=>core.setHolding(s,'P_FF0000','invalid',ids));
  for(const holdings of [null,[],{'P_ABABAB':'castle'},{'P_FF0000':'invalid'},{'P_00FF00':'city'}]) {
    assert.throws(()=>core.validate({...s,holdings},ids));
  }
});
test('v1 and v2 projects gain empty holdings without assigning types or losing titles',()=>{
  for (const version of [1,2]) {
    const old=kingdomExample();delete old.holdings;
    if(version===1)delete old.kingdoms;
    const migrated=core.upgrade(old,version);
    core.validate(migrated,ids);assert.deepEqual(migrated.holdings,{});
    assert.deepEqual(migrated.counties,old.counties);assert.deepEqual(migrated.duchies,old.duchies);
    assert.equal(old.holdings,undefined);
  }
  const bad=core.empty();delete bad.holdings;
  assert.throws(()=>core.validate(core.upgrade(bad,3),ids));
});
test('straits connect distinct provinces, reject reverse duplicates and support multiple neighbors',()=>{
  const original=core.empty();
  let s=core.addStrait(original,'P_FF0000','P_00FF00',ids);
  assert.deepEqual(original.straits,[]);
  assert.throws(()=>core.addStrait(s,'P_00FF00','P_FF0000',ids));
  assert.throws(()=>core.addStrait(s,'P_FF0000','P_FF0000',ids));
  assert.throws(()=>core.addStrait(s,'P_FF0000','P_MISSING',ids));
  const ignored=core.empty();ignored.ignored=['P_00FF00'];
  assert.throws(()=>core.addStrait(ignored,'P_FF0000','P_00FF00',ids));
  s=core.addStrait(s,'P_FF0000','P_0000FF',ids);
  const removed=core.removeStrait(s,'P_00FF00','P_FF0000',ids);
  assert.deepEqual(removed.straits,[{from:'P_FF0000',to:'P_0000FF'}]);
  assert.equal(s.straits.length,2);
  core.validate(removed,ids);
});
test('straits survive v4 serialization and title dissolution; old projects preserve all existing data',()=>{
  let s=kingdomExample();s=core.setHolding(s,'P_FF0000','castle',ids);
  s=core.addStrait(s,'P_FF0000','P_0000FF',ids);
  const readback=core.upgrade(JSON.parse(JSON.stringify(s)),4);
  core.validate(readback,ids);assert.deepEqual(readback,s);
  assert.deepEqual(core.remove(s,'county',s.counties[0].id).straits,s.straits);
  for (const version of [1,2,3]) {
    const old=structuredClone(s);delete old.straits;
    if(version===1)delete old.kingdoms;
    if(version<3)delete old.holdings;
    const migrated=core.upgrade(old,version);core.validate(migrated,ids);
    assert.deepEqual(migrated.straits,[]);
    for(const key of Object.keys(old))assert.deepEqual(migrated[key],old[key]);
    assert.equal(old.straits,undefined);
  }
  const invalid=structuredClone(s);invalid.straits.push({...invalid.straits[0]});
  assert.throws(()=>core.validate(invalid,ids));
  delete invalid.straits;assert.throws(()=>core.validate(core.upgrade(invalid,4),ids));
});
