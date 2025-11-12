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
  type = string
}

variable "cluster_arn" {
  type = string
}

variable "task_role_arn" {
  type = string
}

variable "execution_role_arn" {
  type = string
}

variable "subnet_ids" {
  type = list(string)
}

variable "security_group_ids" {
  type = list(string)
}

variable "target_group_arn" {
  type = string
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "cpu" {
  type    = number
  default = 256
}

variable "memory" {
  type    = number
  default = 512
}

variable "nginx_image" {
  type = string
}

variable "api_image" {
  type = string
}

variable "environment" {
  type    = map(string)
  default = {}
}

variable "secrets" {
  description = "Map of environment variable name to Secrets Manager ARN"
  type        = map(string)
  default     = {}
}

variable "alb_arn_suffix" {
  type        = string
  description = "Needed for CloudWatch alarm dimensions"
}

variable "target_group_arn_suffix" {
  type        = string
  description = "Needed for CloudWatch alarm dimensions"
}

variable "sns_topic_arn" {
  type    = string
  default = ""
}

locals {
  container_env = [for k, v in var.environment : {
    name  = k
    value = v
  }]

  container_secrets = [for k, v in var.secrets : {
    name      = k
    valueFrom = v
  }]
}

resource "aws_cloudwatch_log_group" "nginx" {
  name              = "/aws/ecs/${var.name}-nginx"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/ecs/${var.name}-api"
  retention_in_days = 30
}

locals {
  container_definitions = jsonencode([
    {
      name      = "nginx"
      image     = var.nginx_image
      essential = true
      portMappings = [{
        containerPort = 80
        hostPort      = 80
        protocol      = "tcp"
      }]
      environment = concat(local.container_env, [{ name = "NODE_BACKEND", value = "http://127.0.0.1:8080" }])
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.nginx.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "nginx"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
      dependsOn = [{
        containerName = "api"
        condition     = "START"
      }]
    },
    {
      name      = "api"
      image     = var.api_image
      essential = true
      portMappings = [{
        containerPort = 8080
        hostPort      = 8080
        protocol      = "tcp"
      }]
      environment = local.container_env
      secrets     = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/api/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])
}

data "aws_region" "current" {}

resource "aws_ecs_task_definition" "this" {
  family                   = var.name
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.execution_role_arn
  task_role_arn            = var.task_role_arn
  container_definitions    = local.container_definitions
}

resource "aws_ecs_service" "this" {
  name            = var.name
  cluster         = var.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200

  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = var.security_group_ids
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = "nginx"
    container_port   = 80
  }

  lifecycle {
    ignore_changes = [desired_count]
  }
}

resource "aws_cloudwatch_metric_alarm" "ecs_capacity" {
  alarm_name          = "${var.name}-ecs-running"
  alarm_description   = "Alert when ECS running task count drops below desired"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = 1
  metric_name         = "RunningTaskCount"
  namespace           = "ECS/ContainerInsights"
  period              = 60
  statistic           = "Maximum"
  threshold           = var.desired_count
  treat_missing_data  = "breaching"

  dimensions = {
    ClusterName = split("/", var.cluster_arn)[1]
    ServiceName = var.name
  }

  ok_actions    = var.sns_topic_arn == "" ? [] : [var.sns_topic_arn]
  alarm_actions = var.sns_topic_arn == "" ? [] : [var.sns_topic_arn]
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy" {
  alarm_name          = "${var.name}-alb-unhealthy"
  alarm_description   = "Alert when ALB reports unhealthy targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 0
  treat_missing_data  = "missing"

  dimensions = {
    TargetGroup  = var.target_group_arn_suffix
    LoadBalancer = var.alb_arn_suffix
  }

  ok_actions    = var.sns_topic_arn == "" ? [] : [var.sns_topic_arn]
  alarm_actions = var.sns_topic_arn == "" ? [] : [var.sns_topic_arn]
}

output "service_name" {
  value = aws_ecs_service.this.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.this.arn
}
