variable "region" {
  description = "AWS region for the DS2 resources."
  type        = string
  default     = "us-west-2"
}

variable "account_id" {
  description = "AWS account ID used to ensure the S3 bucket name is globally unique."
  type        = string
}

variable "iam_user_name" {
  description = "Name of the IAM user granted DS2 bucket access."
  type        = string
  default     = "ds2-bucket-user"
}

variable "vpc_id" {
  description = "ID of the VPC hosting the interface endpoint."
  type        = string
}

variable "private_subnet_ids" {
  description = "Private subnets in the VPC where the S3 interface endpoint lives."
  type        = list(string)
}

variable "private_route_table_ids" {
  description = "Route table IDs associated with private subnets that require the S3 Gateway endpoint."
  type        = list(string)
  default     = []
}

variable "onprem_cidrs" {
  description = "CIDR blocks outside the VPC (VPN/DirectConnect) allowed through the endpoint."
  type        = list(string)
}

variable "private_zone_name" {
  description = "Private DNS zone you control for publishing internal records."
  type        = string
  default     = "ds2.internal"
}

variable "AWS_ACCESS_KEY_ID" {
  description = "Optional Access Key ID for Terraform runs (prefer workspace environment variables)."
  type        = string
  default     = null
  sensitive   = true
}

variable "AWS_SECRET_ACCESS_KEY" {
  description = "Optional Secret Access Key for Terraform runs (prefer workspace environment variables)."
  type        = string
  default     = null
  sensitive   = true
}
