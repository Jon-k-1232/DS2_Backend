locals {
  name_prefix = "ds2-prod"
  alb_name    = "${local.name_prefix}-alb"
}

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}

data "aws_s3_bucket" "assets" {
  # Existing assets bucket is read-only; never manage/import with Terraform.
  bucket = var.assets_bucket_name
}

# Reuses existing private subnets/NAT paths; does not create IGW or NAT resources.
module "network" {
  source             = "./modules/vpc"
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids
}

module "acm" {
  source      = "./modules/acm"
  domain_name = "ds2.kimmelOffice.com"
}

module "alb" {
  source               = "./modules/alb"
  name                 = local.alb_name
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  allowed_ingress_cidrs = var.alb_allowed_cidrs
  certificate_arn      = module.acm.certificate_arn
  health_check_path    = "/healthz"
}

resource "aws_security_group" "ecs_tasks" {
  name        = "${local.name_prefix}-ecs"
  description = "Allow only ALB to reach ECS tasks"
  vpc_id      = module.network.vpc_id

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

resource "aws_security_group" "db" {
  name        = "${local.name_prefix}-db"
  description = "Allow application tiers + on-prem to reach RDS"
  vpc_id      = module.network.vpc_id

  ingress {
    description     = "ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  dynamic "ingress" {
    for_each = var.db_allowed_cidrs
    content {
      description = "Approved on-prem/VPN networks"
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-db"
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

resource "aws_ecr_repository" "frontend" {
  name                 = "frontend"
  image_tag_mutability = "MUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
  }
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "backend" {
  name                 = "backend"
  image_tag_mutability = "MUTABLE"
  encryption_configuration {
    encryption_type = "KMS"
  }
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name
  policy     = jsonencode({
    rules = [{
      rulePriority = 1,
      description  = "Keep last 20 tags",
      selection = {
        tagStatus     = "tagged",
        tagPrefixList = [""],
        countType     = "imageCountMoreThan",
        countNumber   = 20
      },
      action = { type = "expire" }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  policy     = aws_ecr_lifecycle_policy.frontend.policy
}

module "backup_bucket" {
  source      = "./modules/s3_backup"
  bucket_name = "ds2-pg-backups-prod"
}

# Reference the shared RDS instance created by dev environment
data "aws_db_instance" "shared" {
  db_instance_identifier = "ds2-shared-db"
}

data "aws_secretsmanager_secret" "shared_db_credentials" {
  name = "ds2-shared-db-credentials"
}

locals {
  # Using the shared RDS instance for prod, will create ds2_prod database manually
  database_endpoint = data.aws_db_instance.shared.address
  database_port     = data.aws_db_instance.shared.port
  database_name     = "ds2_prod"  # Will be created manually in the shared RDS
  database_secret_arn = data.aws_secretsmanager_secret.shared_db_credentials.arn
}

resource "random_password" "app_jwt" {
  length  = 64
  special = false
}

resource "aws_secretsmanager_secret" "app_jwt" {
  name        = "backend/APP_JWT_SECRET"
  description = "JWT signing secret for DS2 prod"
}

resource "aws_secretsmanager_secret_version" "app_jwt" {
  secret_id     = aws_secretsmanager_secret.app_jwt.id
  secret_string = jsonencode({ value = random_password.app_jwt.result })
}

resource "aws_secretsmanager_secret" "third_party_api" {
  name        = "backend/THIRD_PARTY_API_KEYS"
  description = "Populate manually with third-party API keys"
}

resource "aws_secretsmanager_secret" "smtp" {
  name        = "backend/SMTP_CREDENTIALS"
  description = "Populate manually with SMTP credentials"
}

locals {
  ecs_secrets = {
    DB_SECRET = local.database_secret_arn
    JWT_SECRET = aws_secretsmanager_secret.app_jwt.arn
  }
}

module "iam" {
  source                = "./modules/iam"
  name_prefix           = local.name_prefix
  secrets_manager_arns  = concat([
    local.database_secret_arn,
    aws_secretsmanager_secret.app_jwt.arn,
    aws_secretsmanager_secret.third_party_api.arn,
    aws_secretsmanager_secret.smtp.arn
  ])
  s3_backup_bucket_arn = module.backup_bucket.bucket_arn
  kms_key_arn          = module.backup_bucket.kms_key_arn
}

module "ecs_cluster" {
  source = "./modules/ecs_cluster"
  name   = "${local.name_prefix}-cluster"
}

module "ecs_service" {
  source                   = "./modules/ecs_service"
  name                     = "${local.name_prefix}-service"
  cluster_arn              = module.ecs_cluster.cluster_arn
  task_role_arn            = module.iam.ecs_task_role_arn
  execution_role_arn       = module.iam.ecs_execution_role_arn
  subnet_ids               = module.network.private_subnet_ids
  security_group_ids       = [aws_security_group.ecs_tasks.id]
  target_group_arn         = module.alb.target_group_arn
  desired_count            = 2
  cpu                      = 256
  memory                   = 512
  nginx_image              = var.frontend_image
  api_image                = var.backend_image
  environment              = {
    NODE_ENV        = "production"
    ASSETS_BASE_S3  = data.aws_s3_bucket.assets.bucket_regional_domain_name
  }
  secrets                  = local.ecs_secrets
  alb_arn_suffix           = module.alb.lb_arn_suffix
  target_group_arn_suffix  = module.alb.target_group_arn_suffix
  sns_topic_arn            = aws_sns_topic.alerts.arn
}

module "route53" {
  source       = "./modules/route53_private"
  zone_name    = var.route53_zone_name
  vpc_id       = module.network.vpc_id
  record_name  = format("%s.%s", var.alb_record_name, var.route53_zone_name)
  alb_dns_name = module.alb.lb_dns_name
  alb_zone_id  = module.alb.lb_zone_id
}

# Lambda module commented out until ECR images are built
# module "lambda_pg_dump" {
#   source              = "./modules/lambda_pg_dump"
#   function_name       = "${local.name_prefix}-pgdump"
#   image_uri           = var.lambda_image_uri
#   subnet_ids          = module.network.private_subnet_ids
#   security_group_ids  = [aws_security_group.ecs_tasks.id]
#   lambda_role_arn     = module.iam.lambda_role_arn
#   db_secret_arn       = local.database_secret_arn
#   backup_bucket_name  = module.backup_bucket.bucket_name
#   schedule_expression = "cron(0 10 * * ? *)"
#   sns_topic_arn       = aws_sns_topic.alerts.arn
#   environment = {
#     PGDATABASE = local.database_name
#     PGHOST     = local.database_endpoint
#     PGPORT     = local.database_port
#   }
# }
