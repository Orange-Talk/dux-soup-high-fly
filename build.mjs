import * as esbuild from 'esbuild';
import fs from 'fs';
const standalone = process.argv.includes('--standalone');
const peerHost = (process.argv.find((a) => a.startsWith('--peer=')) || '').slice(7);
const r = await esbuild.build({
  define: { __STANDALONE__: standalone ? 'true' : 'false', __PEER_HOST__: JSON.stringify(peerHost) },
  entryPoints: ['src/main.ts'], bundle: true, minify: true, format: 'iife', target: ['es2019', 'safari14'],
  loader: { '.webp': 'dataurl', '.mp3': 'base64', '.json': 'json' }, write: false, legalComments: 'none',
});
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
let tpl = fs.readFileSync('src/template.html', 'utf8');
const f = (p) => fs.readFileSync(p).toString('base64');
const faces = [
  ['Bungee', 400, 'node_modules/@fontsource/bungee/files/bungee-latin-400-normal.woff2'],
  ['Chakra Petch', 500, 'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-500-normal.woff2'],
  ['Chakra Petch', 600, 'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-600-normal.woff2'],
  ['Chakra Petch', 700, 'node_modules/@fontsource/chakra-petch/files/chakra-petch-latin-700-normal.woff2'],
].map(([n, w, p]) => `@font-face{font-family:'${n}';font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${f(p)}) format('woff2')}`).join('');
tpl = tpl.replace('/*__FONTS__*/', faces);
const [a, b] = tpl.split('/*__BUNDLE__*/');
const out = standalone ? (peerHost ? 'dist/standalone-test.html' : 'dist/standalone/index.html') : 'dist/index.html';
let html = a + js + b;
if (standalone) html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="theme-color" content="#07061a"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"><meta name="mobile-web-app-capable" content="yes"></head><body>' + html + '</body></html>';
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, html);
console.log('built', out, (fs.statSync(out).size / 1024 / 1024).toFixed(2), 'MB');
