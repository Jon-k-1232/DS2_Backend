output "alb_dns_name" {
  value = module.alb.lb_dns_name
}

output "alb_security_group_id" {
  value = module.alb.security_group_id
}

output "ecs_service_name" {
  value = module.ecs_service.service_name
}

output "certificate_validation_records" {
  value = module.acm.dns_validation_records
}

output "pg_backup_bucket" {
  value = module.backup_bucket.bucket_name
}

output "lambda_function_arn" {
  value = module.lambda_pg_dump.function_arn
}

output "current_backend_image" {
  value = var.backend_image
}

output "current_frontend_image" {
  value = var.frontend_image
}
