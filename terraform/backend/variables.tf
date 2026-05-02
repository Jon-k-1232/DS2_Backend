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
  default     = "ds2-561979538576"
}

variable "alert_email" {
  type    = string
  default = "networknotifications@kimmeloffice.com"
}

variable "route53_zone_name" {
  type    = string
  default = "kimmeloffice.com"
}

variable "alb_record_name" {
  type    = string
  default = "ds2"
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
    "192.168.7.0/28",
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

variable "node_env" {
  type        = string
  description = "Node environment (development/production)"
  default     = "production"
}

variable "from_email" {
  type        = string
  description = "Email address for sending notifications via SES"
  default     = "NetworkNotifications@kimmelOffice.com"
}

variable "s3_bucket_name" {
  type        = string
  description = "S3 bucket name for assets"
}

variable "s3_endpoint" {
  type        = string
  description = "S3 VPC endpoint URL"
}

variable "s3_region" {
  type        = string
  description = "S3 bucket region"
  default     = "us-west-2"
}

variable "backend_image_version" {
  type        = string
  description = "Docker image version tag for backend"
  default     = "v1.0.0"
}

variable "frontend_image_version" {
  type        = string
  description = "Docker image version tag for frontend"
  default     = "v1.0.0"
}

variable "nginx_image_version" {
  type        = string
  description = "Docker image version tag for nginx"
  default     = "v1.0.0"
}

# ----------------------------------------------------------------------------
# Time-tracker AI pipeline (Phase 1 cutover)
# ----------------------------------------------------------------------------
variable "bedrock_region" {
  type        = string
  description = "AWS region for Bedrock InvokeModel calls"
  default     = "us-west-2"
}

variable "bedrock_model_timetracker" {
  type        = string
  description = "Bedrock model ID used for the precise/escalation tier of category inference and customer-name tiebreak"
  default     = "us.anthropic.claude-sonnet-4-5-20250929-v1:0"
}

variable "bedrock_model_timetracker_fast" {
  type        = string
  description = "Bedrock model ID used for the fast/cheap first-pass tier of category inference"
  default     = "us.anthropic.claude-haiku-4-5-20251001-v1:0"
}

variable "llm_log_bucket" {
  type        = string
  description = "S3 bucket name for LLM audit logs (one record per Bedrock InvokeModel call). Matches the bucket created by terraform/s3/prod/main.tf."
  default     = "ds2-561979538576-llm-logs"
}

variable "time_tracker_ai_feature_flag" {
  type        = string
  description = "Time-tracker AI rollout flag. Allowed: off | test | on"
  default     = "off"
  validation {
    condition     = contains(["off", "test", "on"], var.time_tracker_ai_feature_flag)
    error_message = "time_tracker_ai_feature_flag must be one of: off, test, on"
  }
}

variable "time_tracker_ai_test_account_ids" {
  type        = string
  description = "Comma-separated list of account_ids allowed to run the AI pipeline when feature flag is 'test'"
  default     = ""
}

variable "auto_insert_confidence_threshold" {
  type        = string
  description = "Combined-confidence threshold (0..1) at or above which a row is auto-inserted into customer_transactions"
  default     = "0.85"
}
