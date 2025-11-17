output "s3_bucket_name" {
  description = "Name of the S3 bucket storing backups"
  value       = aws_s3_bucket.backups.id
}

output "s3_bucket_arn" {
  description = "ARN of the S3 bucket"
  value       = aws_s3_bucket.backups.arn
}

output "lambda_function_name" {
  description = "Name of the backup Lambda function"
  value       = aws_lambda_function.backup.function_name
}

output "lambda_function_arn" {
  description = "ARN of the backup Lambda function"
  value       = aws_lambda_function.backup.arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for Lambda image"
  value       = aws_ecr_repository.lambda.repository_url
}

output "backup_schedule" {
  description = "Backup schedule"
  value       = "Weekly on Sundays at 3 AM UTC (7 PM PST Saturday)"
}
