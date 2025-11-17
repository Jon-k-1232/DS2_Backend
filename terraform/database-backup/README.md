# DS2 Database Backup

Automated weekly PostgreSQL database backups to S3 using AWS Lambda.

## Features

-  **Weekly backups**: Every Sunday at 3 AM UTC (7 PM PST Saturday)
-  **6-month retention**: Automatic deletion after 180 days
-  **Plain SQL format**: Human-readable dumps that can be restored with `psql`
-  **Versioned storage**: S3 versioning enabled for additional protection
-  **KMS encryption**: All backups encrypted at rest
-  **PostgreSQL 17 compatible**: Uses matching pg_dump version

## Backup Format

Backups are created in **plain SQL format** (not custom binary format), exactly like your local backup script. This means:

-  Files are human-readable SQL statements
-  Can be restored with `psql` command
-  Easy to inspect and verify content
-  Slightly larger file size but more portable

## Cost Estimate

For a 50GB database:

-  **Backup frequency**: 4-5 backups per month (weekly)
-  **Retention**: 6 months = ~24 backups stored
-  **Total storage**: 24 × 50GB = 1,200GB
-  **S3 cost**: 1,200GB × $0.023/GB = **~$27.60/month**
-  **Lambda cost**: ~$0.10/month (negligible)
-  **Total**: ~$28/month

## Deployment

1. Initialize Terraform:

```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/database-backup
terraform init
```

2. Build and push Docker image:

```bash
# Get ECR login
aws ecr get-login-password --region us-west-2 | docker login --username AWS --password-stdin 561979538576.dkr.ecr.us-west-2.amazonaws.com

# Build image
docker build --platform linux/amd64 -t ds2-database-backup-lambda .

# Tag image
docker tag ds2-database-backup-lambda:latest 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-database-backup-lambda:latest

# Push image
docker push 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-database-backup-lambda:latest
```

3. Deploy infrastructure:

```bash
terraform apply
```

## Manual Backup

To trigger a backup manually:

```bash
aws lambda invoke --function-name ds2-database-backup --region us-west-2 response.json
cat response.json
```

## Restore From Backup

1. Download backup from S3:

```bash
aws s3 cp s3://ds2-database-backups-prod/weekly/ds2_prod_backup_2025-11-16_03.00.sql ./restore.sql
```

2. Restore to database:

```bash
psql -h ds2-shared-db.cm4njfry0xmh.us-west-2.rds.amazonaws.com -U jonkimmel -d ds2_prod < restore.sql
```

## Monitoring

Check Lambda logs:

```bash
aws logs tail /aws/lambda/ds2-database-backup --follow --region us-west-2
```

List backups:

```bash
aws s3 ls s3://ds2-database-backups-prod/weekly/
```

## Key Differences from Previous Attempt

1. **Plain SQL format** instead of custom binary format (`-F c`)
2. **Larger memory** allocation (2GB vs 1GB) for better performance
3. **Verbose logging** to troubleshoot any issues
4. **File size validation** to ensure backup has content
5. **Exact same pg_dump flags** as your working local script
