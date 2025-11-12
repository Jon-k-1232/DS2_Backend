# Database Infrastructure

Single RDS PostgreSQL instance for both dev and prod databases.

## Deployment Order

**This is step 2 of 4** (after S3 buckets are deployed)

## What This Deploys

-  **RDS PostgreSQL** instance (`ds2-shared-db`)
   -  `ds2_dev` database (auto-created on first deployment)
   -  `ds2_prod` database (must be manually created after deployment)
-  **Security Group** for database access
-  **Backup Bucket** (`ds2-pg-backups-prod`) with KMS encryption
-  **Secrets Manager** for database credentials

## Configuration

-  Instance: db.t4g.medium
-  Multi-AZ: Yes
-  Backup Retention: 7 days
-  Storage: 50GB (auto-scaling to 200GB)
-  Final Snapshots: Enabled

## Deploy

```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/database/prod

# Initialize
terraform init

# Plan
terraform plan -var="db_username=jonkimmel" -var="db_password=YOUR_PASSWORD"

# Apply
terraform apply -var="db_username=jonkimmel" -var="db_password=YOUR_PASSWORD"
```

## After Deployment

**Manually create the production database:**

```bash
# Connect to the database
psql -h ds2-shared-db.cm4njfry0xmh.us-west-2.rds.amazonaws.com -U jonkimmel -d ds2_dev

# Create prod database
CREATE DATABASE ds2_prod;

# Exit
\q
```

## Dependencies

-  VPC and subnets must exist
-  S3 buckets should be deployed first

## Outputs

-  `database_endpoint`: RDS endpoint for backend ECS to use
-  `db_security_group_id`: Security group ID for backend ECS to reference
-  `database_secret_arn`: Secrets Manager ARN for credentials
