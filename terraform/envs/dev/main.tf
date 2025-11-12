locals {
  name_prefix = "ds2-dev"
}

data "aws_s3_bucket" "assets" {
  # Existing assets bucket is read-only; never manage/import with Terraform.
  bucket = var.assets_bucket_name
}

# Reuses existing private subnets/NAT paths; does not create IGW or NAT resources.
module "network" {
  source             = "./modules/vpc"
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids
}

module "acm" {
  source      = "./modules/acm"
  domain_name = "dev.ds2.kimmeloffice.com"
}

module "alb" {
  source               = "./modules/alb"
  name                 = "${local.name_prefix}-alb"
  vpc_id               = module.network.vpc_id
  subnet_ids           = module.network.private_subnet_ids
  allowed_ingress_cidrs = var.alb_allowed_cidrs
  certificate_arn      = module.acm.certificate_arn
}

resource "aws_security_group" "ecs_tasks" {
  name   = "${local.name_prefix}-ecs"
  vpc_id = module.network.vpc_id

  ingress {
    from_port       = 80
    to_port         = 80
    protocol        = "tcp"
    security_groups = [module.alb.security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "db" {
  name   = "${local.name_prefix}-db"
  vpc_id = module.network.vpc_id

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

module "backup_bucket" {
  source      = "./modules/s3_backup"
  bucket_name = "ds2-pg-backups-dev"
}

# Reference existing RDS instance instead of creating a new one
data "aws_db_instance" "existing" {
  db_instance_identifier = "ds2-shared-db"
}

# Create Secrets Manager secret for database credentials
resource "aws_secretsmanager_secret" "db_credentials" {
  name        = "ds2-dev-db-credentials"
  description = "Database credentials for existing ds2-shared-db"
}

resource "aws_secretsmanager_secret_version" "db_credentials" {
  secret_id     = aws_secretsmanager_secret.db_credentials.id
  secret_string = jsonencode({
    username = var.db_username
    password = var.db_password
    host     = data.aws_db_instance.existing.address
    port     = data.aws_db_instance.existing.port
    database = "ds2_dev"
    engine   = "postgres"
  })
}

resource "random_password" "dev_jwt" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "app_jwt" {
  name        = "backend/dev/APP_JWT_SECRET"
  description = "DEV JWT secret"
}

resource "aws_secretsmanager_secret_version" "app_jwt" {
  secret_id     = aws_secretsmanager_secret.app_jwt.id
  secret_string = jsonencode({ value = random_password.dev_jwt.result })
}

# Store sensitive application secrets
resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "backend/dev/APP_SECRETS"
  description = "Sensitive application secrets for DS2 Dev"
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id     = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    API_TOKEN             = var.api_token
    FROM_EMAIL_PASSWORD   = var.from_email_password
    S3_SECRET_ACCESS_KEY  = var.s3_secret_access_key
  })
}

locals {
  # Secrets from AWS Secrets Manager (sensitive values)
  ecs_secrets = {
    DB_SECRET            = aws_secretsmanager_secret.db_credentials.arn
    JWT_SECRET           = aws_secretsmanager_secret.app_jwt.arn
    APP_SECRETS          = aws_secretsmanager_secret.app_secrets.arn
  }
  
  # Non-sensitive environment variables
  ecs_environment = {
    NODE_ENV             = "development"
    NODE_PORT_DEV        = "8080"
    DB_DEV_HOST          = data.aws_db_instance.existing.address
    FRONT_END_URL_DEV    = "http://${module.alb.lb_dns_name}"
    HOST_IP_DEV          = "0.0.0.0"
    DOMAIN               = var.route53_zone_name
    JWT_EXPIRATION       = "11h"
    FROM_EMAIL           = "NetworkNotifications@kimmelOffice.com"
    FROM_EMAIL_USERNAME  = "UDM@KimmelOffice.com"
    FROM_EMAIL_SMTP      = "smtp.mail.us-west-2.awsapps.com"
    S3_REGION            = "us-west-2"
    S3_BUCKET_NAME       = "ds2-dev-561979538576"
    S3_ENDPOINT          = "https://bucket.vpce-03afe8ea29a768fbe-z7qhjgd9.s3.us-west-2.vpce.amazonaws.com"
    S3_ACCESS_KEY_ID     = var.s3_access_key_id
  }
}

module "iam" {
  source               = "./modules/iam"
  name_prefix          = local.name_prefix
  secrets_manager_arns = [aws_secretsmanager_secret.db_credentials.arn, aws_secretsmanager_secret.app_jwt.arn]
  s3_backup_bucket_arn = module.backup_bucket.bucket_arn
  kms_key_arn          = module.backup_bucket.kms_key_arn
}

# ECS Cluster with Container Insights
module "ecs_cluster" {
  source = "./modules/ecs_cluster"
  name   = "${local.name_prefix}-cluster"
}

# Launch template for ECS EC2 instances
data "aws_ami" "ecs_optimized" {
  most_recent = true
  owners      = ["amazon"]
  
  filter {
    name   = "name"
    values = ["amzn2-ami-ecs-hvm-*-arm64-ebs"]
  }
}

resource "aws_launch_template" "ecs" {
  name_prefix   = "${local.name_prefix}-ecs-"
  image_id      = data.aws_ami.ecs_optimized.id
  instance_type = "t4g.small"
  
  vpc_security_group_ids = [aws_security_group.ecs_tasks.id]
  
  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance.name
  }
  
  user_data = base64encode(<<-EOF
    #!/bin/bash
    echo ECS_CLUSTER=${module.ecs_cluster.cluster_id} >> /etc/ecs/ecs.config
    echo ECS_ENABLE_CONTAINER_METADATA=true >> /etc/ecs/ecs.config
    EOF
  )
  
  monitoring {
    enabled = true
  }
  
  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${local.name_prefix}-ecs-instance"
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
  vpc_zone_identifier = module.network.private_subnet_ids
  min_size            = 1
  max_size            = 3
  desired_capacity    = 1
  health_check_type   = "ELB"
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
  cluster_name       = module.ecs_cluster.cluster_id
  capacity_providers = [aws_ecs_capacity_provider.this.name]
  
  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.this.name
    weight            = 1
    base              = 1
  }
}

