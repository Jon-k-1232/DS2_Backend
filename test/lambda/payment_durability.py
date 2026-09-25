"""Run the real Lambda modules with transaction-aware DB and in-memory S3.
No third-party SDK/config is imported and no network connection is possible.
"""
import importlib.util
import re
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[3] / 'DS2_Lambdas' / 'Process_Payment_Images'

def module(name, **members):
    value = types.ModuleType(name)
    value.__dict__.update(members)
    sys.modules[name] = value
    return value

def load(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value

class Connection:
    def __init__(self):
        self.pending = {}
        self.committed = {}
        self.closed = self.cursor_closed = False
        self.rowcount = 0
        self.fail_commit = False
    def cursor(self):
        return self
    def execute(self, sql, params):
        if params[10] == 'bad-date':
            raise ValueError('invalid payment date')
        key = (params[16], params[0], str(params[3]))
        self.rowcount = 0 if key in self.committed or key in self.pending else 1
        if self.rowcount:
            self.pending[key] = params
    def commit(self):
        if self.fail_commit:
            raise RuntimeError('commit unavailable')
        self.committed.update(self.pending)
        self.pending.clear()
    def rollback(self):
        self.pending.clear()
    def close(self):
        # Cursor and connection share the fake; both close calls are counted.
        if self.cursor_closed:
            self.closed = True
        self.cursor_closed = True

class PaymentHarness(unittest.TestCase):
    def setUp(self):
        self.conn = Connection()
        self.log = Mock()
        self.config = module('config', logger=self.log, DB_HOST='127.0.0.1', DB_NAME='ds2_local',
            DB_USER='ds2', DB_PASSWORD='ds2local', DB_ACCOUNT_ID='9001', ACCOUNT_ID='9001',
            CREATED_BY_USER_ID='90013', S3_BUCKET_NAME='ds2-local',
            S3_PENDING_PREFIX='fixture/pending', S3_BASE_PREFIX='fixture/processed',
            SUPPORTED_EXTENSIONS={'.csv','.pdf','.jpg','.jpeg'}, STAGE='prod',
            USE_BEDROCK_EXTRACTION=False, load_secrets=lambda: None)
        module('psycopg2', connect=lambda **kw: self.conn, OperationalError=RuntimeError)
        self.s3 = Mock()
        self.s3.head_object.side_effect = lambda **kw: {'ContentLength': len(self.archives[kw['Key']])}
        self.archives = {}
        self.pending = {}
        self.deleted = []
        self.s3.upload_file.side_effect = lambda filename, bucket, key: self.archives.__setitem__(key,Path(filename).read_bytes())
        self.s3.delete_object.side_effect = self.delete
        module('aws_clients', get_s3_client=lambda: self.s3)
        module('filename_parser', DATE_RE=re.compile(r'^(\d{2})-(\d{2})-(\d{4})'),
            parse_filename_payments=lambda fp: [], parse_dollar_amount=lambda s: float(s) if s else None,
            PAYMENT_METHOD_NORMALIZED={'check':'Check'})
        module('reference_finder', ACCOUNT_ROUTING_RE=re.compile(r'never-matches'), find_reference_numbers=lambda *args,**kw: [])
        module('ocr', extract_text=lambda fp:'', redact_check_pdf=lambda fp: None)
        module('pii', anonymize_text_keep_names=lambda s:s, redact_numeric_pii=lambda s:s)
        module('llm', bedrock_extract_payments=lambda *args: [])
        module('customer_matching', match_customers=lambda *args,**kw: None)
        self.db = load('database')
        self.ops = load('s3_ops')
        self.pipeline = load('pipeline')
        self.pipeline.load_customers_from_rds = lambda: []
        self.pipeline.download_single_from_s3 = self.download
        self.tmp_dirs = []
    def tearDown(self):
        import shutil
        for folder in self.tmp_dirs:
            shutil.rmtree(folder, ignore_errors=True)
    def delete(self, **kw):
        self.deleted.append(kw['Key'])
        self.pending.pop(kw['Key'],None)
    def download(self, key, folder):
        self.tmp_dirs.append(folder)
        target=folder/Path(key).name
        target.write_bytes(self.pending[key])
        return target
    def payment(self, name, date='2026-09-01'):
        return {'customer_name': name, 'payment_amount':10, 'source_file':'deposit.csv',
            'payment_date':date,'customer_id':900101,'matched_customer_id':900101,
            'customer_invoice_id':'','customer_job_id':'','retainer_id':''}
    def input_csv(self, bad=False):
        key='fixture/pending/deposit.csv'
        self.pending[key]=('customer_name,payment_amount,payment_date\ngood-A,10,2026-09-01\n'
            + ('bad-B,20,bad-date\n' if bad else '') + 'good-C,30,2026-09-01\n').encode()
        return key

class F5Cases(PaymentHarness):
    def test_bad_middle_row_aborts_entire_batch_and_closes_resources(self):
        with self.assertRaisesRegex(ValueError,'invalid payment date'):
            self.db.write_to_rds([self.payment('A'),self.payment('B','bad-date'),self.payment('C')])
        self.assertEqual(self.conn.committed,{})
        self.assertEqual(self.conn.pending,{})
        self.assertTrue(self.conn.closed)
        self.assertFalse(any(str(c.args[0]).startswith('Wrote') for c in self.log.info.call_args_list))
    def test_failed_import_never_archives_or_deletes_source(self):
        key=self.input_csv(bad=True)
        with self.assertRaisesRegex(ValueError,'invalid payment date'):
            self.pipeline.main(key)
        self.assertIn(key,self.pending)
        self.assertEqual(self.archives,{})
        self.assertEqual(self.deleted,[])
        self.assertEqual(self.conn.committed,{})
    def test_reports_only_committed_inserts_and_retry_is_idempotent(self):
        rows=[self.payment('A'),self.payment('C')]
        rows[0]['customer_id']=None
        self.assertEqual(self.db.write_to_rds(rows),2)
        self.assertEqual(len(self.conn.committed),2)
        self.log.info.reset_mock()
        self.assertEqual(self.db.write_to_rds(rows),0)
        self.assertEqual(len(self.conn.committed),2)
        self.assertFalse(any("written with no customer match" in str(c.args[0]) for c in self.log.info.call_args_list))
    def test_commit_failure_keeps_pending_source_and_rolls_back(self):
        key=self.input_csv()
        self.conn.fail_commit=True
        with self.assertRaisesRegex(RuntimeError,'commit unavailable'):
            self.pipeline.main(key)
        self.assertIn(key,self.pending)
        self.assertEqual(self.conn.pending,{})
        self.assertEqual(self.archives,{})
        self.assertTrue(self.conn.closed)
    def test_missing_database_configuration_cannot_acknowledge_an_import(self):
        self.config.DB_HOST=''
        with self.assertRaisesRegex(RuntimeError,'configured'):
            self.db.write_to_rds([self.payment('A')])

class F6Cases(PaymentHarness):
    def test_upload_failure_retains_pending_source_and_is_retryable(self):
        key=self.input_csv()
        self.s3.upload_file.side_effect=OSError('archive unavailable')
        with self.assertRaisesRegex(RuntimeError,'archive|move'):
            self.pipeline.main(key)
        self.assertIn(key,self.pending)
        self.assertEqual(self.deleted,[])
        self.assertEqual(len(self.conn.committed),2)
        self.s3.upload_file.side_effect=lambda filename,bucket,key: self.archives.__setitem__(key,Path(filename).read_bytes())
        self.pipeline.main(key)
        self.assertNotIn(key,self.pending)
        self.assertEqual(len(self.conn.committed),2)
        self.assertEqual(len(self.archives),1)
    def test_head_failure_cannot_delete_pending_source(self):
        key=self.input_csv()
        self.s3.head_object.side_effect=OSError('archive HEAD unavailable')
        with self.assertRaisesRegex(RuntimeError,'archive|move'):
            self.pipeline.main(key)
        self.assertIn(key,self.pending)
        self.assertEqual(self.deleted,[])
    def test_wrong_archive_size_cannot_delete_pending_source(self):
        key=self.input_csv()
        self.s3.head_object.side_effect=None
        self.s3.head_object.return_value={'ContentLength':0}
        with self.assertRaisesRegex(RuntimeError,'archive|move'):
            self.pipeline.main(key)
        self.assertIn(key,self.pending)
        self.assertEqual(self.deleted,[])
    def test_missing_bucket_cannot_acknowledge_an_archive(self):
        key=self.input_csv()
        self.ops.S3_BUCKET_NAME=''
        with self.assertRaisesRegex(RuntimeError,'archive|move'):
            self.pipeline.main(key)
        self.assertIn(key,self.pending)
        self.assertEqual(self.deleted,[])
    def test_batch_keeps_failed_source_and_archives_other_committed_files(self):
        first=self.input_csv()
        second='fixture/pending/other.csv'
        self.pending[second]=self.pending[first]
        self.pipeline.download_from_s3_pending=lambda folder:[self.download(key,folder) for key in list(self.pending)]
        def upload(filename,bucket,key):
            if key.endswith('/deposit.csv'):
                raise OSError('archive unavailable')
            self.archives[key]=Path(filename).read_bytes()
        self.s3.upload_file.side_effect=upload
        with self.assertRaisesRegex(RuntimeError,'archive|move'):
            self.pipeline.main()
        self.assertIn(first,self.pending)
        self.assertNotIn(second,self.pending)
        self.assertEqual(self.deleted,[second])
    def test_redacted_pdf_is_verified_before_source_deletion(self):
        key='fixture/pending/check.pdf'
        self.pending[key]=b'original-check'
        self.pipeline.parse_filename_payments=lambda fp:[self.payment('A')]
        self.pipeline.redact_check_pdf=lambda fp:fp.write_bytes(b'redacted-check')
        self.pipeline.main(key)
        self.assertEqual(list(self.archives.values()),[b'redacted-check'])
        calls=[c[0] for c in self.s3.mock_calls]
        self.assertIn('head_object',calls)
        self.assertLess(calls.index('head_object'),calls.index('delete_object'))
        self.assertNotIn(key,self.pending)
    def test_image_archive_failure_also_preserves_pending_source(self):
        key='fixture/pending/check.jpg'
        self.pending[key]=b'image'
        self.pipeline.parse_filename_payments=lambda fp:[self.payment('A')]
        self.s3.upload_file.side_effect=OSError('archive unavailable')
        with self.assertRaisesRegex(RuntimeError,'archive|move'):
            self.pipeline.main(key)
        self.assertIn(key,self.pending)
        self.assertEqual(self.deleted,[])
    def test_lambda_handler_raises_for_async_event_retry(self):
        key=self.input_csv()
        self.s3.upload_file.side_effect=OSError('archive unavailable')
        handler=load('process_payments')
        with self.assertRaisesRegex(RuntimeError,'archive|move'):
            handler.lambda_handler({'Records':[{'s3':{'bucket':{'name':'ds2-local'},'object':{'key':key}}}]},None)
        self.assertIn(key,self.pending)

if __name__ == '__main__':
    unittest.main()
