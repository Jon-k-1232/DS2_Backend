output "alb_dns_name" {
  value       = module.alb.lb_dns_name
  description = "ALB DNS name"
}

output "cluster_name" {
  value       = module.ecs_cluster.cluster_name
  description = "ECS cluster name"
}

output "service_name" {
  value       = module.ecs_service.service_name
  description = "ECS service name"
}

output "route53_fqdn" {
  value       = format("%s.%s", var.alb_record_name, var.route53_zone_name)
  description = "Full DNS name for the application"
}
