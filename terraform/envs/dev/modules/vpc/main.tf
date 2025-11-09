terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "vpc_id" {
  description = "ID of the existing VPC to deploy into"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs for ECS tasks and internal ALB"
  type        = list(string)
  validation {
    condition     = length(var.private_subnet_ids) >= 2
    error_message = "Provide at least two private subnets in different AZs."
  }
}

variable "public_subnet_ids" {
  description = "Optional list of public subnet IDs if ever needed"
  type        = list(string)
  default     = []
}

data "aws_vpc" "selected" {
  id = var.vpc_id
}

data "aws_subnet" "private" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value
}

data "aws_subnet" "public" {
  for_each = toset(var.public_subnet_ids)
  id       = each.value
}

output "vpc_id" {
  value       = data.aws_vpc.selected.id
  description = "Validated VPC id"
}

output "vpc_cidr_block" {
  value       = data.aws_vpc.selected.cidr_block
  description = "CIDR of the selected VPC"
}

output "private_subnet_ids" {
  value       = var.private_subnet_ids
  description = "Private subnet ids"
}

output "private_subnet_azs" {
  value       = { for k, v in data.aws_subnet.private : k => v.availability_zone }
  description = "AZ per private subnet"
}
