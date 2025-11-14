locals {
  name_prefix = "ds2-prod"
}

data "aws_s3_bucket" "assets" {
  # Existing assets bucket is read-only; never manage/import with Terraform.
  bucket = var.assets_bucket_name
}

# Reuses existing private subnets/NAT paths; does not create IGW or NAT resources.
# Data sources for existing infrastructure
data "aws_vpc" "main" {
  id = var.vpc_id
}

data "aws_subnets" "private" {
  filter {
    name   = "vpc-id"
    values = [var.vpc_id]
  }
  filter {
    name   = "subnet-id"
    values = var.private_subnet_ids
  }
}

# ALB removed for cost optimization - direct EC2 access via Route53
# ACM removed - nginx handles SSL with certificates on instance

resource "aws_security_group" "ecs_tasks" {
  name   = "${local.name_prefix}-ecs"
  vpc_id = data.aws_vpc.main.id

  # Allow HTTP from VPC and VPN
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["192.168.6.0/24", "173.31.0.0/20", "172.31.48.0/20", "192.168.168.0/24", "172.31.0.0/20", "192.168.0.0/24", "172.31.0.0/16"]
    description = "HTTP from VPC and VPN"
  }

  # Allow HTTPS from VPC and VPN
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["192.168.6.0/24", "173.31.0.0/20", "172.31.48.0/20", "192.168.168.0/24", "172.31.0.0/20", "192.168.0.0/24", "172.31.0.0/16"]
    description = "HTTPS from VPC and VPN"
  }

  # Allow ICMP (ping) from VPC and VPN
  ingress {
    from_port   = -1
    to_port     = -1
    protocol    = "icmp"
    cidr_blocks = ["192.168.6.0/24", "173.31.0.0/20", "172.31.48.0/20", "192.168.168.0/24", "172.31.0.0/20", "192.168.0.0/24", "172.31.0.0/16"]
    description = "ICMP from VPC and VPN"
  }

  # Allow frontend port 3003 from self (for nginx to reach frontend)
  ingress {
    from_port   = 3003
    to_port     = 3003
    protocol    = "tcp"
    self        = true
    description = "Frontend from nginx"
  }

  # Allow backend port 8003 from self (for nginx to reach backend)
  ingress {
    from_port   = 8003
    to_port     = 8003
    protocol    = "tcp"
    self        = true
    description = "Backend from nginx"
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-ecs-sg"
  }
}

resource "aws_security_group" "db" {
  name   = "${local.name_prefix}-db"
  vpc_id = data.aws_vpc.main.id

  ingress {
    description     = "ECS tasks"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.ecs_tasks.id]
  }

  dynamic "ingress" {
    for_each = var.db_allowed_cidrs
    content {
      description = "On-prem / VPN"
      from_port   = 5432
      to_port     = 5432
      protocol    = "tcp"
      cidr_blocks = [ingress.value]
    }
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${local.name_prefix}-db"
  }
}

resource "aws_sns_topic" "alerts" {
  name = "${local.name_prefix}-alerts"
}

