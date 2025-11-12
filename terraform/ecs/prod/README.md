# Backend ECS Infrastructure

Deploys the backend application on ECS with ALB, including all supporting infrastructure.

## Deployment Order

**This is step 3 of 4** (after S3 and Database are deployed)

## What This Deploys

-  **Application Load Balancer** (ALB) with HTTPS/TLS
-  **ECS Cluster** for backend services
-  **ECS Service** running backend containers
-  **Security Groups** for ALB and ECS tasks
-  **Route53** DNS record for the application
-  **Secrets Manager** for JWT secret
-  **SNS Topic** for CloudWatch alarms
-  **IAM Roles** for ECS tasks and execution

## Prerequisites

1. **S3 buckets** must be deployed (step 1)
2. **Database** must be deployed (step 2)
3. **Docker images** must be built and pushed to ECR:
   -  Backend API image
   -  Nginx proxy image

## Configuration

-  ECS Tasks: 2 desired count
-  CPU: 512 units
-  Memory: 1024 MB
-  Auto-scaling: CloudWatch alarms configured
-  Database: References remote state from database terraform

## Deploy

```bash
cd /Users/jonkimmel/Desktop/Code/JKA_stuff/DS2/DS2_Backend/terraform/ecs/prod

# Initialize
terraform init

# Plan
terraform plan

# Apply
terraform apply
```

## ECR Images

Update these image URIs in `variables.tf` after building:

-  `backend_image`: Your backend API container
-  `nginx_image`: Your Nginx proxy container

## Accessing the Application

After deployment, access via:

-  Internal DNS: `ds2.kimmelOffice.internal`
-  ALB DNS: (see `alb_dns_name` output)

## Dependencies

-  **Database Terraform** remote state for:
   -  Database endpoint
   -  Database credentials secret
   -  Database security group
-  **VPC** and **subnets** must exist
-  **ECR repositories** with pushed images

## Outputs

-  `alb_dns_name`: Load balancer DNS
-  `cluster_name`: ECS cluster name
-  `service_name`: ECS service name
-  `route53_fqdn`: Full application DNS name
