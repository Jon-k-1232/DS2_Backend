import subprocess,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parents[2]
out=root/'docs/decisions/evidence/run-H8'
tables=['customers','customer_transactions','customer_payments','customer_writeoffs','customer_invoices','timesheet_entries','users']
def query(db,q):
 return subprocess.check_output(['psql','-X','-h','127.0.0.1','-p','5433','-U','ds2','-d',db,'-v','ON_ERROR_STOP=1','-qAt','-c',q],env={**__import__('os').environ,'PGPASSWORD':'ds2local','PGOPTIONS':'-c default_transaction_read_only=on'},text=True).strip()
current={t:json.loads(query('ds2_local',f"SELECT json_build_object('count',count(*),'digest',md5(string_agg(row_to_json(t)::text,E'\\n' ORDER BY row_to_json(t)::text))) FROM public.{t} t WHERE account_id=1")) for t in tables+['audit_events','audit_chain_heads','recurring_customers','customer_retainers_and_prepayments','customer_jobs']}
reference={t:int(query('ds2_ref_20260922',f'SELECT count(*) FROM public.{t} WHERE account_id=1')) for t in tables}
assert all(current[t]['count']==reference[t] for t in tables)
result={'current':current,'readOnlyReference':reference,'referenceConnection':'127.0.0.1:5433/ds2_ref_20260922; default_transaction_read_only=on','matches':True}
(out/f'account1-{sys.argv[1]}.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))

if sys.argv[1]=='after':
 before=json.loads((out/'account1-before.json').read_text())
 assert result['current']==before['current'], 'Protected account changed'
 audit=json.loads(query('ds2_local','SELECT ds2_verify_audit(1)'))
 (out/'account1-audit.json').write_text(json.dumps(audit,indent=2)+'\n')
 print(json.dumps(audit))
