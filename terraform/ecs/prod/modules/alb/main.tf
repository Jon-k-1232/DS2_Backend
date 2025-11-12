terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "name" {
  description = "Name prefix for ALB resources"
  type        = string
}

variable "vpc_id" {
  type        = string
  description = "VPC id"
}

variable "subnet_ids" {
  type        = list(string)
  description = "Subnets for the internal ALB"
}

variable "allowed_ingress_cidrs" {
  type        = list(string)
  description = "Approved CIDR ranges (on-prem, VPN) allowed to reach ALB"
  default     = []
}

variable "target_group_port" {
  type        = number
  default     = 80
  description = "Port where ECS target receives traffic"
}

variable "health_check_path" {
  type        = string
  default     = "/healthz"
}

resource "aws_security_group" "alb" {
  name        = "${var.name}-alb-sg"
  description = "Allow HTTPS from on-prem networks"
  vpc_id      = var.vpc_id

  dynamic "ingress" {
    for_each = var.allowed_ingress_cidrs
    content {
      description = "Allowed client network"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${var.name}-alb-sg"
  }
}

resource "aws_lb" "this" {
  name               = "${var.name}-internal"
  internal           = true
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = var.subnet_ids
  ip_address_type    = "ipv4"
  enable_http2       = true

  tags = {
    Name = "${var.name}-internal"
  }
}

resource "aws_lb_target_group" "ecs" {
  name        = "${var.name}-tg"
  port        = var.target_group_port
  protocol    = "HTTP"
  vpc_id      = var.vpc_id
  target_type = "ip"

  health_check {
    enabled             = true
    healthy_threshold   = 3
    unhealthy_threshold = 2
    interval            = 30
    path                = var.health_check_path
    matcher             = "200-399"
  }

  tags = {
    Name = "${var.name}-tg"
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.this.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.ecs.arn
  }
}

variable "certificate_arn" {
  type        = string
  description = "ACM certificate to terminate TLS"
}

output "security_group_id" {
  value = aws_security_group.alb.id
}

output "lb_arn" {
  value = aws_lb.this.arn
}

output "lb_dns_name" {
  value = aws_lb.this.dns_name
}

output "lb_zone_id" {
  value = aws_lb.this.zone_id
}

output "target_group_arn" {
  value = aws_lb_target_group.ecs.arn
}

output "target_group_arn_suffix" {
  value = aws_lb_target_group.ecs.arn_suffix
}

output "listener_arn" {
  value = aws_lb_listener.https.arn
}

output "lb_arn_suffix" {
  value = aws_lb.this.arn_suffix
}
