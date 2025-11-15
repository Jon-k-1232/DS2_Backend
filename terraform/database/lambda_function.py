import os
import boto3
import subprocess
import datetime

def lambda_handler(event, context):
    host = os.environ['PGHOST']
    port = os.environ.get('PGPORT', '5432')
    user = os.environ['PGUSER']
    password = os.environ['PGPASSWORD']
    dbname = os.environ['PGDATABASE']
    s3_bucket = os.environ['S3_BUCKET']

    today = datetime.datetime.utcnow().strftime('%Y-%m-%d')
    s3_key = f"pg_backups/{dbname}_{today}.sql.gz"
    dump_file = f"/tmp/{dbname}_{today}.sql.gz"

    dump_cmd = [
        'pg_dump',
        '-h', host,
        '-p', port,
        '-U', user,
        dbname
    ]
    env = os.environ.copy()
    env['PGPASSWORD'] = password

    with open(dump_file, 'wb') as f:
        proc = subprocess.Popen(dump_cmd, stdout=subprocess.PIPE, env=env)
        gzip_proc = subprocess.Popen(['gzip'], stdin=proc.stdout, stdout=f)
        proc.stdout.close()
        gzip_proc.communicate()

    s3 = boto3.client('s3')
    s3.upload_file(dump_file, s3_bucket, s3_key)

    return {
        'statusCode': 200,
        'body': f"Backup uploaded to s3://{s3_bucket}/{s3_key}"
    }
