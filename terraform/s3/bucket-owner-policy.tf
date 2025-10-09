#########
# Allow account root to manage the bucket outside VPCE restriction
#########
data "aws_iam_policy_document" "bucket_owner_policy" {
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
}
