terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "domain_name" {
  type        = string
  description = "Primary domain for the certificate"
}

variable "subject_alternative_names" {
  type        = list(string)
  default     = []
}

resource "aws_acm_certificate" "this" {
  domain_name               = var.domain_name
  subject_alternative_names = var.subject_alternative_names
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

output "certificate_arn" {
  value = aws_acm_certificate.this.arn
}

output "dns_validation_records" {
  description = "CNAME records that must be added to the public DNS zone"
  value = [
    for option in aws_acm_certificate.this.domain_validation_options : {
      domain_name = option.domain_name
      cname_name  = option.resource_record_name
      cname_type  = option.resource_record_type
      cname_value = option.resource_record_value
    }
  ]
}
