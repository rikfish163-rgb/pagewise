import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { register } from 'tsx/esm/api';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

registerHooks({resolve(specifier,context,next){if(specifier.endsWith('.css'))return {url:'data:text/javascript,export {};',shortCircuit:true};return next(specifier,context);}});
register();
const {PersonalApiEditor}=await import('../components/PersonalApi.tsx');
const render=profile=>renderToStaticMarkup(React.createElement(PersonalApiEditor,{profile,onSave(){},onRemove(){},onProfileChange(){}}));
const saved={name:'学习模型',base:'https://api.example.com/v1',protocol:'responses',models:['model-a','model-b'],model:'model-a',vision:true,visionModels:['model-a'],revision:'fixture'};

test('actual editor renders protocol controls, selected model chips and a current default',()=>{
 const html=render(saved);
 for(const name of ['OpenAI 兼容','OpenAI Responses','Anthropic','Gemini'])assert.ok(html.includes(name));
 assert.match(html, /disabled="" title="分类决策接口，不生成学习讲解">System One/);
 assert.equal((html.match(/class="personal-model-chip"/g)||[]).length,2);
 assert.match(html,/value="model-a" selected=""/);
 assert.match(html,/aria-label="显示密钥"/);
 assert.match(html,/type="password"/);
 assert.match(html,/使用已保存配置/);
 assert.match(html,/不重复测试或计费/);
});

test('saved secrets are not accidentally rendered; explicit tests and per-action billing are visible',()=>{
 const html=render({...saved,key:'server-secret-must-not-render'});
 assert.doesNotMatch(html,/server-secret-must-not-render/);
 for(const text of ['连通性','最多发送 4 次文字请求','当前模型测试发送 1 次文字请求','每次测试产生 1 次图片请求费用','重测图片'])assert.ok(html.includes(text));
 const fresh=render(null);assert.match(fresh,/保存时实测默认模型的图片输入/);assert.match(fresh,/1 次随机色卡请求/);assert.match(fresh,/noValidate=""/i);
});

test('masthead actions reserve enough width for their icon and translated label', () => {
 const stylesheet = readFileSync(new URL('../components/personal-api.css', import.meta.url), 'utf8');
 const actionRule = stylesheet.match(/\.masthead \.import-button\s*\{([^}]+)\}/)?.[1];
 assert.ok(actionRule, 'The shared masthead action styles are present');
 assert.match(actionRule, /inline-size\s*:\s*auto\s*;/);
 assert.match(actionRule, /flex-shrink\s*:\s*0\s*;/);
 assert.match(actionRule, /white-space\s*:\s*nowrap\s*;?/);
});
