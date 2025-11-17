variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "s3_bucket_name" {
  description = "S3 bucket name for database backups"
  type        = string
  default     = "ds2-database-backups-prod"
}

variable "vpc_id" {
  description = "VPC ID where Lambda will run"
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnet IDs for Lambda"
  type        = list(string)
}

variable "rds_security_group_id" {
  description = "RDS security group ID to allow Lambda access"
  type        = string
}

variable "db_host" {
  description = "RDS database hostname"
  type        = string
}

variable "db_port" {
  description = "RDS database port"
  type        = string
  default     = "5432"
}

variable "db_name" {
  description = "Database name to backup"
  type        = string
  default     = "ds2_prod"
}

variable "db_secret_arn" {
  description = "ARN of Secrets Manager secret containing database credentials"
  type        = string
}

variable "kms_key_id" {
  description = "KMS key ARN for encryption"
  type        = string
}
