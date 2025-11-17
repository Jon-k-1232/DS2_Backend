variable "aws_region" {
  type        = string
  description = "AWS region"
  default     = "us-west-2"
}

variable "vpc_id" {
  type        = string
  description = "VPC ID where RDS resides"
}

variable "private_subnet_ids" {
  type        = list(string)
  description = "Private subnet IDs for RDS"
}

variable "db_security_group_id" {
  type        = string
  description = "Security group ID for RDS"
}

# Use existing workspace variables for database credentials
variable "db_username" {
  type        = string
  description = "Database username (from existing workspace)"
  sensitive   = true
}

variable "db_password" {
  type        = string
  description = "Database password (from existing workspace)"
  sensitive   = true
}

variable "db_name" {
  type        = string
  description = "Database name (from existing workspace)"
}
