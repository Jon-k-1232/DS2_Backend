output "database_endpoint" {
  value       = module.database.endpoint
  description = "RDS database endpoint"
}

output "database_name_dev" {
  value       = module.database.database_name
  description = "Auto-created ds2_dev database name"
}

output "database_secret_arn" {
  value       = module.database.secret_arn
  description = "Secrets Manager ARN for database credentials"
}

output "db_security_group_id" {
  value       = aws_security_group.db.id
  description = "Database security group ID (for backend ECS to reference)"
}

output "backup_bucket_name" {
  value       = module.backup_bucket.bucket_name
  description = "PostgreSQL backup S3 bucket name"
}
