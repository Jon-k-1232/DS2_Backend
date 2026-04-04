resource "aws_s3_bucket" "app_bucket" {
  bucket        = local.bucket_name
  force_destroy = false

  tags = {
    Name        = local.bucket_name
    Environment = "prod"
    ManagedBy   = "Terraform"
  }
}

resource "aws_s3_bucket_ownership_controls" "app_bucket_ownership" {
  bucket = aws_s3_bucket.app_bucket.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "app_bucket_versioning" {
  bucket = aws_s3_bucket.app_bucket.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_object" "app_logo" {
  bucket       = aws_s3_bucket.app_bucket.id
  key          = "James_F__Kimmel___Associates/app/assets/logo.png"
  source       = "${path.module}/assets/logo.png"
  etag         = filemd5("${path.module}/assets/logo.png")
  content_type = "image/png"
}

resource "aws_s3_object" "folder_markers" {
  for_each = toset(local.s3_folder_keys)
  bucket   = aws_s3_bucket.app_bucket.id
  key      = each.value
  content  = ""
}

resource "aws_s3_bucket_public_access_block" "app_bucket_block" {
  bucket                  = aws_s3_bucket.app_bucket.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app_bucket_encryption" {
  bucket = aws_s3_bucket.app_bucket.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# Access logging bucket (stores access logs)
resource "aws_s3_bucket" "access_logs" {
  bucket        = "${local.bucket_name}-access-logs"
  force_destroy = true

  tags = {
    Name        = "${local.bucket_name}-access-logs"
    Environment = "prod"
    ManagedBy   = "Terraform"
  }
}

resource "aws_s3_bucket_public_access_block" "access_logs_block" {
  bucket                  = aws_s3_bucket.access_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "access_logs_lifecycle" {
  bucket = aws_s3_bucket.access_logs.id

  rule {
    id     = "delete-old-logs"
    status = "Enabled"

    expiration {
      days = 90
    }
  }
}

# Enable access logging on main bucket
resource "aws_s3_bucket_logging" "app_bucket_logging" {
  bucket = aws_s3_bucket.app_bucket.id

  target_bucket = aws_s3_bucket.access_logs.id
  target_prefix = "ds2-prod/"
}

#########
# S3 Bucket Policy
#########
data "aws_iam_policy_document" "bucket_policy" {
  statement {
    sid    = "AllowBucketOwnerManagement"
    effect = "Allow"
    actions = [
      "s3:DeleteBucket",
      "s3:GetBucket*",
      "s3:ListBucket",
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:PutObjectTagging",
      "s3:GetObjectTagging",
    ]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
    resources = [
      aws_s3_bucket.app_bucket.arn,
      "${aws_s3_bucket.app_bucket.arn}/*"
    ]
  }

  statement {
    sid     = "DenyIfNotViaVPCOrVPN"
    effect  = "Deny"
    actions = local.bucket_data_actions
    not_principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
    resources = [
      aws_s3_bucket.app_bucket.arn,
      "${aws_s3_bucket.app_bucket.arn}/*"
    ]
    condition {
      test     = "StringNotEquals"
      variable = "aws:SourceVpce"
      values   = [aws_vpc_endpoint.s3_gateway.id]
    }
    condition {
      test     = "NotIpAddress"
      variable = "aws:SourceIp"
      values   = [
        "184.187.118.98/32",
        "72.250.20.70/32",
        "70.172.94.162/32",
        "162.191.229.114/32",
        "24.255.62.16/32"
      ]
    }
  }
}

resource "aws_s3_bucket_policy" "app_bucket_policy" {
  bucket = aws_s3_bucket.app_bucket.id
  policy = data.aws_iam_policy_document.bucket_policy.json
}

#########
# LLM Audit Logs Bucket
#########
resource "aws_s3_bucket" "llm_logs" {
  bucket        = "${local.bucket_name}-llm-logs"
  force_destroy = true

  tags = {
    Name        = "${local.bucket_name}-llm-logs"
    Environment = "prod"
    ManagedBy   = "Terraform"
  }
}

resource "aws_s3_bucket_ownership_controls" "llm_logs_ownership" {
  bucket = aws_s3_bucket.llm_logs.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_public_access_block" "llm_logs_block" {
  bucket                  = aws_s3_bucket.llm_logs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "llm_logs_encryption" {
  bucket = aws_s3_bucket.llm_logs.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "llm_logs_lifecycle" {
  bucket = aws_s3_bucket.llm_logs.id

  rule {
    id     = "expire-old-llm-logs"
    status = "Enabled"

    expiration {
      days = 90
    }
  }
}

data "aws_iam_policy_document" "llm_logs_bucket_policy" {
  statement {
    sid    = "AllowAccountAccess"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
    ]
    principals {
      type        = "AWS"
      identifiers = ["arn:aws:iam::${var.account_id}:root"]
    }
    resources = [
      aws_s3_bucket.llm_logs.arn,
      "${aws_s3_bucket.llm_logs.arn}/*",
    ]
  }
}

resource "aws_s3_bucket_policy" "llm_logs_policy" {
  bucket = aws_s3_bucket.llm_logs.id
  policy = data.aws_iam_policy_document.llm_logs_bucket_policy.json
}
