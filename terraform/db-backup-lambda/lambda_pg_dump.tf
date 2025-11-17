resource "aws_security_group" "lambda_sg" {
  name        = "ds2-pg-dump-lambda-sg"
  description = "Security group for Lambda backup function"
  vpc_id      = "vpc-04f4c4cf527f99b9a"

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "ds2-pg-dump-lambda-sg"
  }
}

resource "aws_security_group_rule" "rds_allow_lambda" {
  type                     = "ingress"
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  security_group_id        = "sg-01f925e5f259fd55a"
  source_security_group_id = aws_security_group.lambda_sg.id
  description              = "Allow Lambda backup function to access RDS"
}

resource "aws_lambda_function" "pg_dump" {
  function_name = "ds2-pg-dump"
  role          = aws_iam_role.pg_dump_lambda.arn
  package_type  = "Image"
  image_uri     = "561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-pg-dump-lambda:latest"
  timeout       = 900
  memory_size   = 1024

  vpc_config {
    subnet_ids         = ["subnet-0acc9b809e7808b43", "subnet-0e30e764faaeca235"]
    security_group_ids = [aws_security_group.lambda_sg.id]
  }

  environment {
    variables = {
      PGHOST     = var.db_host
      PGPORT     = var.db_port
      PGUSER     = var.db_user
      PGPASSWORD = var.db_password
      PGDATABASE = var.db_name
      S3_BUCKET  = var.s3_bucket_name
    }
  }
}

resource "aws_iam_role" "pg_dump_lambda" {
  name = "ds2-pg-dump-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "pg_dump_lambda_policy" {
  name = "ds2-pg-dump-lambda-policy"
  role = aws_iam_role.pg_dump_lambda.id
  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = ["s3:PutObject", "s3:ListBucket"],
        Resource = [
          "arn:aws:s3:::${var.s3_bucket_name}",
          "arn:aws:s3:::${var.s3_bucket_name}/*"
        ]
      },
      {
        Effect = "Allow",
        Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"],
        Resource = "arn:aws:logs:*:*:*"
      },
      {
        Effect = "Allow",
        Action = [
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:BatchCheckLayerAvailability"
        ],
        Resource = "arn:aws:ecr:us-west-2:561979538576:repository/ds2-pg-dump-lambda"
      },
      {
        Effect = "Allow",
        Action = "ecr:GetAuthorizationToken",
        Resource = "*"
      },
      {
        Effect = "Allow",
        Action = [
          "kms:Decrypt",
          "kms:GenerateDataKey"
        ],
        Resource = "arn:aws:kms:us-west-2:561979538576:key/3805f210-a2ed-4dd4-8bd5-bf7afb0b66c6"
      },
      {
        Effect = "Allow",
        Action = [
          "ec2:CreateNetworkInterface",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DeleteNetworkInterface"
        ],
        Resource = "*"
      }
    ]
  })
}

resource "aws_cloudwatch_event_rule" "daily_pg_dump" {
  name                = "ds2-pg-dump-every-6-days"
  schedule_expression = "rate(6 days)" # Every 6 days
}

resource "aws_cloudwatch_event_target" "pg_dump_lambda" {
  rule      = aws_cloudwatch_event_rule.daily_pg_dump.name
  target_id = "pg-dump-lambda"
  arn       = aws_lambda_function.pg_dump.arn
}

resource "aws_lambda_permission" "allow_events" {
  statement_id  = "AllowExecutionFromCloudWatch"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.pg_dump.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.daily_pg_dump.arn
}

resource "aws_s3_bucket_lifecycle_configuration" "pg_backups" {
  bucket = var.s3_bucket_name

  rule {
    id     = "MoveToGlacierAfter30Days"
    status = "Enabled"

    filter {
      prefix = "pg_backups/"
    }

    transition {
      days          = 30
      storage_class = "GLACIER"
    }
    expiration {
      days = 730 # 2 years
    }
  }
}
