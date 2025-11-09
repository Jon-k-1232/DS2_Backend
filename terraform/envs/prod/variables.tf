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

variable "alb_allowed_cidrs" {
  description = "On-prem/VPN CIDRs allowed to reach the internal ALB"
  type        = list(string)
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

variable "assets_bucket_name" {
  type        = string
  description = "Existing assets bucket used as data source only"
  default     = "ds2-shared-assets"
}

variable "frontend_image" {
  description = "ECR image URI for the React/nginx container"
  type        = string
  default     = "123456789012.dkr.ecr.us-west-2.amazonaws.com/frontend:latest"
}

variable "backend_image" {
  description = "ECR image URI for the node/express container"
  type        = string
  default     = "123456789012.dkr.ecr.us-west-2.amazonaws.com/backend:latest"
}

variable "lambda_image_uri" {
  description = "ECR image URI that bundles pg_dump tooling"
  type        = string
  default     = "123456789012.dkr.ecr.us-west-2.amazonaws.com/pgdump:latest"
}

variable "alert_email" {
  type        = string
  default     = "networknotifications@kimmeloffice.com"
}

variable "route53_zone_name" {
  type    = string
  default = "kimmelOffice.com"
}

variable "alb_record_name" {
  type    = string
  default = "ds2"
}

variable "on_prem_cidrs" {
  type    = list(string)
  default = [
    "192.168.0.0/24",
    "192.168.6.0/24"
  ]
}

variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage" {
  type    = number
  default = 50
}

variable "db_max_allocated_storage" {
  type    = number
  default = 200
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_backup_retention" {
  type    = number
  default = 7
}

variable "db_skip_final_snapshot" {
  type    = bool
  default = false
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
