import os
import json
import boto3
import subprocess
from datetime import datetime

s3_client = boto3.client('s3')
secrets_client = boto3.client('secretsmanager')

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
        local_path = f"/tmp/{backup_filename}"
        
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
        
        file_size = os.path.getsize(local_path)
        print(f"Backup file size: {file_size} bytes ({file_size / 1024 / 1024:.2f} MB)")
        
        if file_size < 1000:  # Less than 1KB is suspicious
            raise Exception(f"Backup file is too small ({file_size} bytes), likely empty or failed")
        
        # Upload to S3
        s3_key = f"weekly/{backup_filename}"
        print(f"Uploading to S3: s3://{s3_bucket}/{s3_key}")
        
        s3_client.upload_file(
            local_path,
            s3_bucket,
            s3_key,
            ExtraArgs={
                'ServerSideEncryption': 'aws:kms',
                'Metadata': {
                    'database': db_name,
                    'timestamp': timestamp,
                    'backup-type': 'weekly'
                }
            }
        )
        
        # Clean up local file
        os.remove(local_path)
        
        print(f"✅ Backup completed successfully!")
        print(f"   Database: {db_name}")
        print(f"   Size: {file_size / 1024 / 1024:.2f} MB")
        print(f"   Location: s3://{s3_bucket}/{s3_key}")
        
        return {
            'statusCode': 200,
            'body': json.dumps({
                'message': 'Backup completed successfully',
                'database': db_name,
                'file_size_mb': round(file_size / 1024 / 1024, 2),
                's3_location': f"s3://{s3_bucket}/{s3_key}",
                'timestamp': timestamp
            })
        }
        
    except subprocess.TimeoutExpired:
        error_msg = "Backup timed out after 14 minutes"
        print(f"❌ {error_msg}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': error_msg})
        }
        
    except Exception as e:
        error_msg = f"Backup failed: {str(e)}"
        print(f"❌ {error_msg}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': error_msg})
        }
