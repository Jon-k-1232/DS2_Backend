terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "zone_name" {
  type        = string
  description = "Name of the private hosted zone"
}

variable "vpc_id" {
  type        = string
}

variable "record_name" {
  type        = string
  description = "Record to alias to the ALB"
}

variable "alb_dns_name" {
  type        = string
}

variable "alb_zone_id" {
  type        = string
}

resource "aws_route53_zone" "private" {
  name = var.zone_name
  vpc {
    vpc_id = var.vpc_id
  }
  comment = "DS2 internal zone"
  force_destroy = false
}

resource "aws_route53_record" "alb_alias" {
  zone_id = aws_route53_zone.private.zone_id
  name    = var.record_name
  type    = "A"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "alb_alias_ipv6" {
  zone_id = aws_route53_zone.private.zone_id
  name    = var.record_name
  type    = "AAAA"

  alias {
    name                   = var.alb_dns_name
    zone_id                = var.alb_zone_id
    evaluate_target_health = true
  }
}

output "zone_id" {
  value = aws_route53_zone.private.zone_id
}
