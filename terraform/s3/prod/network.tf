data "aws_subnet" "ds2_private" {
  for_each = toset(var.private_subnet_ids)
  id       = each.value
}

data "aws_route_table" "private" {
  for_each  = toset(var.private_subnet_ids)
  subnet_id = each.value
}

data "aws_vpc_endpoint_service" "s3" {
  service      = "s3"
  service_type = "Interface"
}

locals {
  ds2_private_subnet_cidrs       = [for subnet in data.aws_subnet.ds2_private : subnet.cidr_block]
  inferred_route_table_ids       = distinct([for rt in data.aws_route_table.private : rt.id])
  target_private_route_table_ids = length(var.private_route_table_ids) > 0 ? var.private_route_table_ids : local.inferred_route_table_ids
  supported_interface_subnet_ids = [
    for subnet_id, subnet in data.aws_subnet.ds2_private : subnet_id
    if contains(data.aws_vpc_endpoint_service.s3.availability_zones, subnet.availability_zone)
  ]
}

resource "aws_vpc_endpoint" "s3_gateway" {
  vpc_id            = var.vpc_id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = local.target_private_route_table_ids

  tags = {
    Name      = "s3-gateway-endpoint"
    ManagedBy = "Terraform"
  }
}

# VPC Endpoint Policy - restricts actions through the Gateway endpoint
data "aws_iam_policy_document" "gateway_vpce_policy" {
  statement {
    sid       = "AllowS3ActionsToProdBucket"
    effect    = "Allow"
    actions   = [
      "s3:GetObject",
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:ListBucket",
      "s3:GetObjectVersion",
      "s3:DeleteObjectVersion",
      "s3:ListBucketVersions"
    ]
    resources = [
      aws_s3_bucket.app_bucket.arn,
      "${aws_s3_bucket.app_bucket.arn}/*",
      "arn:aws:s3:::ds2-database-backups-prod",
      "arn:aws:s3:::ds2-database-backups-prod/*"
    ]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }

  statement {
    sid       = "DenyDangerousActions"
    effect    = "Deny"
    actions   = [
      "s3:DeleteBucket",
      "s3:PutBucketPolicy",
      "s3:DeleteBucketPolicy"
    ]
    resources = ["*"]
    principals {
      type        = "*"
      identifiers = ["*"]
    }
  }
}

resource "aws_vpc_endpoint_policy" "s3_gateway_policy" {
  vpc_endpoint_id = aws_vpc_endpoint.s3_gateway.id
  policy          = data.aws_iam_policy_document.gateway_vpce_policy.json
}

## Interface endpoint and associated resources removed - using free Gateway endpoint instead
