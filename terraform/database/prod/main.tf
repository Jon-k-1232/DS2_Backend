locals {
  name_prefix = "ds2-db"
}

# Reuses existing private subnets/NAT paths; does not create IGW or NAT resources.
module "network" {
  source             = "./modules/vpc"
  vpc_id             = var.vpc_id
  private_subnet_ids = var.private_subnet_ids
}

resource "aws_security_group" "db" {
  name   = "${local.name_prefix}-sg"
  vpc_id = module.network.vpc_id

  dynamic "ingress" {
    for_each = var.db_allowed_cidrs
    content {
      description = "Approved on-prem/VPN networks"
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
    Name = "${local.name_prefix}-sg"
  }
}

module "backup_bucket" {
  source      = "./modules/s3_backup"
  bucket_name = "ds2-pg-backups-prod"
}

# Single RDS instance with ds2_dev (auto-created) and ds2_prod (manually created)
module "database" {
  source                    = "./modules/rds_postgres"
  vpc_id                    = module.network.vpc_id
  subnet_ids                = module.network.private_subnet_ids
  db_identifier             = "ds2-shared-db"
  db_name                   = "ds2_dev" # Auto-creates ds2_dev on first deployment
  master_username           = var.db_username
  master_password           = var.db_password
  instance_class            = var.db_instance_class
  allocated_storage         = var.db_allocated_storage
  max_allocated_storage     = var.db_max_allocated_storage
  multi_az                  = var.db_multi_az
  backup_retention          = var.db_backup_retention
  skip_final_snapshot       = var.db_skip_final_snapshot
  final_snapshot_identifier = var.db_final_snapshot_identifier
  vpc_security_group_ids    = [aws_security_group.db.id]
}
