const {renderTableSection}=require('./pdfLayoutHelpers');
function createCorrectionsSection(doc,detail,prefs){
 if(!detail.correctionSummary?.length)return;
 const right=prefs.pageWidth-prefs.rightMargin;
 renderTableSection(doc,detail,prefs,{title:'Corrections and money returned (already reflected in balances)',columns:[
 {header:'Document',x:prefs.leftMargin+10,width:190,cell:r=>`${r.label} ${r.number}${r.originalInvoiceId?` · Invoice #${r.originalInvoiceId}`:""}`},
 {header:'Reason',x:280,width:right-390,cell:r=>r.reason},
 {header:'Amount',x:right-100,width:100,align:'right',cell:r=>Number(r.amount).toFixed(2)}],rows:detail.correctionSummary,subtotalLines:[],describeRow:r=>r.number});
}
module.exports={createCorrectionsSection};
