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

variable "db_instance_class" {
  type    = string
  default = "db.t4g.small"
}

variable "db_allocated_storage" {
  type    = number
  default = 50
}

variable "db_max_allocated_storage" {
  type    = number
  default = 200
}

variable "db_multi_az" {
  type    = bool
  default = false
}

variable "db_backup_retention" {
  type    = number
  default = 7
}

variable "db_skip_final_snapshot" {
  type    = bool
  default = false
}

variable "db_allowed_cidrs" {
  type = list(string)
  default = [
    "192.168.0.0/24",
    "192.168.6.0/24",
    "192.168.10.0/26",
    "192.168.12.0/26",
    "192.168.40.0/24",
    "192.168.168.0/24",
    "173.31.0.0/20"
  ]
}

variable "db_username" {
  type        = string
  description = "Master username for RDS database"
  sensitive   = true
}

variable "db_password" {
  type        = string
  description = "Master password for RDS database"
  sensitive   = true
}

variable "db_final_snapshot_identifier" {
  type        = string
  description = "Final snapshot identifier when destroying the database"
  default     = null
}
