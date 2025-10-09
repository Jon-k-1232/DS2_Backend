#########
# S3 Bucket and Objects
#########
resource "aws_s3_bucket" "app_bucket" {
  bucket        = "ds2"
  force_destroy = false

  tags = {
    Name        = "ds2"
    Environment = "prod"
  }

  versioning {
    enabled = true
  }
}

resource "aws_s3_object" "folder_prefixes" {
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

#########
# S3 Bucket Policy
#########
data "aws_iam_policy_document" "bucket_policy" {
  statement {
    sid     = "DenyIfNotViaOurVPCE"
    effect  = "Deny"
    actions = ["s3:*"]
    principals {
      type        = "*"
      identifiers = ["*"]
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
    sid    = "AllowViaOurVPCE"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:ListBucket"
    ]
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
