# DS2 Backend ECS Deployment Guide

## Prerequisites Checklist
- [x] AWS Account ID: `561979538576`
- [x] RDS Database: `ds2-shared-db` (already exists)
- [x] VPC: `vpc-04f4c4cf527f99b9a` (already exists)
- [x] Private Subnets: 2 subnets (already exist)
- [ ] ECR Repositories (need to create)
- [ ] Docker Images (need to build and push)
- [ ] Terraform variables file (need to create)

## Step-by-Step Deployment

### Step 1: Create terraform.tfvars File

You need to create a `terraform.tfvars` file in `/DS2/DS2_Backend/terraform/envs/dev/` with these required variables:

```hcl
# Database credentials (use existing credentials from .env)
db_username = "jonkimmel"
db_password = "1qaz2WSX+&JKAJ"

# Docker images (will be updated after pushing to ECR)
frontend_image = "561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-frontend:dev"
backend_image  = "561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-backend:dev"

# Optional overrides (already have good defaults)
# db_instance_class = "db.t4g.micro"
# alert_email = "networknotifications@kimmeloffice.com"
```

### Step 2: Create ECR Repositories

```bash
# Create backend repository
aws ecr create-repository \
  --repository-name ds2-backend \
  --region us-west-2 \
  --image-scanning-configuration scanOnPush=true

# Create frontend repository  
aws ecr create-repository \
  --repository-name ds2-frontend \
  --region us-west-2 \
  --image-scanning-configuration scanOnPush=true
```

### Step 3: Build and Push Docker Images

#### Backend Image:
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend

# Login to ECR
aws ecr get-login-password --region us-west-2 | \
  docker login --username AWS --password-stdin 561979538576.dkr.ecr.us-west-2.amazonaws.com

# Build image
docker build -t ds2-backend:dev .

# Tag for ECR
docker tag ds2-backend:dev 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-backend:dev

# Push to ECR
docker push 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-backend:dev
```

#### Frontend Image:
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/Nginx

# Build image
docker build -t ds2-frontend:dev .

# Tag for ECR
docker tag ds2-frontend:dev 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-frontend:dev

# Push to ECR
docker push 561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-frontend:dev
```

### Step 4: Initialize Terraform

```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/envs/dev

# Initialize Terraform
terraform init

# Review the plan
terraform plan -out=dev.plan
```

### Step 5: Deploy Infrastructure

```bash
# Apply the Terraform configuration
terraform apply dev.plan
```

## What Will Be Deployed

### Infrastructure Resources:
1. **ALB (Application Load Balancer)** - ~$16/month
   - Internal load balancer for routing traffic
   - SSL/TLS certificate via ACM
   
2. **ECS Cluster** - Free (just a logical grouping)

3. **ECS Service (Fargate)** - ~$15-20/month
   - 1 task with 256 CPU, 512 MB memory
   - Running 24/7: ~$0.04048/hour = ~$29/month
   - Contains 2 containers: nginx (frontend) + Node.js (backend)

4. **RDS Database** - Already exists
   - Won't create a new one (uses existing `ds2-shared-db`)

5. **S3 Backup Bucket** - Minimal cost
   - For database backups

6. **CloudWatch Logs** - ~$5/month
   - Log retention: 30 days

7. **Secrets Manager** - ~$0.80/month
   - Stores JWT secret and DB credentials

8. **Route53 Private Hosted Zone** - $0.50/month
   - Internal DNS: `dev-ds2.kimmelOffice.internal`

9. **Security Groups, IAM Roles** - Free

### Total Additional Monthly Cost: ~$50-70/month

### Combined with existing infrastructure:
- Existing: $381-444/month (VPN, AD, NAT, RDS)
- New: $50-70/month (ALB, ECS, etc.)
- **Total: $431-514/month**

## Environment Variables

The application environment variables are passed to ECS in two ways:

### 1. Plain Environment Variables (main.tf line 163):
```terraform
environment = { NODE_ENV = "development" }
```

### 2. Secrets from AWS Secrets Manager:
```terraform
secrets = {
  DB_SECRET  = module.database.secret_arn
  JWT_SECRET = aws_secretsmanager_secret.app_jwt.arn
}
```

The ECS task will automatically:
- Pull DB credentials from Secrets Manager (username, password, host, port, database)
- Pull JWT secret from Secrets Manager
- Set NODE_ENV=development

### Additional Environment Variables Needed

You'll need to add more environment variables to the ECS service. Edit `main.tf` around line 163:

```terraform
environment = {
  NODE_ENV           = "development"
  NODE_PORT_DEV      = "8080"
  DOMAIN             = "kimmeloffice.internal"
  FROM_EMAIL         = "NetworkNotifications@kimmelOffice.com"
  FROM_EMAIL_USERNAME = "UDM@KimmelOffice.com"
  FROM_EMAIL_SMTP    = "smtp.mail.us-west-2.awsapps.com"
  S3_REGION          = "us-west-2"
  S3_BUCKET_NAME     = "ds2-dev-561979538576"
  S3_ENDPOINT        = "https://bucket.vpce-03afe8ea29a768fbe-z7qhjgd9.s3.us-west-2.vpce.amazonaws.com"
  S3_ACCESS_KEY_ID   = "AKIAYFWEXHSINXWUBJDP"
  # Add more as needed
}
```

**For sensitive values like passwords and API keys**, add them to Secrets Manager instead:

```bash
# Example: Add email password to Secrets Manager
aws secretsmanager create-secret \
  --name backend/dev/FROM_EMAIL_PASSWORD \
  --secret-string '{"value":"3wsx5TGB+&JKAJ"}' \
  --region us-west-2

# Then reference in Terraform:
resource "aws_secretsmanager_secret" "email_password" {
  name = "backend/dev/FROM_EMAIL_PASSWORD"
}

# Add to secrets map:
locals {
  ecs_secrets = {
    DB_SECRET             = module.database.secret_arn
    JWT_SECRET            = aws_secretsmanager_secret.app_jwt.arn
    FROM_EMAIL_PASSWORD   = aws_secretsmanager_secret.email_password.arn
    S3_SECRET_ACCESS_KEY  = aws_secretsmanager_secret.s3_secret.arn
  }
}
```

## Testing the Deployment

After deployment:

1. **Get the ALB DNS name:**
   ```bash
   terraform output alb_dns_name
   ```

2. **Check ECS service status:**
   ```bash
   aws ecs describe-services \
     --cluster ds2-dev-cluster \
     --services ds2-dev-service \
     --query 'services[0].{Status:status,Running:runningCount,Desired:desiredCount}'
   ```

3. **View logs:**
   ```bash
   # API logs
   aws logs tail /aws/ecs/ds2-dev-service-api --follow
   
   # Nginx logs
   aws logs tail /aws/ecs/ds2-dev-service-nginx --follow
   ```

4. **Test the application:**
   ```bash
   # From within your VPN
   curl http://dev-ds2.kimmelOffice.internal/api/healthz
   ```

## Rollback Plan

If something goes wrong:
```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/envs/dev
terraform destroy
```

This will only destroy the new resources (ALB, ECS, etc.) and leave your existing infrastructure (VPN, AD, NAT, RDS) intact.

## Next Steps After Successful Deployment

1. Run database migrations to create tables
2. Test API endpoints
3. Deploy frontend application
4. Set up CI/CD pipeline for automated deployments
