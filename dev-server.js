#!/usr/bin/env node
/* Development server: serves the app on http://localhost:8080 and proxies IPTV requests
   (/proxy?url=...) so a desktop browser isn't blocked by CORS. HLS playlists are rewritten so
   their segments also go through the proxy. Not needed on the TV, which has no CORS limits.
   Usage: node dev-server.js [port] */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { spawn, execFile } = require('child_process');

const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const ROOT = __dirname;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.xml': 'text/xml'
};

const proxied = (u) => '/proxy?url=' + encodeURIComponent(u);

function rewritePlaylist(text, base) {
  return text.split(/\r?\n/).map((line) => {
    const t = line.trim();
    if (!t) return line;
    if (t[0] === '#') return line.replace(/URI="([^"]+)"/g, (m, u) => 'URI="' + proxied(new URL(u, base).href) + '"');
    return proxied(new URL(t, base).href);
  }).join('\n');
}

async function proxy(req, res, target) {
  let url;
  try { url = new URL(target); } catch { res.writeHead(400); return res.end('bad url'); }
  if (!/^https?:$/.test(url.protocol)) { res.writeHead(400); return res.end('bad protocol'); }
  try {
    const headers = { 'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) NovaPlayer/1.0' };
    if (req.headers.range) headers.Range = req.headers.range;
    const up = await fetch(url, { headers, redirect: 'follow' });
    const type = up.headers.get('content-type') || '';
    const out = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
    const isPlaylist = /mpegurl/i.test(type) || /\.m3u8($|\?)/i.test(up.url);
    if (isPlaylist) {
      const body = await up.text();
      out['Content-Type'] = 'application/vnd.apple.mpegurl';
      res.writeHead(up.status, out);
      return res.end(body.startsWith('#EXTM3U') ? rewritePlaylist(body, up.url) : body);
    }
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = up.headers.get(h);
      if (v) out[h] = v;
    }
    res.writeHead(up.status, out);
    if (!up.body) return res.end();
    const stream = Readable.fromWeb(up.body);
    stream.on('error', () => res.destroy());
    req.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (e) {
    res.writeHead(502, { 'Access-Control-Allow-Origin': '*' });
    res.end('proxy error: ' + e.message);
  }
}

/* Firefox plays the video of MKV files but not their audio. /remux repackages a file as MP4
   with ffmpeg (streams are copied, not re-encoded) starting at ?t= seconds, and /probe returns
   its length, since a streamed MP4 doesn't carry one. Needs ffmpeg installed. */
function remux(req, res, target, t) {
  if (!/^https?:\/\//.test(target || '')) { res.writeHead(400); return res.end(); }
  const ff = spawn('ffmpeg', ['-v', 'error', '-ss', String(Number(t) || 0), '-i', target,
    '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-f', 'mp4',
    '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1']);
  ff.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('ffmpeg is not installed'); } });
  res.writeHead(200, { 'Content-Type': 'video/mp4', 'Access-Control-Allow-Origin': '*' });
  ff.stdout.pipe(res);
  req.on('close', () => ff.kill('SIGKILL'));
}

function probe(res, target) {
  if (!/^https?:\/\//.test(target || '')) { res.writeHead(400); return res.end(); }
  execFile('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', target], { timeout: 30000 }, (err, out) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ duration: err ? 0 : parseFloat(out) || 0 }));
  });
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/proxy') return proxy(req, res, u.searchParams.get('url'));
  if (u.pathname === '/remux') return remux(req, res, u.searchParams.get('url'), u.searchParams.get('t'));
  if (u.pathname === '/probe') return probe(res, u.searchParams.get('url'));
  const rel = decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname);
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, '127.0.0.1', () => {
  console.log('Nova Player dev server: http://localhost:' + PORT);
});
