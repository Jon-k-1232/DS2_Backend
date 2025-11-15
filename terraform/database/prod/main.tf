terraform {
  required_version = ">= 1.5.0"
  
  cloud {
    organization = "Jon_Kimmel"
    workspaces {
      name = "ds2-database-prod"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# Data sources for existing infrastructure
data "aws_vpc" "main" {
  id = var.vpc_id
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
  filter {
    name   = "subnet-id"
    values = var.private_subnet_ids
  }
}

data "aws_security_group" "db" {
  id = var.db_security_group_id
}

# RDS PostgreSQL Database
module "rds_postgres" {
  source = "./modules/rds_postgres"

  vpc_id                          = var.vpc_id
  subnet_ids                      = var.private_subnet_ids
  db_identifier                   = "ds2-shared-db"
  db_name                         = "ds2_dev"
  master_username                 = var.db_username
  master_password                 = var.db_password
  instance_class                  = "db.t4g.small"
  allocated_storage               = 50
  max_allocated_storage           = 200
  engine_version                  = "17.6"
  backup_retention                = 7
  backup_window                   = "07:00-08:00"
  maintenance_window              = "sun:08:00-sun:09:00"
  multi_az                        = false
  deletion_protection             = true
  skip_final_snapshot             = false
  final_snapshot_identifier       = "ds2-shared-db-final-snapshot"
  vpc_security_group_ids          = [var.db_security_group_id]
  performance_insights_enabled    = true
  performance_insights_kms_key_id = "arn:aws:kms:us-west-2:561979538576:key/ec003257-4dfb-41fa-8a6f-a5dd9580129b"
  performance_insights_retention  = 7
  storage_encrypted               = true
  kms_key_id                      = "arn:aws:kms:us-west-2:561979538576:key/ec003257-4dfb-41fa-8a6f-a5dd9580129b"
  enabled_cloudwatch_logs_exports = ["postgresql"]
  copy_tags_to_snapshot           = true
  auto_minor_version_upgrade      = true
  apply_immediately               = true
  ca_cert_identifier              = "rds-ca-rsa2048-g1"
  storage_type                    = "gp2"
}

# Outputs
output "db_endpoint" {
  value       = module.rds_postgres.endpoint
  description = "RDS endpoint address"
}

output "db_port" {
  value       = module.rds_postgres.port
  description = "RDS port"
}

output "db_secret_arn" {
  value       = module.rds_postgres.secret_arn
  description = "ARN of Secrets Manager secret containing DB credentials"
  sensitive   = true
}
