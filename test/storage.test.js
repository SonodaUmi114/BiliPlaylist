// BiliPlaylist 存储层纯逻辑测试（node 直接运行，零依赖）
// 运行：node test/storage.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const srcPath = path.join(__dirname, '..', 'src', 'storage.js');
const code = fs.readFileSync(srcPath, 'utf8');

// 内存版 chrome.storage.local stub
const store = {};
const sandbox = {
  console,
  chrome: {
    storage: {
      local: {
        async get(keys) {
          if (typeof keys === 'string') {
            const out = {};
            if (store[keys] !== undefined) out[keys] = store[keys];
            return out;
          }
          const out = {};
          for (const k of keys || []) {
            if (store[k] !== undefined) out[k] = store[k];
          }
          return out;
        },
        async set(items) { Object.assign(store, items); }
      }
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const S = sandbox.BiliStorage;

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ FAIL: ' + name); }
}

(async () => {
  console.log('== 播放列表 ==');
  assert('无数据时 getList 返回空数组', Array.isArray(await S.getList()) && (await S.getList()).length === 0);
  await S.saveList([{ bvid: 'BV1', title: '视频一' }, { bvid: 'BV2', title: '视频二' }]);
  const list = await S.getList();
  assert('saveList/getList 往返一致', list.length === 2 && list[0].bvid === 'BV1');

  console.log('== 播放进度 ==');
  assert('无数据时 getProgress 返回 {}', Object.keys(await S.getProgress()).length === 0);
  await S.saveProgress({ BV1: { part: 2, time: 100, done: false } });
  assert('saveProgress/getProgress 往返', (await S.getProgress()).BV1.time === 100);

  console.log('== 窗口模式 ==');
  assert('getPlayerMode 默认 default', (await S.getPlayerMode()) === 'default');
  await S.setPlayerMode('fullscreen');
  assert('setPlayerMode 往返', (await S.getPlayerMode()) === 'fullscreen');

  console.log('== 当前视频信息 ==');
  const cv0 = await S.getCurrentVideo();
  assert('getCurrentVideo 默认 {}（非 null）', typeof cv0 === 'object' && cv0 !== null && !cv0.bvid);
  await S.saveCurrentVideo({ bvid: 'BV1', pages: 5 });
  assert('saveCurrentVideo 往返', (await S.getCurrentVideo()).pages === 5);
  await S.saveCurrentVideo(null);
  assert('saveCurrentVideo(null) 也存为对象', typeof (await S.getCurrentVideo()) === 'object' && (await S.getCurrentVideo()) !== null);

  console.log('== 观看历史 ==');
  assert('无数据时 getHistory 返回 []', Array.isArray(await S.getHistory()) && (await S.getHistory()).length === 0);
  await S.saveHistory([{ bvid: 'BV1', title: '视频一', part: 2, time: 100, viewAt: 1700000000 }]);
  const hist = await S.getHistory();
  assert('saveHistory/getHistory 往返', hist.length === 1 && hist[0].time === 100 && hist[0].viewAt === 1700000000);

  console.log('== 分组元数据 ==');
  assert('无数据时 getGroups 返回 []', Array.isArray(await S.getGroups()) && (await S.getGroups()).length === 0);
  await S.saveGroups([{ id: 'g1', name: '分组1', color: '#EAF3FF', collapsed: true }]);
  const grps = await S.getGroups();
  assert('saveGroups/getGroups 往返', grps.length === 1 && grps[0].id === 'g1' && grps[0].collapsed === true);

  console.log('== key 前缀 ==');
  assert('所有 key 使用 biliplaylist: 前缀', Object.keys(store).length > 0 && Object.keys(store).every((k) => k.indexOf('biliplaylist:') === 0));

  console.log('--');
  console.log(fail === 0
    ? '✅ 全部通过（' + pass + ' 项）'
    : '❌ ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();