resource "aws_sns_topic_subscription" "email" {
  count     = var.alert_email == "" ? 0 : 1
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# S3 backup bucket - data source for existing bucket
data "aws_s3_bucket" "backup" {
  bucket = "ds2-pg-backups-prod"
}

# Reference existing RDS instance instead of creating a new one
data "aws_db_instance" "existing" {
  db_instance_identifier = "ds2-shared-db"
}

# Use existing Secrets Manager secret for database credentials
data "aws_secretsmanager_secret" "db_credentials" {
  name = "ds2-shared-db-credentials"
}

# Use existing secrets
data "aws_secretsmanager_secret" "app_jwt" {
  name = "backend/dev/APP_JWT_SECRET"
}

locals {
  # Secrets from AWS Secrets Manager (sensitive values)
  ecs_secrets = {
    DATABASE_USER        = "${data.aws_secretsmanager_secret.db_credentials.arn}:username::"
    DATABASE_PASSWORD    = "${data.aws_secretsmanager_secret.db_credentials.arn}:password::"
    JWT_SECRET           = data.aws_secretsmanager_secret.app_jwt.arn
  }
  
  # Non-sensitive environment variables
  ecs_environment = {
    NODE_ENV                = var.node_env
    NODE_PORT_PROD          = "8003"
    DB_PROD_HOST            = data.aws_db_instance.existing.address
    DATABASE_NAME           = "ds2_prod"
    FRONT_END_URL_PROD      = "https://${format("%s.%s", var.alb_record_name, var.route53_zone_name)}"
    HOST_IP_PROD            = "0.0.0.0"
    DOMAIN                  = var.route53_zone_name
    JWT_EXPIRATION          = "11h"
    FROM_EMAIL              = var.from_email
    FROM_EMAIL_USERNAME     = var.from_email_username
    FROM_EMAIL_SMTP         = var.from_email_smtp
    FROM_EMAIL_PASSWORD     = var.from_email_password
    API_TOKEN               = var.api_token
    S3_REGION               = var.s3_region
    S3_BUCKET_NAME          = var.s3_bucket_name
    S3_ENDPOINT             = var.s3_endpoint
    S3_ACCESS_KEY_ID        = var.s3_access_key_id
    S3_SECRET_ACCESS_KEY    = var.s3_secret_access_key
  }
}

# ==============================================================================
# ECR REPOSITORIES - Container Image Storage
# ==============================================================================

resource "aws_ecr_repository" "backend" {
  name                 = "${local.name_prefix}-backend"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
  
  tags = {
    Name = "${local.name_prefix}-backend-ecr"
  }
}

resource "aws_ecr_repository" "frontend" {
  name                 = "${local.name_prefix}-frontend"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
  
  tags = {
    Name = "${local.name_prefix}-frontend-ecr"
  }
}

resource "aws_ecr_repository" "nginx" {
  name                 = "${local.name_prefix}-nginx"
  image_tag_mutability = "MUTABLE"
  
  image_scanning_configuration {
    scan_on_push = true
  }
  
  tags = {
    Name = "${local.name_prefix}-nginx-ecr"
  }
}

# ECR Lifecycle Policy - Keep last 10 images
resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name
  
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus     = "any"
        countType     = "imageCountMoreThan"
        countNumber   = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "frontend" {
  repository = aws_ecr_repository.frontend.name
  
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus     = "any"
        countType     = "imageCountMoreThan"
        countNumber   = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

resource "aws_ecr_lifecycle_policy" "nginx" {
  repository = aws_ecr_repository.nginx.name
  
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus     = "any"
        countType     = "imageCountMoreThan"
        countNumber   = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# IAM Roles for ECS
resource "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution_policy" {
  role       = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  name = "${local.name_prefix}-ecs-execution-secrets"
  role = aws_iam_role.ecs_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "kms:Decrypt"
        ]
        Resource = [
          data.aws_secretsmanager_secret.db_credentials.arn,
          data.aws_secretsmanager_secret.app_jwt.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "ecs_task_s3" {
  name = "${local.name_prefix}-ecs-task-s3"
  role = aws_iam_role.ecs_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket"
        ]
        Resource = [
          data.aws_s3_bucket.backup.arn,
          "${data.aws_s3_bucket.backup.arn}/*",
          data.aws_s3_bucket.assets.arn,
          "${data.aws_s3_bucket.assets.arn}/*"
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "kms:Decrypt",
          "kms:Encrypt",
          "kms:GenerateDataKey"
        ]
        Resource = ["*"]
      }
    ]
  })
}

# ECS Cluster with Container Insights
resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-ecs-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${local.name_prefix}-ecs-cluster"
  }
}

# Launch template for ECS EC2 instances
data "aws_ami" "ecs_optimized" {
  most_recent = true
  owners      = ["amazon"]
  
  filter {
    name   = "name"
    values = ["amzn2-ami-ecs-hvm-*-x86_64-ebs"]
  }
}

resource "aws_launch_template" "ecs" {
  name_prefix   = "${local.name_prefix}-ecs-"
  image_id      = data.aws_ami.ecs_optimized.id
  instance_type = "t3.small"
  
  vpc_security_group_ids = [aws_security_group.ecs_tasks.id]
  
  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance.name
  }
  
  user_data = base64encode(<<-EOF
    #!/bin/bash
    echo ECS_CLUSTER=${aws_ecs_cluster.main.name} >> /etc/ecs/ecs.config
    echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config
    EOF
  )
  
  monitoring {
    enabled = true
  }
  
  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "DS2 Server"
    }
  }
}

# IAM role for EC2 instances
resource "aws_iam_role" "ecs_instance" {
  name = "${local.name_prefix}-ecs-instance-role"
  
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_instance" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"
}

resource "aws_iam_role_policy_attachment" "ecs_instance_ssm" {
  role       = aws_iam_role.ecs_instance.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_instance_profile" "ecs_instance" {
  name = "${local.name_prefix}-ecs-instance-profile"
  role = aws_iam_role.ecs_instance.name
}

# Auto Scaling Group for ECS instances
resource "aws_autoscaling_group" "ecs" {
  name                = "${local.name_prefix}-ecs-asg"
  vpc_zone_identifier = var.private_subnet_ids
  min_size            = 1
  max_size            = 1
  desired_capacity    = 1
  health_check_type   = "EC2"
  health_check_grace_period = 300
  
  launch_template {
    id      = aws_launch_template.ecs.id
    version = "$Latest"
  }
  
  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-ecs-instance"
    propagate_at_launch = true
  }
  
  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }
}

