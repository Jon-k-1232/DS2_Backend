#########
# IAM user and access for DS2 bucket
#########
resource "aws_iam_user" "ds2_bucket_user" {
  name = var.iam_user_name

  tags = {
    Purpose   = "DS2 S3 bucket access"
    ManagedBy = "Terraform"
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
    resources = [
      aws_s3_bucket.app_bucket.arn,
      aws_s3_bucket.llm_logs.arn,
    ]
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
    resources = [
      "${aws_s3_bucket.app_bucket.arn}/*",
      "${aws_s3_bucket.llm_logs.arn}/*",
    ]
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

#########
# Time-tracker AI pipeline grants on the IAM user.
#
# The backend's BedrockRuntimeClient uses the default AWS credential
# provider chain (AWS_ACCESS_KEY_ID env vars, then ECS task role). In
# prod the ECS task role's `ecs_task_bedrock` and `ecs_task_comprehend`
# policies already cover this (see DS2_Backend/terraform/backend/main.tf).
# These grants on the IAM user are defense-in-depth: they also enable
# any local-dev / wrapper-script setup that exports the user's keys as
# AWS_ACCESS_KEY_ID env vars to actually run the Bedrock pipeline.
#
# Region wildcards intentionally omitted from `comprehend:DetectPiiEntities`
# / `comprehend:ContainsPiiEntities` because Comprehend doesn't support
# resource-level scoping for those calls.
#########

variable "bedrock_region" {
  description = "Region for Bedrock InvokeModel calls. Must match BEDROCK_REGION in the backend env."
  type        = string
  default     = "us-west-2"
}

data "aws_caller_identity" "current" {}

data "aws_iam_policy_document" "ds2_user_bedrock_comprehend" {
  statement {
    sid    = "BedrockInvokeClaude"
    effect = "Allow"
    actions = [
      "bedrock:InvokeModel",
      "bedrock:InvokeModelWithResponseStream",
    ]
    resources = [
      # Foundation-model ARNs (no account ID — same across all accounts).
      "arn:aws:bedrock:${var.bedrock_region}::foundation-model/anthropic.claude-haiku-*",
      "arn:aws:bedrock:${var.bedrock_region}::foundation-model/anthropic.claude-sonnet-4-5-*",
      # Cross-region inference-profile ARNs (account-scoped). The model IDs
      # we invoke are inference-profile IDs (us.anthropic.claude-...), so
      # both ARN forms are required.
      "arn:aws:bedrock:${var.bedrock_region}:${data.aws_caller_identity.current.account_id}:inference-profile/us.anthropic.claude-haiku-*",
      "arn:aws:bedrock:${var.bedrock_region}:${data.aws_caller_identity.current.account_id}:inference-profile/us.anthropic.claude-sonnet-4-5-*",
    ]
  }

  statement {
    sid    = "ComprehendDetectPii"
    effect = "Allow"
    actions = [
      "comprehend:DetectPiiEntities",
      "comprehend:ContainsPiiEntities",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "ds2_user_bedrock_comprehend" {
  name        = "${var.iam_user_name}-bedrock-comprehend"
  description = "Bedrock InvokeModel + Comprehend DetectPiiEntities for ${var.iam_user_name}"
  policy      = data.aws_iam_policy_document.ds2_user_bedrock_comprehend.json
}

resource "aws_iam_user_policy_attachment" "ds2_user_bedrock_comprehend" {
  user       = aws_iam_user.ds2_bucket_user.name
  policy_arn = aws_iam_policy.ds2_user_bedrock_comprehend.arn
}
