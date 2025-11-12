# ✅ RDS Conflict Resolved - Quick Deploy Guide

## Changes Made

### 1. **Switched from Module to Data Source**
   - ❌ Old: `module "database"` tried to CREATE a new RDS instance
   - ✅ New: `data "aws_db_instance" "existing"` references existing RDS

### 2. **Added All Environment Variables**
   - Non-sensitive vars in `ecs_environment` local
   - Sensitive vars in AWS Secrets Manager
   - All values from your `.env` file are now configured

### 3. **Updated terraform.tfvars**
   - Added API token, email password, S3 credentials
   - All required variables are now defined

## Ready to Deploy!

### Step 1: Create ECR Repositories
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/envs/dev

aws ecr create-repository --repository-name ds2-backend --region us-west-2
aws ecr create-repository --repository-name ds2-frontend --region us-west-2
```

### Step 2: Build & Push Docker Images

**Backend:**
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend

# Login to ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 561979538576.dkr.ecr.us-west-2.amazonaws.com

# Build and push
docker build -t ds2-backend:dev .
docker tag ds2-backend:dev 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-backend:dev
docker push 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-backend:dev
```

**Frontend:**
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/Nginx

# Build and push
docker build -t ds2-frontend:dev .
docker tag ds2-frontend:dev 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-frontend:dev
docker push 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-frontend:dev
```

### Step 3: Deploy Infrastructure
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/envs/dev

# Initialize (if not already done)
terraform init

# Plan (review what will be created)
terraform plan

# Apply (deploy everything)
terraform apply
```

## What Will Be Created

1. ✅ ALB (Application Load Balancer)
2. ✅ ECS Cluster
3. ✅ ECS Service with Fargate tasks
4. ✅ CloudWatch Log Groups
5. ✅ Secrets Manager secrets (DB creds, JWT, app secrets)
6. ✅ S3 Backup Bucket
7. ✅ Route53 Private Hosted Zone
8. ✅ Security Groups
9. ✅ IAM Roles

## What Will NOT Be Created

- ❌ RDS Database (uses existing `ds2-shared-db`)
- ❌ VPC (uses existing VPC)
- ❌ Subnets (uses existing private subnets)
- ❌ NAT Gateway (already exists)

## Environment Variables in ECS

Your application will receive these environment variables:

### From Terraform (Plain Text):
- `NODE_ENV=development`
- `NODE_PORT_DEV=8080`
- `DB_DEV_HOST=ds2-shared-db.cm4njfry0xmh.us-west-2.rds.amazonaws.com`
- `FRONT_END_URL_DEV=http://<alb-dns-name>`
- `HOST_IP_DEV=0.0.0.0`
- `DOMAIN=kimmelOffice.internal`
- `JWT_EXPIRATION=11h`
- `FROM_EMAIL=NetworkNotifications@kimmelOffice.com`
- `FROM_EMAIL_USERNAME=UDM@KimmelOffice.com`
- `FROM_EMAIL_SMTP=smtp.mail.us-west-2.awsapps.com`
- `S3_REGION=us-west-2`
- `S3_BUCKET_NAME=ds2-dev-561979538576`
- `S3_ENDPOINT=https://bucket.vpce-...amazonaws.com`
- `S3_ACCESS_KEY_ID=AKIAYFWEXHSINXWUBJDP`

### From Secrets Manager (Encrypted):
- `DB_SECRET` → Contains: username, password, host, port, database
- `JWT_SECRET` → Contains: random 32-char JWT secret
- `APP_SECRETS` → Contains: API_TOKEN, FROM_EMAIL_PASSWORD, S3_SECRET_ACCESS_KEY

## After Deployment

### Get ALB URL:
```bash
terraform output alb_dns_name
```

### Check ECS Status:
```bash
aws ecs describe-services \
  --cluster ds2-dev-cluster \
  --services ds2-dev-service \
  --region us-west-2
```

### View Logs:
```bash
# API container logs
aws logs tail /aws/ecs/ds2-dev-service-api --follow

# Nginx container logs
aws logs tail /aws/ecs/ds2-dev-service-nginx --follow
```

### Test Application:
```bash
# Connect via VPN first, then:
curl http://dev-ds2.kimmelOffice.internal/api/healthz
```

## Run Database Migrations

After ECS is running:
```bash
# Get the task ID
TASK_ID=$(aws ecs list-tasks --cluster ds2-dev-cluster --service ds2-dev-service --query 'taskArns[0]' --output text | cut -d'/' -f3)

# Execute migrations in the container
aws ecs execute-command \
  --cluster ds2-dev-cluster \
  --task $TASK_ID \
  --container api \
  --interactive \
  --command "npm run migrate"
```

## Monthly Cost Impact

- **RDS:** $30-35 (already existing)
- **New Resources:** $50-70
  - ALB: ~$16/month
  - ECS Fargate: ~$29/month
  - CloudWatch: ~$5/month
  - Secrets Manager: ~$2/month
  - Route53: ~$0.50/month
- **Total New Cost:** ~$50-70/month

## Rollback

If something goes wrong:
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/envs/dev
terraform destroy
```

This will only destroy the new resources. Your existing RDS, VPN, AD, and NAT Gateway will remain untouched.

## Next Steps

1. ✅ Deploy infrastructure with `terraform apply`
2. ✅ Wait for ECS tasks to become healthy (~5 minutes)
3. ✅ Run database migrations
4. ✅ Test API endpoints
5. ✅ Deploy frontend separately (if needed)
