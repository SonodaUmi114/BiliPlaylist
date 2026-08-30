// BiliPlaylist API 层
// 请求统一经 background 在页面 MAIN world 执行（apiFetch 桥），自动携带 cookie/CORS/buvid
// 包含 WBI 签名（2023-03 起 B 站 web 端部分接口强制 w_rid + wts）
'use strict';

var BiliApi = (function () {
  // ---------- MD5（经典实现，ASCII/UTF-8 均可） ----------
  const md5 = (function () {
    function RotateLeft(lValue, iShiftBits) { return (lValue << iShiftBits) | (lValue >>> (32 - iShiftBits)); }
    function AddUnsigned(lX, lY) {
      const lX4 = lX & 0x40000000, lY4 = lY & 0x40000000;
      const lX8 = lX & 0x80000000, lY8 = lY & 0x80000000;
      const lResult = (lX & 0x3FFFFFFF) + (lY & 0x3FFFFFFF);
      if (lX4 & lY4) return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
      if (lX4 | lY4) {
        if (lResult & 0x40000000) return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
      }
      return (lResult ^ lX8 ^ lY8);
    }
    function F(x, y, z) { return (x & y) | ((~x) & z); }
    function G(x, y, z) { return (x & z) | (y & (~z)); }
    function H(x, y, z) { return (x ^ y ^ z); }
    function I(x, y, z) { return (y ^ (x | (~z))); }
    function FF(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function GG(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function HH(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function II(a, b, c, d, x, s, ac) { a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac)); return AddUnsigned(RotateLeft(a, s), b); }
    function ConvertToWordArray(string) {
      let lWordCount;
      const lMessageLength = string.length;
      const lNumberOfWords_temp1 = lMessageLength + 8;
      const lNumberOfWords_temp2 = (lNumberOfWords_temp1 - (lNumberOfWords_temp1 % 64)) / 64;
      const lNumberOfWords = (lNumberOfWords_temp2 + 1) * 16;
      const lByteArray = Array(lNumberOfWords - 1);
      let lByteCount = 0;
      while (lByteCount < lNumberOfWords) { lByteArray[lByteCount] = 0; lByteCount++; }
      for (lByteCount = 0; lByteCount < lMessageLength; lByteCount++) {
        lByteArray[(lByteCount - (lByteCount % 4)) >> 2] |= (string.charCodeAt(lByteCount) << ((lByteCount % 4) * 8));
      }
      lByteArray[((lMessageLength - (lMessageLength % 4)) >> 2)] |= 0x80 << ((lMessageLength % 4) * 8);
      lByteArray[lNumberOfWords - 2] = lMessageLength << 3;
      lByteArray[lNumberOfWords - 1] = lMessageLength >>> 29;
      return lByteArray;
    }
    function WordToHex(lValue) {
      let WordToHexValue = '', WordToHexValue_temp = '', lByte, lCount;
      for (lCount = 0; lCount <= 3; lCount++) {
        lByte = (lValue >>> (lCount * 8)) & 255;
        WordToHexValue_temp = '0' + lByte.toString(16);
        WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length - 2, 2);
      }
      return WordToHexValue;
    }
    return function (string) {
      const S11 = 7, S12 = 12, S13 = 17, S14 = 22, S21 = 5, S22 = 9, S23 = 14, S24 = 20;
      const S31 = 4, S32 = 11, S33 = 16, S34 = 23, S41 = 6, S42 = 10, S43 = 15, S44 = 21;
      string = unescape(encodeURIComponent(string));
      const x = ConvertToWordArray(string);
      let a = 0x67452301, b = 0xEFCDAB89, c = 0x98BADCFE, d = 0x10325476;
      let AA, BB, CC, DD, k;
      for (k = 0; k < x.length; k += 16) {
        AA = a; BB = b; CC = c; DD = d;
        a = FF(a, b, c, d, x[k + 0], S11, 0xD76AA478); d = FF(d, a, b, c, x[k + 1], S12, 0xE8C7B756);
        c = FF(c, d, a, b, x[k + 2], S13, 0x242070DB); b = FF(b, c, d, a, x[k + 3], S14, 0xC1BDCEEE);
        a = FF(a, b, c, d, x[k + 4], S11, 0xF57C0FAF); d = FF(d, a, b, c, x[k + 5], S12, 0x4787C62A);
        c = FF(c, d, a, b, x[k + 6], S13, 0xA8304613); b = FF(b, c, d, a, x[k + 7], S14, 0xFD469501);
        a = FF(a, b, c, d, x[k + 8], S11, 0x698098D8); d = FF(d, a, b, c, x[k + 9], S12, 0x8B44F7AF);
        c = FF(c, d, a, b, x[k + 10], S13, 0xFFFF5BB1); b = FF(b, c, d, a, x[k + 11], S14, 0x895CD7BE);
        a = FF(a, b, c, d, x[k + 12], S11, 0x6B901122); d = FF(d, a, b, c, x[k + 13], S12, 0xFD987193);
        c = FF(c, d, a, b, x[k + 14], S13, 0xA679438E); b = FF(b, c, d, a, x[k + 15], S14, 0x49B40821);
        a = GG(a, b, c, d, x[k + 1], S21, 0xF61E2562); d = GG(d, a, b, c, x[k + 6], S22, 0xC040B340);
        c = GG(c, d, a, b, x[k + 11], S23, 0x265E5A51); b = GG(b, c, d, a, x[k + 0], S24, 0xE9B6C7AA);
        a = GG(a, b, c, d, x[k + 5], S21, 0xD62F105D); d = GG(d, a, b, c, x[k + 10], S22, 0x2441453);
        c = GG(c, d, a, b, x[k + 15], S23, 0xD8A1E681); b = GG(b, c, d, a, x[k + 4], S24, 0xE7D3FBC8);
        a = GG(a, b, c, d, x[k + 9], S21, 0x21E1CDE6); d = GG(d, a, b, c, x[k + 14], S22, 0xC33707D6);
        c = GG(c, d, a, b, x[k + 3], S23, 0xF4D50D87); b = GG(b, c, d, a, x[k + 8], S24, 0x455A14ED);
        a = GG(a, b, c, d, x[k + 13], S21, 0xA9E3E905); d = GG(d, a, b, c, x[k + 2], S22, 0xFCEFA3F8);
        c = GG(c, d, a, b, x[k + 7], S23, 0x676F02D9); b = GG(b, c, d, a, x[k + 12], S24, 0x8D2A4C8A);
        a = HH(a, b, c, d, x[k + 5], S31, 0xFFFA3942); d = HH(d, a, b, c, x[k + 8], S32, 0x8771F681);
        c = HH(c, d, a, b, x[k + 11], S33, 0x6D9D6122); b = HH(b, c, d, a, x[k + 14], S34, 0xFDE5380C);
        a = HH(a, b, c, d, x[k + 1], S31, 0xA4BEEA44); d = HH(d, a, b, c, x[k + 4], S32, 0x4BDECFA9);
        c = HH(c, d, a, b, x[k + 7], S33, 0xF6BB4B60); b = HH(b, c, d, a, x[k + 10], S34, 0xBEBFBC70);
        a = HH(a, b, c, d, x[k + 13], S31, 0x289B7EC6); d = HH(d, a, b, c, x[k + 0], S32, 0xEAA127FA);
        c = HH(c, d, a, b, x[k + 3], S33, 0xD4EF3085); b = HH(b, c, d, a, x[k + 6], S34, 0x4881D05);
        a = HH(a, b, c, d, x[k + 9], S31, 0xD9D4D039); d = HH(d, a, b, c, x[k + 12], S32, 0xE6DB99E5);
        c = HH(c, d, a, b, x[k + 15], S33, 0x1FA27CF8); b = HH(b, c, d, a, x[k + 2], S34, 0xC4AC5665);
        a = II(a, b, c, d, x[k + 0], S41, 0xF4292244); d = II(d, a, b, c, x[k + 7], S42, 0x432AFF97);
        c = II(c, d, a, b, x[k + 14], S43, 0xAB9423A7); b = II(b, c, d, a, x[k + 5], S44, 0xFC93A039);
        a = II(a, b, c, d, x[k + 12], S41, 0x655B59C3); d = II(d, a, b, c, x[k + 3], S42, 0x8F0CCC92);
        c = II(c, d, a, b, x[k + 10], S43, 0xFFEFF47D); b = II(b, c, d, a, x[k + 1], S44, 0x85845DD1);
        a = II(a, b, c, d, x[k + 8], S41, 0x6FA87E4F); d = II(d, a, b, c, x[k + 15], S42, 0xFE2CE6E0);
        c = II(c, d, a, b, x[k + 6], S43, 0xA3014314); b = II(b, c, d, a, x[k + 13], S44, 0x4E0811A1);
        a = II(a, b, c, d, x[k + 4], S41, 0xF7537E82); d = II(d, a, b, c, x[k + 11], S42, 0xBD3AF235);
        c = II(c, d, a, b, x[k + 2], S43, 0x2AD7D2BB); b = II(b, c, d, a, x[k + 9], S44, 0xEB86D391);
        a = AddUnsigned(a, AA); b = AddUnsigned(b, BB); c = AddUnsigned(c, CC); d = AddUnsigned(d, DD);
      }
      return (WordToHex(a) + WordToHex(b) + WordToHex(c) + WordToHex(d)).toLowerCase();
    };
  })();

  // ---------- WBI 签名 ----------
  const MIXIN_KEY_ENC_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52];
  let wbiKeys = null;

  function getMixinKey(orig) {
    return MIXIN_KEY_ENC_TAB.map((n) => orig[n]).join('').slice(0, 32);
  }

  // ---------- 请求桥 ----------
  async function apiFetch(url, opts) {
    const resp = await chrome.runtime.sendMessage({ type: 'api-fetch', url, opts });
    if (!resp || !resp.ok) {
      throw new Error('api-fetch bridge 失败: ' + (resp && resp.error || 'no response'));
    }
    return resp.data; // { ok, status, text }
  }

  async function apiFetchJson(url, params, opts) {
    const qs = new URLSearchParams(params || {}).toString();
    const full = qs ? url + (url.includes('?') ? '&' : '?') + qs : url;
    const data = await apiFetch(full, opts);
    if (!data || data.status === 0) throw new Error('网络请求失败');
    let json;
    try {
      json = JSON.parse(data.text);
    } catch (e) {
      throw new Error('响应不是合法 JSON: ' + String(data.text || '').slice(0, 200));
    }
    if (json.code !== 0) {
      const err = new Error('B站接口错误 code=' + json.code + ' msg=' + (json.message || ''));
      err.code = json.code;
      throw err;
    }
    return json;
  }

  // ---------- WBI ----------
  async function getWbiKeys() {
    if (wbiKeys) return wbiKeys;
    const nav = await apiFetchJson('https://api.bilibili.com/x/web-interface/nav');
    const imgUrl = nav.data && nav.data.wbi_img && nav.data.wbi_img.img_url;
    const subUrl = nav.data && nav.data.wbi_img && nav.data.wbi_img.sub_url;
    if (!imgUrl || !subUrl) throw new Error('获取 wbi 密钥失败');
    const pick = (u) => u.slice(u.lastIndexOf('/') + 1).split('.')[0];
    wbiKeys = { imgKey: pick(imgUrl), subKey: pick(subUrl) };
    return wbiKeys;
  }

  async function wbiSign(params) {
    const { imgKey, subKey } = await getWbiKeys();
    const mixinKey = getMixinKey(imgKey + subKey);
    const wts = Math.round(Date.now() / 1000);
    const merged = Object.assign({}, params, { wts });
    const query = Object.keys(merged)
      .sort()
      .map((k) => k + '=' + encodeURIComponent(merged[k]))
      .join('&');
    const w_rid = md5(query + mixinKey);
    return Object.assign({}, merged, { w_rid });
  }

  // ---------- 业务接口 ----------
  // 视频信息（含分P数组 pages）
  async function fetchView(bvid) {
    return apiFetchJson('https://api.bilibili.com/x/web-interface/view', { bvid });
  }

  // UP 主投稿 / 空间搜索（强制 WBI；密钥过期 -403 时重置重试一次）
  async function fetchSpaceVideos(mid, keyword, pn, ps) {
    const params = keyword
      ? { mid, keyword, pn: pn || 1, ps: ps || 30 }
      : { mid, pn: pn || 1, ps: ps || 30 };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const signed = await wbiSign(params);
        return await apiFetchJson('https://api.bilibili.com/x/space/wbi/arc/search', signed);
      } catch (e) {
        if (attempt === 0 && e && e.code === -403) {
          wbiKeys = null; // 密钥可能已轮换，重新获取
          continue;
        }
        throw e;
      }
    }
  }

  // 官方观看历史（分页游标：max 为上一页返回的 cursor.max，首屏省略）
  // 需登录；条目含 title / author_name / bvid / progress(断点秒) / duration / history.{page,part,business,view_at}
  async function fetchHistory(max, ps) {
    const params = { ps: ps || 30 };
    if (max) params.max = max;
    return apiFetchJson('https://api.bilibili.com/x/web-interface/history/cursor', params);
  }

  return {
    apiFetchJson,
    wbiSign,
    fetchView,
    fetchSpaceVideos,
    fetchHistory,
    md5
  };
})();
