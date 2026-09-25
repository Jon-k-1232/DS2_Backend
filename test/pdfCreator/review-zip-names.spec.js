const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const unzipper = require('unzipper');

describe('F33 unique archive member names', () => {
   for (const folder of ['drafts', 'invoice_images']) it(`preserves same-name and normalized-name customer files in ${folder}`, async () => {
      let saved;
      const filename = path.resolve(__dirname, '../../src/pdfCreator/zipOrchestrator.js');
      const mod = { exports: {} }, nativeRequire = createRequire(filename);
      vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, Buffer, console,
         require: name => name === '../utils/s3' ? { putObject: async (key, buffer) => { saved = buffer; } } : nativeRequire(name) }, { filename });
      const inputs = ['Same_Name', 'Same_Name', 'Same/Name', 'Same\\Name'].map((displayName, i) => ({
         buffer: Buffer.from(`PDF ${i}`), metadata: { displayName, customerID: 900101 + i, type: 'pdf' }
      }));
      await mod.exports.createAndSaveZip(inputs, { storage_slug: 'fixture' }, folder, 'batch.zip');
      const zip = await unzipper.Open.buffer(saved);
      expect(new Set(zip.files.map(f => f.path.toLowerCase())).size).to.equal(inputs.length);
      for (const [i, file] of zip.files.entries()) {
         expect(file.path).to.include(String(900101 + i));
         expect(file.path).not.to.match(/[\\/]/);
         expect((await file.buffer()).equals(inputs[i].buffer)).to.equal(true);
      }
   });
});
