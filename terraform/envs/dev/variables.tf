variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "vpc_id" {
  type    = string
  default = "vpc-04f4c4cf527f99b9a"
}

variable "private_subnet_ids" {
  type = list(string)
  default = [
    "subnet-0acc9b809e7808b43",
    "subnet-0e30e764faaeca235"
  ]
}

variable "assets_bucket_name" {
  type        = string
  default     = "ds2-shared-assets"
}

variable "frontend_image" {
  type        = string
  default     = "123456789012.dkr.ecr.us-west-2.amazonaws.com/frontend:dev"
}

variable "backend_image" {
  type        = string
  default     = "123456789012.dkr.ecr.us-west-2.amazonaws.com/backend:dev"
}

variable "lambda_image_uri" {
  type        = string
  default     = "123456789012.dkr.ecr.us-west-2.amazonaws.com/pgdump:dev"
}

variable "alert_email" {
  type    = string
  default = "networknotifications@kimmeloffice.com"
}

variable "alb_allowed_cidrs" {
  type = list(string)
  default = [
    "173.31.0.0/20",
    "192.168.0.0/24",
    "192.168.6.0/24",
    "192.168.10.0/26",
    "192.168.12.0/26",
    "192.168.40.0/24",
    "192.168.168.0/24",
    # Private-only subnets inside VPC (no public subnets listed)
    "172.31.0.0/20",
    "172.31.48.0/20",
    "172.31.64.0/20"
  ]
}

variable "route53_zone_name" {
  type    = string
  default = "kimmelOffice.internal"
}

variable "alb_record_name" {
  type    = string
  default = "dev-ds2"
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

variable "db_allocated_storage" {
  type    = number
  default = 20
}

variable "db_max_allocated_storage" {
  type    = number
  default = 100
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_retention" {
  type    = number
  default = 2
}

variable "db_skip_final_snapshot" {
  type    = bool
  default = true
}

variable "db_allowed_cidrs" {
  type = list(string)
  default = [
    "192.168.0.0/24",
    "192.168.6.0/24",
    "192.168.10.0/26",
    "192.168.12.0/26",
    "192.168.40.0/24",
    "192.168.168.0/24",
    "173.31.0.0/20"
  ]
}

variable "db_username" {
  type        = string
  description = "Master username for RDS database"
  sensitive   = true
}

variable "db_password" {
  type        = string
  description = "Master password for RDS database"
  sensitive   = true
}

variable "db_final_snapshot_identifier" {
  type        = string
  description = "Final snapshot identifier when destroying the database"
  default     = null
}

# Application secrets
variable "api_token" {
  type        = string
  description = "API token for authentication"
  sensitive   = true
}

variable "from_email_password" {
  type        = string
  description = "Password for FROM_EMAIL account"
  sensitive   = true
}

variable "s3_access_key_id" {
  type        = string
  description = "AWS S3 access key ID"
  sensitive   = true
}

variable "s3_secret_access_key" {
  type        = string
  description = "AWS S3 secret access key"
  sensitive   = true
}

variable "enable_auto_shutdown" {
  type        = bool
  description = "Enable automatic shutdown from 11pm-6am PST to save costs"
  default     = false
}
