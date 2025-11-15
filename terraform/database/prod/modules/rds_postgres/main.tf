terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = ">= 3.5"
    }
  }
}

variable "vpc_id" {
  type        = string
  description = "VPC where the database resides"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for the DB subnet group"
}

variable "db_identifier" {
  type        = string
  description = "Unique identifier for the DB instance"
}

variable "db_name" {
  type        = string
  description = "Initial database name"
  default     = "ds2"
}

variable "master_username" {
  type        = string
  description = "Master username for the database"
}

variable "master_password" {
  type        = string
  description = "Master password for the database"
  sensitive   = true
}

variable "instance_class" {
  type        = string
  description = "RDS instance class"
}

variable "allocated_storage" {
  type        = number
  description = "Initial storage (GiB)"
  default     = 20
}

variable "max_allocated_storage" {
  type        = number
  description = "Autoscaling storage limit (GiB)"
  default     = 100
}

variable "engine_version" {
  type        = string
  description = "Specific engine version to pin (leave null to let AWS pick latest)"
  default     = null
}

variable "backup_retention" {
  type        = number
  description = "Backup retention days"
  default     = 7
}

variable "maintenance_window" {
  type        = string
  default     = "Sun:08:00-Sun:09:00"
}

variable "backup_window" {
  type        = string
  default     = "07:00-08:00"
}

variable "multi_az" {
  type    = bool
  default = false
}

variable "deletion_protection" {
  type    = bool
  default = false
}

variable "skip_final_snapshot" {
  type    = bool
  default = true
}

variable "final_snapshot_identifier" {
  type        = string
  description = "Name of the final snapshot when destroying the database"
  default     = null
}

variable "apply_immediately" {
  type    = bool
  default = true
}

variable "vpc_security_group_ids" {
  type        = list(string)
  description = "Security groups that can reach the DB"
}

variable "performance_insights_enabled" {
  type    = bool
  default = true
}

variable "enabled_cloudwatch_logs_exports" {
  type        = list(string)
  description = "Log types to export to CloudWatch (postgresql, upgrade)"
  default     = ["postgresql"]
}

variable "storage_encrypted" {
  type        = bool
  description = "Enable storage encryption"
  default     = true
}

variable "kms_key_id" {
  type        = string
  description = "KMS key ID for encryption"
  default     = null
}

variable "performance_insights_kms_key_id" {
  type        = string
  description = "KMS key ID for Performance Insights encryption"
  default     = null
}

variable "performance_insights_retention" {
  type        = number
  description = "Performance Insights retention period in days"
  default     = 7
}

variable "copy_tags_to_snapshot" {
  type        = bool
  description = "Copy tags to snapshots"
  default     = true
}

variable "auto_minor_version_upgrade" {
  type        = bool
  description = "Enable automatic minor version upgrades"
  default     = true
}

variable "ca_cert_identifier" {
  type        = string
  description = "CA certificate identifier"
  default     = null
}

variable "storage_type" {
  type        = string
  description = "Storage type (gp2, gp3, io1)"
  default     = "gp2"
}

resource "aws_secretsmanager_secret" "db_password" {
  name        = "${var.db_identifier}-credentials"
  description = "Credentials for ${var.db_identifier}"
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = jsonencode({
    username = var.master_username,
    password = var.master_password
  })
}

resource "aws_db_subnet_group" "this" {
  name       = "${var.db_identifier}-subnets"
  subnet_ids = var.subnet_ids
  tags = {
    Name = "${var.db_identifier}-subnets"
  }
}

resource "aws_db_instance" "this" {
  identifier                          = var.db_identifier
  db_name                             = var.db_name
  engine                              = "postgres"
  engine_version                      = var.engine_version
  instance_class                      = var.instance_class
  allocated_storage                   = var.allocated_storage
  max_allocated_storage               = var.max_allocated_storage
  storage_type                        = var.storage_type
  username                            = var.master_username
  password                            = var.master_password
  db_subnet_group_name                = aws_db_subnet_group.this.name
  vpc_security_group_ids              = var.vpc_security_group_ids
  storage_encrypted                   = var.storage_encrypted
  kms_key_id                          = var.kms_key_id
  multi_az                            = var.multi_az
  backup_retention_period             = var.backup_retention
  maintenance_window                  = var.maintenance_window
  backup_window                       = var.backup_window
  delete_automated_backups            = true
  deletion_protection                 = var.deletion_protection
  skip_final_snapshot                 = var.skip_final_snapshot
  final_snapshot_identifier           = var.final_snapshot_identifier
  apply_immediately                   = var.apply_immediately
  performance_insights_enabled        = var.performance_insights_enabled
  performance_insights_kms_key_id     = var.performance_insights_kms_key_id
  performance_insights_retention_period = var.performance_insights_retention
  auto_minor_version_upgrade          = var.auto_minor_version_upgrade
  allow_major_version_upgrade         = false
  copy_tags_to_snapshot               = var.copy_tags_to_snapshot
  ca_cert_identifier                  = var.ca_cert_identifier
  enabled_cloudwatch_logs_exports     = var.enabled_cloudwatch_logs_exports
}

output "endpoint" {
  value = aws_db_instance.this.address
}

output "port" {
  value = aws_db_instance.this.port
}

output "secret_arn" {
  value = aws_secretsmanager_secret.db_password.arn
}

output "database_name" {
  value = var.db_name
}
