variable "region" {
  description = "AWS region for the DS2 resources."
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

# Your on-prem/VLAN CIDRs that reach AWS over the VPN
variable "onprem_cidrs" {
  description = "CIDR blocks outside the VPC (VPN/DirectConnect) allowed through the endpoint."
  type        = list(string)
}
