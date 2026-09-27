'use strict';
// Frozen pre-H10 readers are test-only. Resolve their local dependencies to the
// frozen versions too, without swapping production require.cache entries.
const fs=require('fs'),path=require('path'),Module=require('module'),crypto=require('crypto');
const root=path.resolve(__dirname,'../..');
const manifest=require('../fixtures/h10-baseline/manifest.json'),cache=new Map();
function original(relative){
 const filename=path.resolve(root,relative),key=path.relative(root,filename),entry=manifest[key];
 if(!entry)return require(filename);
 if(cache.has(filename))return cache.get(filename).exports;
 const text=fs.readFileSync(path.join(root,entry.fixture),'utf8');
 if(crypto.createHash('sha256').update(text).digest('hex')!==entry.sha256)throw Error('H10 original source was modified: '+key);
 const mod=new Module(filename,module);mod.filename=filename;mod.paths=Module._nodeModulePaths(path.dirname(filename));cache.set(filename,mod);
 const real=Module.createRequire(filename);
 mod.require=request=>{const resolved=real.resolve(request);return manifest[path.relative(root,resolved)]?original(resolved):real(request);};
 mod._compile(text,filename);return mod.exports;
}
module.exports=original;
