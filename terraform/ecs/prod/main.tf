locals {
  name_prefix = "ds2-prod-backend"
}

# Reuses existing private subnets/NAT paths
module "network" {
  source             = "./modules/vpc"
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids
}

# Reference the existing S3 bucket for assets
data "aws_s3_bucket" "assets" {
  bucket = var.assets_bucket_name
}

# Reference database outputs from database terraform
data "terraform_remote_state" "database" {
  backend = "remote"

  config = {
    organization = "Jon_Kimmel"
    workspaces = {
      name = "ds2-database-prod"
    }
  }
}

# ACM certificate for ALB
module "acm" {
  source      = "./modules/acm"
  domain_name = "ds2.kimmeloffice.com"
}

# Application Load Balancer
module "alb" {
  source                = "./modules/alb"
  name                  = "${local.name_prefix}-alb"
  vpc_id                = module.network.vpc_id
  subnet_ids            = module.network.private_subnet_ids
  allowed_ingress_cidrs = var.alb_allowed_cidrs
  certificate_arn       = module.acm.certificate_arn
}

# Security group for ECS tasks
resource "aws_security_group" "ecs_tasks" {
  name   = "${local.name_prefix}-ecs"
  vpc_id = module.network.vpc_id

  ingress {
    description     = "ALB ingress"
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [module.alb.security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-ecs"
  }
}

# Update database security group to allow ECS tasks
resource "aws_security_group_rule" "db_from_ecs" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.ecs_tasks.id
  security_group_id        = data.terraform_remote_state.database.outputs.db_security_group_id
  description              = "Backend ECS tasks"
}

# SNS topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# JWT secret for application
resource "random_password" "jwt" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "app_jwt" {
  name        = "backend/prod/APP_JWT_SECRET"
  description = "Production JWT secret for backend"
}

resource "aws_secretsmanager_secret_version" "app_jwt" {
  secret_id     = aws_secretsmanager_secret.app_jwt.id
  secret_string = jsonencode({ value = random_password.jwt.result })
}

# Secrets for ECS tasks
locals {
  ecs_secrets = {
    DB_SECRET  = data.terraform_remote_state.database.outputs.database_secret_arn
    JWT_SECRET = aws_secretsmanager_secret.app_jwt.arn
  }
}

# IAM roles for ECS
module "iam" {
  source               = "./modules/iam"
  name_prefix          = local.name_prefix
  secrets_manager_arns = [
    data.terraform_remote_state.database.outputs.database_secret_arn,
    aws_secretsmanager_secret.app_jwt.arn
  ]
  s3_backup_bucket_arn = data.terraform_remote_state.database.outputs.backup_bucket_name
  kms_key_arn          = "" # Will need to add this to database outputs if needed
}

# ECS Cluster
module "ecs_cluster" {
  source = "./modules/ecs_cluster"
  name   = "${local.name_prefix}-cluster"
}

# Backend ECS Service
module "ecs_service" {
  source                  = "./modules/ecs_service"
  name                    = "${local.name_prefix}-service"
  cluster_arn             = module.ecs_cluster.cluster_arn
  task_role_arn           = module.iam.ecs_task_role_arn
  execution_role_arn      = module.iam.ecs_execution_role_arn
  subnet_ids              = module.network.private_subnet_ids
  security_group_ids      = [aws_security_group.ecs_tasks.id]
  target_group_arn        = module.alb.target_group_arn
  desired_count           = var.desired_count
  cpu                     = var.task_cpu
  memory                  = var.task_memory
  nginx_image             = var.nginx_image
  api_image               = var.backend_image
  environment = {
    NODE_ENV   = "production"
    DB_HOST    = data.terraform_remote_state.database.outputs.database_endpoint
    DB_NAME    = "ds2_prod"
  }
  secrets                 = local.ecs_secrets
  alb_arn_suffix          = module.alb.lb_arn_suffix
  target_group_arn_suffix = module.alb.target_group_arn_suffix
  sns_topic_arn           = aws_sns_topic.alerts.arn
}

# Route53 private hosted zone DNS record
module "route53" {
  source       = "./modules/route53_private"
  zone_name    = var.route53_zone_name
  vpc_id       = module.network.vpc_id
  record_name  = format("%s.%s", var.alb_record_name, var.route53_zone_name)
  alb_dns_name = module.alb.lb_dns_name
  alb_zone_id  = module.alb.lb_zone_id
}
