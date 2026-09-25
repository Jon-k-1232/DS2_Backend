const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createRequire } = require('module');
const express = require('express');

describe('F36 payment PDF upload trigger contract', () => {
   const terraform = fs.readFileSync(path.resolve(__dirname, '../../../../DS2_Lambdas/Process_Payment_Images/terraform/prod/main.tf'), 'utf8');
   const suffix = terraform.match(/filter_suffix\s*=\s*"([^"]+)"/)[1];
   for (const extension of ['pdf', 'PDF', 'PdF']) it(`stores .${extension} with the configured notification suffix and returns that identity`, async () => {
      let saved;
      const filename = path.resolve(__dirname, '../../../src/endpoints/pendingPayments/pendingPayments-router.js');
      const nativeRequire = createRequire(filename), mod = { exports: {} };
      vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: mod, exports: mod.exports, Buffer, process, console,
         require: name => {
            if (name === '../../utils/s3') return { putObject: async (key, bytes) => { saved = { key, bytes }; } };
            if (name === './pendingPayments-service') return { ...nativeRequire(name), PAYMENTS_AUTOMATION_ACCOUNT_ID: 9001, PAYMENTS_PENDING_PREFIX: 'fixture/pending' };
            return nativeRequire(name);
         } }, { filename });
      const app = express();
      app.use((req, res, next) => { req.user = { account_id: 9001, user_id: 90013 }; next(); });
      app.use('/pending-payments', mod.exports);
      const bytes = Buffer.from('%PDF-1.4\nfixture');
      const result = await supertest(app).post('/pending-payments/upload/9001/90013').set('Content-Type', 'application/pdf')
         .set('x-file-name', `receipt.${extension}`).send(bytes);
      expect(result.status).to.equal(200);
      expect(saved.key.endsWith(suffix)).to.equal(true);
      expect(saved.bytes.equals(bytes)).to.equal(true);
      expect(result.body.fileName).to.equal('receipt.pdf');
      expect(result.body.s3Key).to.equal(saved.key);
   });
});
