variable "aws_region" {
  type    = string
  default = "us-west-2"
}

variable "vpc_id" {
  type    = string
  default = "vpc-04f4c4cf527f99b9a"
}

variable "private_subnet_ids" {
  type = list(string)
  default = [
    "subnet-0acc9b809e7808b43",
    "subnet-0e30e764faaeca235"
  ]
}

variable "assets_bucket_name" {
  type    = string
  default = "ds2-shared-assets"
}

variable "backend_image" {
  type        = string
  description = "Backend Docker image URI"
  default     = "561979538576.dkr.ecr.us-west-2.amazonaws.com/backend:latest"
}

variable "nginx_image" {
  type        = string
  description = "Nginx proxy Docker image URI"
  default     = "561979538576.dkr.ecr.us-west-2.amazonaws.com/nginx:latest"
}

variable "alert_email" {
  type    = string
  default = "networknotifications@kimmeloffice.com"
}

variable "alb_allowed_cidrs" {
  type = list(string)
  default = [
    "173.31.0.0/20",
    "192.168.0.0/24",
    "192.168.6.0/24",
    "192.168.10.0/26",
    "192.168.12.0/26",
    "192.168.40.0/24",
    "192.168.168.0/24",
    "172.31.0.0/20",
    "172.31.48.0/20",
    "172.31.64.0/20"
  ]
}

variable "route53_zone_name" {
  type    = string
  default = "kimmelOffice.internal"
}

variable "alb_record_name" {
  type    = string
  default = "ds2"
}

variable "desired_count" {
  type        = number
  description = "Desired number of ECS tasks"
  default     = 2
}

variable "task_cpu" {
  type        = number
  description = "CPU units for ECS task"
  default     = 512
}

variable "task_memory" {
  type        = number
  description = "Memory (MB) for ECS task"
  default     = 1024
}
