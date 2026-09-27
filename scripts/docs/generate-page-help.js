'use strict';
const fs=require('fs'),path=require('path');
const {renderHelpMarkdown}=require('../../../DS2_Frontend/src/help/pageHelp');
const target=path.resolve(__dirname,'../../docs/platform/page-help.md');
const content=renderHelpMarkdown();
if(process.argv.includes('--check')){
 if(!fs.existsSync(target) || fs.readFileSync(target,'utf8')!==content){console.error('Page help documentation is out of date. Run node scripts/docs/generate-page-help.js');process.exitCode=1;}
 else console.log('Page help and documentation match.');
}else{fs.writeFileSync(target,content);console.log('Generated '+target);}
