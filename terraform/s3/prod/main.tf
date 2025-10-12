resource "aws_s3_bucket" "app_bucket" {
  bucket        = local.bucket_name
  force_destroy = false

  tags = {
    Name        = local.bucket_name
    Environment = "prod"
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
    sid     = "DenyIfNotViaOurVPCE"
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
      values   = [aws_vpc_endpoint.s3_interface.id]
    }
  }

  statement {
    sid     = "AllowViaOurVPCE"
    effect  = "Allow"
    actions = local.bucket_data_actions
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [
      aws_s3_bucket.app_bucket.arn,
      "${aws_s3_bucket.app_bucket.arn}/*"
    ]
    condition {
      test     = "StringEquals"
      variable = "aws:SourceVpce"
      values   = [aws_vpc_endpoint.s3_interface.id]
    }
  }
}

resource "aws_s3_bucket_policy" "app_bucket_policy" {
  bucket = aws_s3_bucket.app_bucket.id
  policy = data.aws_iam_policy_document.bucket_policy.json
}
