#########
# IAM user and access for DS2 bucket
#########
resource "aws_iam_user" "ds2_bucket_user" {
  name = var.iam_user_name

  tags = {
    Purpose     = "DS2 S3 bucket access"
    Environment = "dev"
  }
}

data "aws_iam_policy_document" "ds2_bucket_access" {
  statement {
    sid    = "AllowBucketList"
    effect = "Allow"
    actions = [
      "s3:ListBucket",
      "s3:GetBucketLocation"
    ]
    resources = [aws_s3_bucket.app_bucket.arn]
  }

  statement {
    sid    = "AllowObjectCrud"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion"
    ]
    resources = ["${aws_s3_bucket.app_bucket.arn}/*"]
  }
}

resource "aws_iam_policy" "ds2_bucket_access" {
  name        = "${var.iam_user_name}-policy"
  description = "Access to DS2 bucket ${local.bucket_name}"
  policy      = data.aws_iam_policy_document.ds2_bucket_access.json
}

resource "aws_iam_user_policy_attachment" "ds2_bucket_access" {
  user       = aws_iam_user.ds2_bucket_user.name
  policy_arn = aws_iam_policy.ds2_bucket_access.arn
}

resource "aws_iam_access_key" "ds2_bucket_user_key" {
  user = aws_iam_user.ds2_bucket_user.name
}
