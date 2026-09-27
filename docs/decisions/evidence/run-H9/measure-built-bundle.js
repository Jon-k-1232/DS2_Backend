'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib');
const root=path.resolve(__dirname,'../../../../..'),build=path.join(root,'DS2_Frontend/build');
const manifest=JSON.parse(fs.readFileSync(path.join(build,'asset-manifest.json')));
const chunks=fs.readdirSync(path.join(build,'static/js')).filter(f=>f.endsWith('.js')).map(file=>{const data=fs.readFileSync(path.join(build,'static/js',file));return {file,bytes:data.length,gzip:zlib.gzipSync(data).length};});
const initial=chunks.filter(c=>manifest.entrypoints.includes('static/js/'+c.file));
const result={measuredAt:new Date().toISOString(),compression:'Node zlib gzip default level 6, identical to baseline',entrypoints:initial,chunks,totalBytes:chunks.reduce((n,c)=>n+c.bytes,0),totalGzip:chunks.reduce((n,c)=>n+c.gzip,0),initialBytes:initial.reduce((n,c)=>n+c.bytes,0),initialGzip:initial.reduce((n,c)=>n+c.gzip,0)};
fs.writeFileSync(path.join(root,'DS2_Backend/docs/decisions/evidence/run-H9/bundle-after.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,chunks:result.chunks.filter(c=>!c.file.startsWith('main.')).sort((a,b)=>b.bytes-a.bytes).slice(0,6)},null,2));