# ECS Capacity Provider for auto-scaling
resource "aws_ecs_capacity_provider" "this" {
  name = "${local.name_prefix}-capacity-provider"
  
  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.ecs.arn
    managed_termination_protection = "DISABLED"
    
    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 80
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 2
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = [aws_ecs_capacity_provider.this.name]
  
  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.this.name
    weight            = 1
    base              = 1
  }
}

# ECS Task Definition (no longer requires Fargate-specific settings)
# ==============================================================================
# BACKEND ECS TASK DEFINITION
# ==============================================================================

resource "aws_ecs_task_definition" "backend" {
  family                = "${local.name_prefix}-backend"
  network_mode          = "bridge"
  execution_role_arn    = aws_iam_role.ecs_execution.arn
  task_role_arn         = aws_iam_role.ecs_task.arn
  
  container_definitions = jsonencode([
    {
      name      = "backend"
      image     = "${aws_ecr_repository.backend.repository_url}:latest"
      essential = true
      memory    = 512
      portMappings = [{
        containerPort = 8003
        hostPort      = 8003
        protocol      = "tcp"
      }]
      environment = [for k, v in local.ecs_environment : { name = k, value = tostring(v) }]
      secrets     = [for k, v in local.ecs_secrets : { name = k, valueFrom = v }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.backend.name
          "awslogs-region"        = "us-west-2"
          "awslogs-stream-prefix" = "backend"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8003/api/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])
}

# CloudWatch Log Group for Backend
resource "aws_cloudwatch_log_group" "backend" {
  name              = "/aws/ecs/${local.name_prefix}-backend"
  retention_in_days = 14
}

# ECS Service (EC2 launch type)
# ==============================================================================
# BACKEND ECS SERVICE
# ==============================================================================

resource "aws_ecs_service" "backend" {
  name            = "${local.name_prefix}-backend-service"
  cluster         = aws_ecs_cluster.main.arn
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = 1
  
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100
  
  # No load balancer - direct access to EC2 instance
  
  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.this.name
    weight            = 1
    base              = 0
  }
  
  lifecycle {
    ignore_changes = [desired_count]
  }
  
  depends_on = [aws_autoscaling_group.ecs]
}

# CloudWatch Alarms for monitoring
resource "aws_cloudwatch_metric_alarm" "ecs_cpu_high" {
  alarm_name          = "${local.name_prefix}-ecs-cpu-high"
  alarm_description   = "Alert when ECS instance CPU usage is high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  
  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.ecs.name
  }
  
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "ecs_memory_high" {
  alarm_name          = "${local.name_prefix}-backend-memory-high"
  alarm_description   = "Alert when backend ECS memory usage is high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  
  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.backend.name
  }
  
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ALB unhealthy alarm removed - no ALB in use

# ==============================================================================
# AUTO-SHUTDOWN SCHEDULE - Removed (single-user app runs 24/7)
# ==============================================================================

# Scheduled scaling removed - single-user app runs 24/7

# Data source for Route53 hosted zone
data "aws_route53_zone" "main" {
  name         = var.route53_zone_name
  private_zone = false
}

# Data source to get DS2 Server instance (created by ASG)
data "aws_instances" "ds2_server" {
  filter {
    name   = "tag:Name"
    values = ["DS2 Server"]
  }
  
  filter {
    name   = "instance-state-name"
    values = ["running"]
  }
  
  depends_on = [aws_autoscaling_group.ecs]
}

# Route53 record pointing to DS2 Server instance
resource "aws_route53_record" "ds2" {
  zone_id = data.aws_route53_zone.main.zone_id
  name    = format("%s.%s", var.alb_record_name, var.route53_zone_name)
  type    = "A"
  ttl     = 60
  
  # Use the private IP of the first (and only) instance
  records = length(data.aws_instances.ds2_server.private_ips) > 0 ? [data.aws_instances.ds2_server.private_ips[0]] : ["10.0.0.1"]
  
  lifecycle {
    ignore_changes = [records]
  }
}

# TODO: Re-enable once ECR repository and pgdump image are built
# module "lambda_pg_dump" {
#   source             = "./modules/lambda_pg_dump"
#   function_name      = "${local.name_prefix}-pgdump"
#   image_uri          = var.lambda_image_uri
#   subnet_ids         = module.network.private_subnet_ids
#   security_group_ids = [aws_security_group.ecs_tasks.id]
#   lambda_role_arn    = module.iam.lambda_role_arn
#   db_secret_arn      = module.database.secret_arn
#   backup_bucket_name = module.backup_bucket.bucket_name
#   sns_topic_arn      = aws_sns_topic.alerts.arn
#   environment = {
#     PGDATABASE = module.database.database_name
#     PGHOST     = module.database.endpoint
#     PGPORT     = module.database.port
#   }
# }
