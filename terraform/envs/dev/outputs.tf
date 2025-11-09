output "alb_dns_name" {
  value = module.alb.lb_dns_name
}

output "current_backend_image" {
  value = var.backend_image
}

output "current_frontend_image" {
  value = var.frontend_image
}