# ECS Task Definition (no longer requires Fargate-specific settings)
resource "aws_ecs_task_definition" "this" {
  family                = "${local.name_prefix}-service"
  network_mode          = "bridge"
  execution_role_arn    = module.iam.ecs_execution_role_arn
  task_role_arn         = module.iam.ecs_task_role_arn
  
  container_definitions = jsonencode([
    {
      name      = "nginx"
      image     = var.frontend_image
      essential = true
      memory    = 256
      portMappings = [{
        containerPort = 80
        hostPort      = 0  # Dynamic port mapping
        protocol      = "tcp"
      }]
      environment = concat(
        [for k, v in local.ecs_environment : { name = k, value = tostring(v) }],
        [{ name = "NODE_BACKEND", value = "http://localhost:8080" }]
      )
      secrets = [for k, v in local.ecs_secrets : { name = k, valueFrom = v }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.nginx.name
          "awslogs-region"        = "us-west-2"
          "awslogs-stream-prefix" = "nginx"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
      links = ["api"]
    },
    {
      name      = "api"
      image     = var.backend_image
      essential = true
      memory    = 256
      portMappings = [{
        containerPort = 8080
        hostPort      = 8080
        protocol      = "tcp"
      }]
      environment = [for k, v in local.ecs_environment : { name = k, value = tostring(v) }]
      secrets     = [for k, v in local.ecs_secrets : { name = k, valueFrom = v }]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = "us-west-2"
          "awslogs-stream-prefix" = "api"
        }
      }
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:8080/api/healthz || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 10
      }
    }
  ])
}

# CloudWatch Log Groups
resource "aws_cloudwatch_log_group" "nginx" {
  name              = "/aws/ecs/${local.name_prefix}-service-nginx"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/ecs/${local.name_prefix}-service-api"
  retention_in_days = 30
}

