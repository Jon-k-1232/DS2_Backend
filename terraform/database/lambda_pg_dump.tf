resource "aws_lambda_function" "pg_dump" {
  function_name = "ds2-pg-dump"
  role          = aws_iam_role.pg_dump_lambda.arn
  handler       = "lambda_function.lambda_handler"
  runtime       = "python3.11"
  timeout       = 900
  memory_size   = 1024

  image_uri     = "561979538576.dkr.ecr.us-west-2.amazonaws.com/ds2-pg-dump-lambda:latest"

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
      }
    ]
  })
}

resource "aws_cloudwatch_event_rule" "daily_pg_dump" {
  name                = "ds2-pg-dump-daily"
  schedule_expression = "cron(0 7 * * ? *)" # 7am UTC daily
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
