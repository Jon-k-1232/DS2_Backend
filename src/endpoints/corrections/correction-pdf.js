'use strict';
const PDFDocument=require('pdfkit');
function create({title,number,amount,date,reason,customer,entity,details=[]}){
 return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'LETTER',margin:48,bufferPages:true}),chunks=[];doc.on('data',b=>chunks.push(b));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
 const line=(s,size=11)=>{doc.fontSize(size).fillColor('#172235');const h=doc.heightOfString(String(s),{width:516});if(doc.y+h>680)doc.addPage();doc.text(String(s),{width:516}).moveDown(0.6);};
 line(entity,16);line(title,20);line(number,13);line(customer);line(`Effective date: ${date}`);line(`Amount: ${Number(amount).toLocaleString('en-US',{style:'currency',currency:'USD'})}`,15);details.forEach(d=>line(d));line(`Reason: ${reason}`);line('Finalized and locked. This document preserves the original records and records a separate correction.');
 const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.fontSize(8).text(`${number} | Page ${i+1} of ${pages.count}`,48,735,{lineBreak:false});}doc.end();});
}
module.exports={create};
