terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "function_name" {
  type        = string
  description = "Lambda function name"
}

variable "image_uri" {
  type        = string
  description = "ECR image uri that bundles pg_dump tooling"
}

variable "subnet_ids" {
  type        = list(string)
}

variable "security_group_ids" {
  type        = list(string)
}

variable "lambda_role_arn" {
  type        = string
}

variable "db_secret_arn" {
  type        = string
}

variable "backup_bucket_name" {
  type        = string
}

variable "schedule_expression" {
  type        = string
  default     = "cron(0 10 * * ? *)" # 02:00 Pacific
}

variable "environment" {
  type        = map(string)
  default     = {}
}

variable "sns_topic_arn" {
  type    = string
  default = ""
}

resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${var.function_name}"
  retention_in_days = 30
}

resource "aws_lambda_function" "this" {
  function_name = var.function_name
  role          = var.lambda_role_arn
  package_type  = "Image"
  image_uri     = var.image_uri
  timeout       = 900
  memory_size   = 512

  vpc_config {
    subnet_ids         = var.subnet_ids
    security_group_ids = var.security_group_ids
  }

  environment {
    variables = merge({
      DB_SECRET_ARN      = var.db_secret_arn,
      BACKUP_BUCKET_NAME = var.backup_bucket_name
    }, var.environment)
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

resource "aws_cloudwatch_event_rule" "schedule" {
  name                = "${var.function_name}-schedule"
  schedule_expression = var.schedule_expression
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule      = aws_cloudwatch_event_rule.schedule.name
  target_id = "${var.function_name}-target"
  arn       = aws_lambda_function.this.arn
}

resource "aws_lambda_permission" "allow_events" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.schedule.arn
}

resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  alarm_name          = "${var.function_name}-errors"
  alarm_description   = "Alert when pg_dump Lambda fails"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "Errors"
  namespace           = "AWS/Lambda"
  period              = 300
  statistic           = "Sum"
  threshold           = 0
  treat_missing_data  = "notBreaching"
  dimensions = {
    FunctionName = aws_lambda_function.this.function_name
  }
  ok_actions    = var.sns_topic_arn == "" ? [] : [var.sns_topic_arn]
  alarm_actions = var.sns_topic_arn == "" ? [] : [var.sns_topic_arn]
}

output "function_arn" {
  value = aws_lambda_function.this.arn
}
