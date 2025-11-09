locals {
  name_prefix = "ds2-dev"
}

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
  domain_name = "dev.ds2.kimmeloffice.com"
}

module "alb" {
  source               = "./modules/alb"
  name                 = "${local.name_prefix}-alb"
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  allowed_ingress_cidrs = var.alb_allowed_cidrs
  certificate_arn      = module.acm.certificate_arn
}

resource "aws_security_group" "ecs_tasks" {
  name   = "${local.name_prefix}-ecs"
  vpc_id = module.network.vpc_id

  ingress {
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
}

resource "aws_security_group" "db" {
  name   = "${local.name_prefix}-db"
  vpc_id = module.network.vpc_id

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
      description = "On-prem / VPN"
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

module "backup_bucket" {
  source      = "./modules/s3_backup"
  bucket_name = "ds2-pg-backups-dev"
}

module "database" {
  source                  = "./modules/rds_postgres"
  vpc_id                  = module.network.vpc_id
  subnet_ids              = module.network.private_subnet_ids
  db_identifier           = "ds2-shared-db"
  db_name                 = "ds2_dev"  # Auto-creates ds2_dev, manually create ds2_prod later
  master_username         = var.db_username
  master_password         = var.db_password
  instance_class          = var.db_instance_class
  allocated_storage       = var.db_allocated_storage
  max_allocated_storage   = var.db_max_allocated_storage
  multi_az                = var.db_multi_az
  backup_retention        = var.db_backup_retention
  skip_final_snapshot     = var.db_skip_final_snapshot
  vpc_security_group_ids  = [aws_security_group.db.id]
}

resource "random_password" "dev_db" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "app_jwt" {
  name        = "backend/dev/APP_JWT_SECRET"
  description = "DEV JWT secret"
}

resource "aws_secretsmanager_secret_version" "app_jwt" {
  secret_id     = aws_secretsmanager_secret.app_jwt.id
  secret_string = jsonencode({ value = random_password.dev_db.result })
}

locals {
  ecs_secrets = {
    DB_SECRET  = module.database.secret_arn
    JWT_SECRET = aws_secretsmanager_secret.app_jwt.arn
  }
}

module "iam" {
  source               = "./modules/iam"
  name_prefix          = local.name_prefix
  secrets_manager_arns = [module.database.secret_arn, aws_secretsmanager_secret.app_jwt.arn]
  s3_backup_bucket_arn = module.backup_bucket.bucket_arn
  kms_key_arn          = module.backup_bucket.kms_key_arn
}

module "ecs_cluster" {
  source = "./modules/ecs_cluster"
  name   = "${local.name_prefix}-cluster"
}

module "ecs_service" {
  source                  = "./modules/ecs_service"
  name                    = "${local.name_prefix}-service"
  cluster_arn             = module.ecs_cluster.cluster_arn
  task_role_arn           = module.iam.ecs_task_role_arn
  execution_role_arn      = module.iam.ecs_execution_role_arn
  subnet_ids              = module.network.private_subnet_ids
  security_group_ids      = [aws_security_group.ecs_tasks.id]
  target_group_arn        = module.alb.target_group_arn
  desired_count           = 1
  cpu                     = 256
  memory                  = 512
  nginx_image             = var.frontend_image
  api_image               = var.backend_image
  environment             = { NODE_ENV = "development" }
  secrets                 = local.ecs_secrets
  alb_arn_suffix          = module.alb.lb_arn_suffix
  target_group_arn_suffix = module.alb.target_group_arn_suffix
  sns_topic_arn           = aws_sns_topic.alerts.arn
}

module "route53" {
  source       = "./modules/route53_private"
  zone_name    = var.route53_zone_name
  vpc_id       = module.network.vpc_id
  record_name  = format("%s.%s", var.alb_record_name, var.route53_zone_name)
  alb_dns_name = module.alb.lb_dns_name
  alb_zone_id  = module.alb.lb_zone_id
}

# TODO: Re-enable once ECR repository and pgdump image are built
# module "lambda_pg_dump" {
#   source             = "./modules/lambda_pg_dump"
#   function_name      = "${local.name_prefix}-pgdump"
#   image_uri          = var.lambda_image_uri
#   subnet_ids         = module.network.private_subnet_ids
#   security_group_ids = [aws_security_group.ecs_tasks.id]
#   lambda_role_arn    = module.iam.lambda_role_arn
#   db_secret_arn      = module.database.secret_arn
#   backup_bucket_name = module.backup_bucket.bucket_name
#   sns_topic_arn      = aws_sns_topic.alerts.arn
#   environment = {
#     PGDATABASE = module.database.database_name
#     PGHOST     = module.database.endpoint
#     PGPORT     = module.database.port
#   }
# }
