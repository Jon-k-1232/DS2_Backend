import os
import json
import boto3
import subprocess
import gzip
from datetime import datetime

s3_client = boto3.client('s3')
secrets_client = boto3.client('secretsmanager')
sns_client = boto3.client('sns')

def handler(event, context):
    """
    Lambda handler to backup PostgreSQL database to S3.
    Uses plain SQL format like the local backup script.
    """
    
    # Get environment variables
    db_host = os.environ['DB_HOST']
    db_port = os.environ['DB_PORT']
    db_name = os.environ['DB_NAME']
    db_secret_arn = os.environ['DB_SECRET_ARN']
    s3_bucket = os.environ['S3_BUCKET']
    
    try:
        # Get database credentials from Secrets Manager
        print(f"Retrieving credentials from Secrets Manager: {db_secret_arn}")
        secret_response = secrets_client.get_secret_value(SecretId=db_secret_arn)
        credentials = json.loads(secret_response['SecretString'])
        db_user = credentials['username']
        db_password = credentials['password']
        
        # Generate backup filename with timestamp
        timestamp = datetime.utcnow().strftime('%Y-%m-%d_%H.%M')
        backup_filename = f"{db_name}_backup_{timestamp}.sql"
        backup_filename_gz = f"{backup_filename}.gz"
        local_path = f"/tmp/{backup_filename}"
        local_path_gz = f"/tmp/{backup_filename_gz}"
        
        print(f"Starting backup of database: {db_name}")
        print(f"Database host: {db_host}:{db_port}")
        print(f"Backup file: {backup_filename}")
        
        # Set PostgreSQL password environment variable
        env = os.environ.copy()
        env['PGPASSWORD'] = db_password
        env['PGSSLMODE'] = 'require'  # Require SSL for RDS connection
        
        # Run pg_dump with plain SQL format (like your local script)
        # Using -h, -U, -d flags exactly like your script
        pg_dump_cmd = [
            'pg_dump',  # In PATH from yum install
            '-h', db_host,
            '-p', db_port,
            '-U', db_user,
            '-d', db_name,
            '--no-password',  # Use PGPASSWORD env var
            '-v',  # Verbose output
            '-f', local_path
        ]
        
        print(f"Running command: {' '.join(pg_dump_cmd[:7])}...")  # Don't log credentials
        
        result = subprocess.run(
            pg_dump_cmd,
            env=env,
            capture_output=True,
            text=True,
            timeout=840  # 14 minutes (Lambda has 15 min timeout)
        )
        
        # Log stderr (pg_dump outputs progress to stderr)
        if result.stderr:
            print("pg_dump stderr output:")
            print(result.stderr)
        
        # Check if command failed
        if result.returncode != 0:
            raise Exception(f"pg_dump failed with return code {result.returncode}: {result.stderr}")
        
        # Check if backup file exists and has content
        if not os.path.exists(local_path):
            raise Exception(f"Backup file was not created: {local_path}")
        
        uncompressed_size = os.path.getsize(local_path)
        print(f"Uncompressed backup size: {uncompressed_size} bytes ({uncompressed_size / 1024 / 1024:.2f} MB)")
        
        if uncompressed_size < 1000:  # Less than 1KB is suspicious
            raise Exception(f"Backup file is too small ({uncompressed_size} bytes), likely empty or failed")
        
        # Count tables and sequences in the backup
        with open(local_path, 'r') as f:
            content = f.read()
            table_count = content.count('COPY public.')
            sequence_count = content.count('SELECT pg_catalog.setval')
        
        print(f"Backup contains {table_count} tables with data and {sequence_count} sequences")
        
        # Compress the backup file
        print(f"Compressing backup file...")
        with open(local_path, 'rb') as f_in:
            with gzip.open(local_path_gz, 'wb', compresslevel=9) as f_out:
                f_out.writelines(f_in)
        
        compressed_size = os.path.getsize(local_path_gz)
        compression_ratio = (1 - compressed_size / uncompressed_size) * 100
        print(f"Compressed size: {compressed_size} bytes ({compressed_size / 1024 / 1024:.2f} MB)")
        print(f"Compression ratio: {compression_ratio:.1f}%")
        
        # Upload compressed file to S3
        s3_key = f"weekly/{backup_filename_gz}"
        print(f"Uploading to S3: s3://{s3_bucket}/{s3_key}")
        
        s3_client.upload_file(
            local_path_gz,
            s3_bucket,
            s3_key,
            ExtraArgs={
                'ServerSideEncryption': 'aws:kms',
                'Metadata': {
                    'database': db_name,
                    'timestamp': timestamp,
                    'backup-type': 'weekly',
                    'uncompressed-size': str(uncompressed_size),
                    'compressed-size': str(compressed_size),
                    'table-count': str(table_count),
                    'sequence-count': str(sequence_count)
                }
            }
        )
        
        # Clean up local files
        os.remove(local_path)
        os.remove(local_path_gz)
        
        print(f"✅ Backup completed successfully!")
        print(f"   Database: {db_name}")
        print(f"   Uncompressed: {uncompressed_size / 1024 / 1024:.2f} MB")
        print(f"   Compressed: {compressed_size / 1024 / 1024:.2f} MB")
        print(f"   Tables: {table_count}, Sequences: {sequence_count}")
        print(f"   Location: s3://{s3_bucket}/{s3_key}")
        
        # Send success notification email
        sns_topic_arn = os.environ.get('SNS_TOPIC_ARN')
        if sns_topic_arn:
            email_subject = f"✅ Weekly Backup Success - DS2_Prod Database"
            email_body = f"""Weekly Backup Completed Successfully

Database: {db_name}
Timestamp: {timestamp} UTC
Backup Type: Weekly (Every Sunday at 3 AM UTC)

Backup Statistics:
- Uncompressed Size: {uncompressed_size / 1024 / 1024:.2f} MB ({uncompressed_size:,} bytes)
- Compressed Size: {compressed_size / 1024 / 1024:.2f} MB ({compressed_size:,} bytes)
- Compression Ratio: {compression_ratio:.1f}%
- Tables with Data: {table_count}
- Sequences Preserved: {sequence_count}

Storage Location:
s3://{s3_bucket}/{s3_key}

This backup is a complete point-in-time snapshot and can be restored using:
1. Download: aws s3 cp s3://{s3_bucket}/{s3_key} backup.sql.gz
2. Decompress: gunzip backup.sql.gz
3. Restore: psql -h <host> -U <user> -d {db_name} -f backup.sql

All table data, indexes, sequences, and constraints are preserved.
Next scheduled backup: Next Sunday at 3:00 AM UTC (7:00 PM PST Saturday)
"""
            
            try:
                sns_client.publish(
                    TopicArn=sns_topic_arn,
                    Subject=email_subject,
                    Message=email_body
                )
                print("Success notification email sent")
            except Exception as email_error:
                print(f"Warning: Failed to send success email: {str(email_error)}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Backup completed successfully',
                'database': db_name,
                'uncompressed_size_mb': round(uncompressed_size / 1024 / 1024, 2),
                'compressed_size_mb': round(compressed_size / 1024 / 1024, 2),
                'compression_ratio': round(compression_ratio, 1),
                'table_count': table_count,
                'sequence_count': sequence_count,
                's3_location': f"s3://{s3_bucket}/{s3_key}",
                'timestamp': timestamp
            })
        }
        
    except subprocess.TimeoutExpired:
        error_msg = "Backup timed out after 14 minutes"
        print(f"❌ {error_msg}")
        
        # Send failure notification email
        send_failure_email(db_name, error_msg)
        
        return {
            'statusCode': 500,
            'body': json.dumps({'error': error_msg})
        }
        
    except Exception as e:
        error_msg = f"Backup failed: {str(e)}"
        print(f"❌ {error_msg}")
        
        # Send failure notification email
        send_failure_email(db_name, error_msg)
        
        return {
            'statusCode': 500,
            'body': json.dumps({'error': error_msg})
        }

def send_failure_email(db_name, error_message):
    """Send failure notification via SNS"""
    sns_topic_arn = os.environ.get('SNS_TOPIC_ARN')
    if not sns_topic_arn:
        return
    
    timestamp = datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S')
    
    email_subject = f"❌ Weekly Backup FAILED - DS2_Prod Database"
    email_body = f"""Weekly Backup Failed

Database: {db_name}
Timestamp: {timestamp} UTC
Backup Type: Weekly (Every Sunday at 3 AM UTC)

ERROR DETAILS:
{error_message}

ACTION REQUIRED:
Please investigate the backup failure immediately. Check:
1. Lambda CloudWatch logs: /aws/lambda/ds2-database-backup
2. Database connectivity and credentials
3. S3 bucket permissions
4. Lambda VPC configuration

The backup will be automatically retried next Sunday at 3:00 AM UTC.

If you need to run a manual backup:
aws lambda invoke --function-name ds2-database-backup --region us-west-2 output.json
"""
    
    try:
        sns_client.publish(
            TopicArn=sns_topic_arn,
            Subject=email_subject,
            Message=email_body
        )
        print("Failure notification email sent")
    except Exception as email_error:
        print(f"Warning: Failed to send failure email: {str(email_error)}")
