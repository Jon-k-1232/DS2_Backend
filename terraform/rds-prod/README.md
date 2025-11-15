# RDS PostgreSQL Terraform Configuration

This Terraform configuration manages the `ds2-shared-db` RDS PostgreSQL instance.

## Terraform Cloud Workspace

**Workspace:** `ds2-database-prod`  
**Organization:** `Jon_Kimmel`

## Required Variables (Set in Terraform Cloud)

Set these in the Terraform Cloud workspace variables:

-  `vpc_id` = `"vpc-04f4c4cf527f99b9a"`
-  `private_subnet_ids` = `["subnet-0acc9b809e7808b43", "subnet-0e30e764faaeca235"]`
-  `db_security_group_id` = `"sg-01f925e5f259fd55a"`
-  `db_master_username` = (sensitive) - get from Secrets Manager `ds2-shared-db-credentials`
-  `db_master_password` = (sensitive) - get from Secrets Manager `ds2-shared-db-credentials`

## Import Existing RDS Instance

Since the RDS instance already exists, you need to import it into Terraform state:

```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/database/prod

# Initialize Terraform
terraform init

# Import the existing RDS instance
terraform import module.rds_postgres.aws_db_instance.this ds2-shared-db

# Import the subnet group
terraform import module.rds_postgres.aws_db_subnet_group.this ds2-shared-db-subnets

# The Secrets Manager secret already exists with a different name,
# so we need to import or reference the existing one
terraform import module.rds_postgres.aws_secretsmanager_secret.db_password ds2-shared-db-credentials
```

## Features Enabled

-  ✅ CloudWatch Logs Export (postgresql logs)
-  ✅ Performance Insights
-  ✅ Deletion Protection
-  ✅ Encrypted Storage
-  ✅ Automated Backups (7 days retention)
-  ✅ Auto-scaling storage (50 GB → 100 GB max)

## Deployment

After importing and setting variables in Terraform Cloud:

```bash
terraform plan   # Review changes
terraform apply  # Apply configuration
```

## Notes

-  The database contains both `ds2_dev` and `ds2_prod` databases
-  CloudWatch logs will appear in `/aws/rds/instance/ds2-shared-db/postgresql`
-  Current engine version: PostgreSQL 17.6
-  Instance class: db.t4g.small (ARM-based, cost-effective)
