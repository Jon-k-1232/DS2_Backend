terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "name_prefix" {
  type        = string
  description = "Prefix for IAM role names"
}

variable "secrets_manager_arns" {
  type        = list(string)
  description = "Secrets that ECS tasks and Lambda need to read"
  default     = []
}

variable "s3_backup_bucket_arn" {
  type        = string
  description = "Backup bucket ARN for Lambda uploads"
  default     = ""
}

variable "kms_key_arn" {
  type        = string
  description = "KMS key used for S3 encryption"
  default     = ""
}

resource "aws_iam_role" "ecs_execution" {
  name = "${var.name_prefix}-ecs-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task" {
  name = "${var.name_prefix}-ecs-task"

  assume_role_policy = aws_iam_role.ecs_execution.assume_role_policy
}

locals {
  ecs_runtime_statements = concat(
    length(var.secrets_manager_arns) > 0 ? [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secrets_manager_arns
    }] : [],
    [{
      Effect   = "Allow"
      Action   = [
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
      Resource = "*"
    }]
  )

  lambda_statements = concat(
    [{
      Effect   = "Allow"
      Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "*"
    }],
    [{
      Effect   = "Allow"
      Action   = [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ]
      Resource = "*"
    }],
    length(var.secrets_manager_arns) > 0 ? [{
      Effect   = "Allow"
      Action   = ["secretsmanager:GetSecretValue"]
      Resource = var.secrets_manager_arns
    }] : [],
    var.s3_backup_bucket_arn != "" ? [{
      Effect   = "Allow"
      Action   = ["s3:PutObject", "s3:AbortMultipartUpload", "s3:ListBucket"]
      Resource = [
        var.s3_backup_bucket_arn,
        "${var.s3_backup_bucket_arn}/*"
      ]
    }] : [],
    var.kms_key_arn != "" ? [{
      Effect   = "Allow"
      Action   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
      Resource = [var.kms_key_arn]
    }] : []
  )
}

resource "aws_iam_policy" "ecs_runtime" {
  name        = "${var.name_prefix}-ecs-runtime"
  description = "Allow ECS task to read runtime secrets and emit logs"
  policy = jsonencode({
    Version   = "2012-10-17"
    Statement = local.ecs_runtime_statements
  })
}

resource "aws_iam_role_policy_attachment" "ecs_runtime" {
  role       = aws_iam_role.ecs_task.name
  policy_arn = aws_iam_policy.ecs_runtime.arn
}

resource "aws_iam_role" "lambda_pg_dump" {
  name = "${var.name_prefix}-lambda-pgdump"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_inline" {
  name = "${var.name_prefix}-lambda-inline"
  role = aws_iam_role.lambda_pg_dump.id

  policy = jsonencode({
    Version   = "2012-10-17",
    Statement = local.lambda_statements
  })
}

resource "aws_iam_role_policy" "lambda_network" {
  name = "${var.name_prefix}-lambda-network"
  role = aws_iam_role.lambda_pg_dump.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = [
        "ec2:CreateNetworkInterface",
        "ec2:DescribeNetworkInterfaces",
        "ec2:DeleteNetworkInterface"
      ]
      Resource = "*"
    }]
  })
}

resource "aws_iam_role_policy" "lambda_ecr" {
  name = "${var.name_prefix}-lambda-ecr"
  role = aws_iam_role.lambda_pg_dump.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = [
        "ecr:GetAuthorizationToken",
        "ecr:BatchGetImage",
        "ecr:GetDownloadUrlForLayer"
      ]
      Resource = "*"
    }]
  })
}

output "ecs_execution_role_arn" {
  value = aws_iam_role.ecs_execution.arn
}

output "ecs_task_role_arn" {
  value = aws_iam_role.ecs_task.arn
}

output "lambda_role_arn" {
  value = aws_iam_role.lambda_pg_dump.arn
}
