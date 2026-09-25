const { spawnSync } = require('child_process');
const path = require('path');
const cases = {
 F5Cases: [
  'bad_middle_row_aborts_entire_batch_and_closes_resources',
  'failed_import_never_archives_or_deletes_source',
  'reports_only_committed_inserts_and_retry_is_idempotent',
  'commit_failure_keeps_pending_source_and_rolls_back',
  'missing_database_configuration_cannot_acknowledge_an_import'
 ],
 F6Cases: [
  'upload_failure_retains_pending_source_and_is_retryable',
  'head_failure_cannot_delete_pending_source',
  'wrong_archive_size_cannot_delete_pending_source',
  'missing_bucket_cannot_acknowledge_an_archive',
  'batch_keeps_failed_source_and_archives_other_committed_files',
  'redacted_pdf_is_verified_before_source_deletion',
  'image_archive_failure_also_preserves_pending_source',
  'lambda_handler_raises_for_async_event_retry'
 ]
};
for (const [suite, tests] of Object.entries(cases)) describe(`${suite} payment-image Lambda durability (real Python modules, fake I/O)`, function () {
 this.timeout(10000);
 for (const test of tests) it(test, () => {
  const result = spawnSync('python3', [path.join(__dirname,'payment_durability.py'), `${suite}.test_${test}`],
   { encoding:'utf8', timeout:8000, env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'} });
  expect(result.error, 'Python subprocess').to.be.undefined;
  expect(result.status, result.stdout + result.stderr).to.equal(0);
 });
});
