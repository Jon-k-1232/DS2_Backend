#!/bin/bash
# Import existing AWS resources into Terraform state
# This prevents Terraform from trying to create resources that already exist

set -e

echo "🔍 Checking for existing RDS instance..."
EXISTING_RDS=$(aws rds describe-db-instances \
  --db-instance-identifier ds2-shared-db \
  --query 'DBInstances[0].DBInstanceIdentifier' \
  --output text 2>/dev/null || echo "")

if [ "$EXISTING_RDS" == "ds2-shared-db" ]; then
  echo "✅ Found existing RDS: ds2-shared-db"
  echo "⚠️  WARNING: Your Terraform config will try to CREATE this database."
  echo ""
  echo "You have two options:"
  echo ""
  echo "Option 1: Import the existing RDS into Terraform (RECOMMENDED)"
  echo "  terraform import module.database.aws_db_instance.this ds2-shared-db"
  echo ""
  echo "Option 2: Use data source to reference existing RDS (SAFER)"
  echo "  Modify Terraform to use 'data' block instead of creating new resource"
  echo ""
  read -p "Do you want to import the existing RDS? (y/n): " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Importing RDS instance..."
    cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/envs/dev
    terraform import module.database.aws_db_instance.this ds2-shared-db
    echo "✅ Import complete!"
  fi
else
  echo "ℹ️  No existing RDS found. Terraform will create a new one."
fi

echo ""
echo "📋 Summary of what will be deployed:"
echo "  - Application Load Balancer (ALB)"
echo "  - ECS Cluster"
echo "  - ECS Service (Fargate)"
echo "  - CloudWatch Log Groups"
echo "  - S3 Backup Bucket"
echo "  - Secrets Manager secrets"
echo "  - Route53 Private Zone"
echo "  - Security Groups"
echo "  - IAM Roles"
echo ""
echo "💰 Estimated additional monthly cost: \$50-70"
