import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeLocale, translate, translateError} from '../lib/i18n.js';
const dict = Object.fromEntries(['en','zh','zh-Hant'].map(locale=>[locale,JSON.parse(readFileSync(new URL(`../locale/${locale}.json`,import.meta.url)))]));
test('locale normalization distinguishes Simplified and Traditional Chinese',()=>{
 for(const locale of ['zh','zh-CN','zh-SG','zh-Hans']) assert.equal(normalizeLocale(locale),'zh');
 for(const locale of ['zh-TW','zh-HK','zh-Hant']) assert.equal(normalizeLocale(locale),'zh-Hant');
 for(const locale of ['en-US','fr',undefined]) assert.equal(normalizeLocale(locale),'en');
});
test('all languages have complete, matching placeholder dictionaries',()=>{
 for(const locale of ['zh','zh-Hant']) {
  assert.deepEqual(Object.keys(dict[locale]).sort(),Object.keys(dict.en).sort());
  for(const [key,value] of Object.entries(dict[locale])) assert.deepEqual((value.match(/\{\d+\}/g)||[]).sort(),(dict.en[key].match(/\{\d+\}/g)||[]).sort(),key);
 }
});
test('reported owner/guest labels, errors, and names use explicit locale',()=>{
 assert.equal(translate('zh','分享這個對話'),'分享这个对话');
 assert.equal(translate('en','分享這個對話'),'Share this conversation');
 assert.equal(translate('zh-Hant','分享這個對話'),'分享這個對話');
 assert.equal(translate('zh','以「{0}」加入',['繁體姓名 <Alice>']),'以「繁體姓名 <Alice>」加入');
 assert.equal(translateError('en','訊息需要 1 到 4000 個字。'),'Messages must contain 1–4000 characters.');
 assert.equal(translateError('zh','分享已結束。'),'分享已结束。');
 assert.equal(translateError('en','user content 複製'),'user content 複製');
});
test('owner reacts to DSH preference; guest retains locale when removing invite secret',()=>{
 const client=readFileSync(new URL('../src/client.js',import.meta.url),'utf8');
 const guest=readFileSync(new URL('../src/guest.js',import.meta.url),'utf8');
 assert.match(client,/localeService = ctx.locale/);
 assert.match(client,/useSyncExternalStore\(callback => localeService\?\.subscribe/);
 assert.match(guest,/history.replaceState\(null, '', localized\(base\)\)/);
 assert.match(guest,/document.documentElement.lang = locale/);
});
