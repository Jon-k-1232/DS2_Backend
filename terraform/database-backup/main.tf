terraform {
  required_version = ">= 1.5.0"
  
  cloud {
    organization = "Jon_Kimmel"
    workspaces {
      name = "ds2-database-backup-prod"
    }
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# S3 Bucket for Database Backups
resource "aws_s3_bucket" "backups" {
  bucket = var.s3_bucket_name
  
  tags = {
    Name        = var.s3_bucket_name
    Environment = "production"
    Purpose     = "database-backups"
  }
}

resource "aws_s3_bucket_versioning" "backups" {
  bucket = aws_s3_bucket.backups.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_id
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "backups" {
  bucket = aws_s3_bucket.backups.id

  rule {
    id     = "delete-old-backups"
    status = "Enabled"

    filter {
      prefix = ""
    }

    expiration {
      days = 180  # 6 months
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

# Lambda Execution Role
resource "aws_iam_role" "lambda" {
  name = "ds2-database-backup-lambda-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })

  tags = {
    Name = "ds2-database-backup-lambda-role"
  }
}

resource "aws_iam_role_policy" "lambda" {
  name = "ds2-database-backup-lambda-policy"
  role = aws_iam_role.lambda.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:PutObjectAcl"
        ]
        Resource = "${aws_s3_bucket.backups.arn}/*"
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey"
        ]
        Resource = [var.kms_key_id]
      },
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [var.db_secret_arn]
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow"
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface",
          "ec2:AssignPrivateIpAddresses",
          "ec2:UnassignPrivateIpAddresses"
        ]
        Resource = "*"
      }
    ]
  })
}

# Lambda Security Group
resource "aws_security_group" "lambda" {
  name        = "ds2-database-backup-lambda-sg"
  description = "Security group for database backup Lambda"
  vpc_id      = var.vpc_id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ds2-database-backup-lambda-sg"
  }
}

# Allow Lambda to connect to RDS
resource "aws_security_group_rule" "rds_allow_lambda" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = var.rds_security_group_id
  source_security_group_id = aws_security_group.lambda.id
  description              = "Allow database backup Lambda to connect to RDS"
}

# ECR Repository for Lambda Image
resource "aws_ecr_repository" "lambda" {
  name                 = "ds2-database-backup-lambda"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "ds2-database-backup-lambda"
  }
}

# Lambda Function
resource "aws_lambda_function" "backup" {
  function_name = "ds2-database-backup"
  role          = aws_iam_role.lambda.arn
  package_type  = "Image"
  image_uri     = "${aws_ecr_repository.lambda.repository_url}:latest"
  timeout       = 900  # 15 minutes
  memory_size   = 2048 # 2GB for large databases

  vpc_config {
    subnet_ids         = var.private_subnet_ids
    security_group_ids = [aws_security_group.lambda.id]
  }

  environment {
    variables = {
      DB_HOST       = var.db_host
      DB_PORT       = var.db_port
      DB_NAME       = var.db_name
      DB_SECRET_ARN = var.db_secret_arn
      S3_BUCKET     = aws_s3_bucket.backups.id
    }
  }

  tags = {
    Name = "ds2-database-backup"
  }
}

# CloudWatch Event Rule - Weekly on Sundays at 3 AM UTC
resource "aws_cloudwatch_event_rule" "weekly" {
  name                = "ds2-database-backup-weekly"
  description         = "Trigger database backup weekly on Sundays"
  schedule_expression = "cron(0 3 ? * SUN *)"  # 3 AM UTC every Sunday

  tags = {
    Name = "ds2-database-backup-weekly"
  }
}

resource "aws_cloudwatch_event_target" "lambda" {
  rule      = aws_cloudwatch_event_rule.weekly.name
  target_id = "ds2-database-backup-lambda"
  arn       = aws_lambda_function.backup.arn
}

resource "aws_lambda_permission" "eventbridge" {
  statement_id  = "AllowExecutionFromEventBridge"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.backup.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.weekly.arn
}
