// BiliPlaylist 纯逻辑测试（node 直接运行，零依赖）
// 验证：MD5 实现 + WBI 签名链路，对照 node crypto（权威）与 bilibili-API-collect 官方示例
// 运行：node test/api.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const apiPath = path.join(__dirname, '..', 'src', 'api.js');
const code = fs.readFileSync(apiPath, 'utf8');

// —— 官方文档示例数据（bilibili-API-collect · WBI 签名章节） ——
const IMG_KEY = '7cd084941338484aae1ad9425b84077c';
const SUB_KEY = '4932caff0ff746eab6f01bf08b70ac45';
const MIXIN_KEY = 'ea1db124af3c7062474693fa704f4ff8';
const WTS = 1702200452;
const PARAMS = { foo: '114', bar: '514', zab: 1919810 };
// 期望 query：按 key 排序 + wts
const EXPECTED_QUERY = 'bar=514&foo=114&wts=' + WTS + '&zab=1919810';
const EXPECTED_W_RID = crypto.createHash('md5').update(EXPECTED_QUERY + MIXIN_KEY).digest('hex');

let pass = 0;
let fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.error('  ✗ FAIL: ' + name); }
}

// —— 沙箱：stub chrome（api-fetch 桥返回 nav 密钥），固定 Date.now ——
const navBody = JSON.stringify({
  code: 0,
  data: {
    wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/' + IMG_KEY + '.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/' + SUB_KEY + '.png'
    }
  }
});
const sandbox = {
  console,
  URLSearchParams,
  URL,
  unescape,
  encodeURIComponent,
  Date: class extends Date { static now() { return WTS * 1000; } },
  chrome: {
    runtime: {
      sendMessage: async (msg) => {
        if (msg && msg.type === 'api-fetch') {
          return { ok: true, data: { ok: true, status: 200, text: navBody } };
        }
        return { ok: false, error: 'unexpected message' };
      }
    }
  }
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const BiliApi = sandbox.BiliApi;

(async () => {
  console.log('== MD5 标准向量 ==');
  assert("md5('abc') = 900150983cd24fb0d6963f7d28e17f72",
    BiliApi.md5('abc') === '900150983cd24fb0d6963f7d28e17f72');
  assert("md5('') = d41d8cd98f00b204e9800998ecf8427e",
    BiliApi.md5('') === 'd41d8cd98f00b204e9800998ecf8427e');
  assert('md5(中文) 与 node crypto 一致',
    BiliApi.md5('中文测试') === crypto.createHash('md5').update('中文测试', 'utf8').digest('hex'));

  console.log('== WBI 签名链路（官方示例参数） ==');
  try {
    const signed = await BiliApi.wbiSign(PARAMS);
    assert('返回 w_rid 且为 32 位 hex', /^[0-9a-f]{32}$/.test(signed.w_rid));
    assert('返回 wts 等于固定值 ' + WTS, signed.wts === WTS);
    assert('w_rid 与 node crypto 计算一致', signed.w_rid === EXPECTED_W_RID);
    console.log('    示例 w_rid = ' + signed.w_rid);
  } catch (e) {
    fail++;
    console.error('  ✗ FAIL: wbiSign 抛异常: ' + (e && e.message));
  }

  console.log('--');
  console.log(fail === 0
    ? '✅ 全部通过（' + pass + ' 项）'
    : '❌ ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail === 0 ? 0 : 1);
})();
