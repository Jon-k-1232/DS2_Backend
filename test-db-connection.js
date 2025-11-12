require('dotenv').config();
const db = require('./src/utils/db');

async function testConnection() {
   console.log('Testing database connection...');
   console.log('Database configuration:');
   console.log('  Host:', process.env.DB_DEV_HOST);
   console.log('  User:', process.env.DATABASE_USER);
   console.log('  Database:', process.env.NODE_ENV === 'production' ? 'ds2_prod' : 'ds2_dev');
   console.log('');

   try {
      // Test basic connection
      await db.raw('SELECT NOW()');
      console.log('✅ Successfully connected to database!');
      
      // Get database version
      const result = await db.raw('SELECT version()');
      console.log('Database version:', result.rows[0].version.split(' ')[0] + ' ' + result.rows[0].version.split(' ')[1]);
      
      // List tables
      const tables = await db.raw(`
         SELECT table_name 
         FROM information_schema.tables 
         WHERE table_schema = 'public' 
         ORDER BY table_name
      `);
      console.log('\nAvailable tables:');
      tables.rows.forEach(row => console.log('  -', row.table_name));
      
      await db.destroy();
      console.log('\n✅ Connection test completed successfully!');
      process.exit(0);
   } catch (error) {
      console.error('❌ Database connection failed:');
      console.error('Error:', error.message);
      if (error.code) {
         console.error('Error code:', error.code);
      }
      await db.destroy();
      process.exit(1);
   }
}

testConnection();
