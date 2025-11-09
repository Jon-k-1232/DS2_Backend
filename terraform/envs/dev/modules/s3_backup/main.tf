terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

variable "bucket_name" {
  type        = string
  description = "Name for the pg_dump backup bucket"
}

variable "lifecycle_transition_days" {
  type    = number
  default = 60
}

resource "aws_kms_key" "this" {
  description             = "KMS key for DS2 pg_dump backups"
  deletion_window_in_days = 30
  enable_key_rotation     = true
}

resource "aws_kms_alias" "this" {
  name          = "alias/${replace(var.bucket_name, "_", "-")}-backup"
  target_key_id = aws_kms_key.this.id
}

resource "aws_s3_bucket" "this" {
  bucket = var.bucket_name
  force_destroy = false
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.this.arn
      sse_algorithm     = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "this" {
  bucket = aws_s3_bucket.this.id

  rule {
    id     = "glacier-archive"
    status = "Enabled"

    transition {
      days          = var.lifecycle_transition_days
      storage_class = "DEEP_ARCHIVE"
    }

    noncurrent_version_transition {
      noncurrent_days = var.lifecycle_transition_days
      storage_class   = "DEEP_ARCHIVE"
    }
  }
}

output "bucket_name" {
  value = aws_s3_bucket.this.bucket
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}

output "kms_key_arn" {
  value = aws_kms_key.this.arn
}
