// BiliPlaylist manifest 完整性校验（node 直接运行，零依赖）
// 校验：manifest JSON 合法、引用的文件全部存在、权限/matches/host_permissions 覆盖正确
// 运行：node test/manifest.test.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ FAIL: ' + name); }
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

console.log('== 基本结构 ==');
assert('manifest_version = 3', manifest.manifest_version === 3);
assert('version 为 x.y.z 格式', /^\d+\.\d+\.\d+$/.test(manifest.version || ''));
assert('有 background.service_worker', !!(manifest.background && manifest.background.service_worker));
assert('有 content_scripts', Array.isArray(manifest.content_scripts) && manifest.content_scripts.length > 0);

console.log('== 引用的文件存在 ==');
if (manifest.background && manifest.background.service_worker) {
  assert('存在 ' + manifest.background.service_worker,
    fs.existsSync(path.join(root, manifest.background.service_worker)));
}
const jsFiles = [];
for (const cs of manifest.content_scripts || []) {
  for (const f of cs.js || []) jsFiles.push(f);
}
for (const f of jsFiles) {
  assert('存在 ' + f, fs.existsSync(path.join(root, f)));
}
for (const [size, file] of Object.entries(manifest.icons || {})) {
  assert('存在图标 ' + size + ': ' + file, fs.existsSync(path.join(root, file)));
}

console.log('== 注入配置 ==');
const matches = (manifest.content_scripts || []).flatMap((cs) => cs.matches || []);
const allFrames = (manifest.content_scripts || []).every((cs) => cs.all_frames === true);
assert('content_scripts 全部 all_frames: true', allFrames);
for (const d of ['www.bilibili.com', 'space.bilibili.com', 'player.bilibili.com']) {
  assert('matches 覆盖 ' + d, matches.some((m) => m.includes(d)));
}

console.log('== 权限 ==');
const perms = manifest.permissions || [];
for (const p of ['storage', 'fullscreen', 'scripting']) {
  assert('权限包含 ' + p, perms.includes(p));
}
const hp = manifest.host_permissions || [];
for (const d of ['www.bilibili.com', 'space.bilibili.com', 'player.bilibili.com', 'api.bilibili.com']) {
  assert('host_permissions 覆盖 ' + d, hp.some((h) => h.includes(d)));
}

console.log('== content_scripts 脚本顺序（依赖：storage → api → ui → player → content） ==');
const expectedOrder = ['storage.js', 'api.js', 'ui.js', 'player.js', 'content.js'];
const flat = jsFiles.map((f) => path.basename(f));
assert('脚本顺序正确', expectedOrder.every((name, i) => flat[i] === name));

console.log('--');
console.log(fail === 0
  ? '✅ 全部通过（' + pass + ' 项）'
  : '❌ ' + pass + ' 通过 / ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
