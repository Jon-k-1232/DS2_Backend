variable "db_host" {
  description = "RDS database host"
  type        = string
}

variable "db_port" {
  description = "RDS database port"
  type        = string
  default     = "5432"
}

variable "db_user" {
  description = "RDS database user"
  type        = string
}

variable "db_password" {
  description = "RDS database password"
  type        = string
  sensitive   = true
}

variable "db_name" {
  description = "RDS database name"
  type        = string
  default     = "ds2_prod"
}

variable "s3_bucket_name" {
  description = "S3 bucket for pg_dump backups"
  type        = string
  default     = "ds2-pg-backups-prod"
}