# ECS Service (EC2 launch type)
resource "aws_ecs_service" "this" {
  name            = "${local.name_prefix}-service"
  cluster         = module.ecs_cluster.cluster_arn
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = 1
  
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  
  load_balancer {
    target_group_arn = module.alb.target_group_arn
    container_name   = "nginx"
    container_port   = 80
  }
  
  capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.this.name
    weight            = 1
    base              = 1
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
  alarm_name          = "${local.name_prefix}-ecs-memory-high"
  alarm_description   = "Alert when ECS memory usage is high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "MemoryUtilization"
  namespace           = "AWS/ECS"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  
  dimensions = {
    ClusterName = module.ecs_cluster.cluster_id
    ServiceName = aws_ecs_service.this.name
  }
  
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

resource "aws_cloudwatch_metric_alarm" "alb_unhealthy" {
  alarm_name          = "${local.name_prefix}-alb-unhealthy"
  alarm_description   = "Alert when ALB reports unhealthy targets"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Average"
  threshold           = 0
  
  dimensions = {
    TargetGroup  = module.alb.target_group_arn_suffix
    LoadBalancer = module.alb.lb_arn_suffix
  }
  
  alarm_actions = [aws_sns_topic.alerts.arn]
  ok_actions    = [aws_sns_topic.alerts.arn]
}

# ==============================================================================
# AUTO-SHUTDOWN SCHEDULE (11pm-6am) - Optional cost savings
# ==============================================================================

# IAM role for Lambda scheduler
resource "aws_iam_role" "scheduler" {
  name = "${local.name_prefix}-scheduler-role"
  
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
}

resource "aws_iam_role_policy" "scheduler" {
  name = "${local.name_prefix}-scheduler-policy"
  role = aws_iam_role.scheduler.id
  
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "autoscaling:SetDesiredCapacity",
          "autoscaling:DescribeAutoScalingGroups",
          "ecs:UpdateService",
          "ecs:DescribeServices"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

# Lambda function to scale down (11pm)
resource "aws_lambda_function" "scale_down" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  filename      = "${path.module}/lambda_scheduler.zip"
  function_name = "${local.name_prefix}-scale-down"
  role          = aws_iam_role.scheduler.arn
  handler       = "index.handler"
  runtime       = "python3.11"
  timeout       = 60
  
  environment {
    variables = {
      ASG_NAME     = aws_autoscaling_group.ecs.name
      ECS_CLUSTER  = module.ecs_cluster.cluster_id
      ECS_SERVICE  = aws_ecs_service.this.name
      DESIRED_CAPACITY = "0"
    }
  }
}

# Lambda function to scale up (6am)
resource "aws_lambda_function" "scale_up" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  filename      = "${path.module}/lambda_scheduler.zip"
  function_name = "${local.name_prefix}-scale-up"
  role          = aws_iam_role.scheduler.arn
  handler       = "index.handler"
  runtime       = "python3.11"
  timeout       = 60
  
  environment {
    variables = {
      ASG_NAME     = aws_autoscaling_group.ecs.name
      ECS_CLUSTER  = module.ecs_cluster.cluster_id
      ECS_SERVICE  = aws_ecs_service.this.name
      DESIRED_CAPACITY = "1"
    }
  }
}

# EventBridge rule to trigger scale down at 11pm PST (7am UTC)
resource "aws_cloudwatch_event_rule" "scale_down" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  name                = "${local.name_prefix}-scale-down"
  description         = "Scale down ECS at 11pm PST"
  schedule_expression = "cron(0 7 * * ? *)"  # 11pm PST = 7am UTC
}

resource "aws_cloudwatch_event_target" "scale_down" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  rule      = aws_cloudwatch_event_rule.scale_down[0].name
  target_id = "ScaleDownLambda"
  arn       = aws_lambda_function.scale_down[0].arn
}

resource "aws_lambda_permission" "scale_down" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scale_down[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scale_down[0].arn
}

# EventBridge rule to trigger scale up at 6am PST (2pm UTC)
resource "aws_cloudwatch_event_rule" "scale_up" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  name                = "${local.name_prefix}-scale-up"
  description         = "Scale up ECS at 6am PST"
  schedule_expression = "cron(0 14 * * ? *)"  # 6am PST = 2pm UTC
}

resource "aws_cloudwatch_event_target" "scale_up" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  rule      = aws_cloudwatch_event_rule.scale_up[0].name
  target_id = "ScaleUpLambda"
  arn       = aws_lambda_function.scale_up[0].arn
}

resource "aws_lambda_permission" "scale_up" {
  count = var.enable_auto_shutdown ? 1 : 0
  
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.scale_up[0].function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.scale_up[0].arn
}

module "route53" {
  source       = "./modules/route53_private"
  zone_name    = var.route53_zone_name
  vpc_id       = module.network.vpc_id
  record_name  = format("%s.%s", var.alb_record_name, var.route53_zone_name)
  alb_dns_name = module.alb.lb_dns_name
  alb_zone_id  = module.alb.lb_zone_id
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
