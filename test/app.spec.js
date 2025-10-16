const app = require('../src/app');

describe('App bootstrap', () => {
   it('exports an express application instance', () => {
      expect(app).to.be.a('function');
      expect(app.handle).to.be.a('function');
   });
});
